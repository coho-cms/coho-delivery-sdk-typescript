import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CodegenConfig } from './config.ts';
import type { GeneratedFile } from './generate.ts';
import { CodegenError, readTypeModel } from './model.ts';
import type { TypeModel } from './model.ts';

/** The type model in [path], read and checked. */
export function readTypeModelFile(path: string): TypeModel {
  if (!existsSync(path)) throw new CodegenError(`No type model at ${path}: run coho-codegen pull`);
  return parse(readFileSync(path, 'utf8'), path);
}

export interface PullOptions {
  /** A project token with read access. */
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Fetches the type model for the configured ref and writes it to [path] as it
 * arrived, so the committed file is exactly what the server sent.
 *
 * The server's ETag is the SHA-256 of the body, and the file is the body, so the
 * file's own hash asks whether anything changed; an unchanged model costs a `304`.
 * A model this generator cannot read is refused before anything is written.
 *
 * @returns whether the file changed, and the model it now holds
 */
export async function pull(config: CodegenConfig, path: string, options: PullOptions): Promise<{ changed: boolean; model: TypeModel }> {
  const { url, account, project, ref } = config;
  if (url === undefined || account === undefined || project === undefined || ref === undefined) {
    throw new CodegenError('pull needs url, account, project and ref in the config');
  }
  const endpoint = `${url.replace(/\/+$/, '')}/api/v1/accounts/${encodeURIComponent(account)}/projects/` +
    `${encodeURIComponent(project)}/refs/${encodeURIComponent(ref)}/type-model`;

  const existing = existsSync(path) ? readFileSync(path) : undefined;
  const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${options.token}` };
  if (existing !== undefined) headers['if-none-match'] = `"${createHash('sha256').update(existing).digest('hex')}"`;

  const response = await (options.fetch ?? globalThis.fetch)(endpoint, { headers });
  if (response.status === 304 && existing !== undefined) return { changed: false, model: parse(existing.toString('utf8'), path) };
  if (!response.ok) throw new CodegenError(await failure(response));

  const body = Buffer.from(await response.arrayBuffer());
  const model = parse(body.toString('utf8'), endpoint);

  // Written beside the file and renamed over it, so a failure never leaves half a model.
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, body);
  renameSync(`${path}.tmp`, path);
  return { changed: true, model };
}

/** Writes [files] into [outDir]. */
export function write(files: readonly GeneratedFile[], outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  for (const file of files) writeFileSync(join(outDir, file.path), file.contents);
}

/**
 * How [outDir] differs from [files]: each file missing or different, and each file
 * there that nothing generates. Empty when the generated code is up to date.
 */
export function drift(files: readonly GeneratedFile[], outDir: string): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const path = join(outDir, file.path);
    if (!existsSync(path)) problems.push(`${file.path} is missing`);
    else if (readFileSync(path, 'utf8') !== file.contents) problems.push(`${file.path} differs from what the type model generates`);
  }
  if (existsSync(outDir)) {
    for (const name of readdirSync(outDir)) {
      if (!files.some((file) => file.path === name)) problems.push(`${name} is in the output directory, but nothing generates it`);
    }
  }
  return problems;
}

function parse(text: string, from: string): TypeModel {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CodegenError(`${from} is not JSON`);
  }
  return readTypeModel(json);
}

async function failure(response: Response): Promise<string> {
  let detail = '';
  try {
    const problem = (await response.json()) as { code?: unknown; detail?: unknown; title?: unknown };
    detail = [problem.code, problem.detail ?? problem.title].filter((part) => typeof part === 'string').join(': ');
  } catch {
    // Not a problem document; the status says enough.
  }
  const hint = response.status === 401 || response.status === 403 ? ' Check COHO_TOKEN: it needs read access to the project.' : '';
  return `Pulling the type model failed with ${response.status}${detail === '' ? '' : ` (${detail})`}.${hint}`;
}
