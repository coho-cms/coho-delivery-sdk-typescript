import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateError } from './scaffold.ts';

export interface Template
{
  /** A folder holding the template's files. */
  readonly dir: string;
  /** What it came from, for telling the person running it. */
  readonly from: string;
  /** Removes whatever was downloaded. Nothing, for a local folder. */
  readonly cleanup: () => void;
}

/**
 * The template bundled into this create-coho when it was published, so a version of
 * create-coho always creates the same library. A checkout has one only after
 * `npm run bundle`.
 */
export function bundledTemplate(): Template
{
  const dir = fileURLToPath(new URL('../template', import.meta.url));
  if (!existsSync(join(dir, 'package.json')))
  {
    throw new CreateError('This create-coho has no bundled template. Pass --template <folder>, or run `npm run bundle -- <template folder>` first.');
  }
  return { dir, from: 'the bundled template', cleanup: () => {} };
}

export interface SourceOptions
{
  readonly fetch?: typeof globalThis.fetch;
  /** Where GitHub archives are downloaded from. */
  readonly archives?: string;
}

/**
 * [spec] as a template: a local folder, used as it is, or a GitHub repository as
 * `owner/repo#ref`, downloaded and unpacked. A folder wins, so a local checkout can
 * be tried before anything is pushed.
 */
export async function resolveTemplate(spec: string, options: SourceOptions = {}): Promise<Template>
{
  const local = resolve(spec);
  if (existsSync(local) && statSync(local).isDirectory()) return { dir: local, from: local, cleanup: () => {} };

  const match = /^([\w.-]+)\/([\w.-]+)(?:#(.+))?$/.exec(spec);
  if (match === null) throw new CreateError(`'${spec}' is neither a folder nor a GitHub repository like owner/repo#ref`);
  const [, owner, repo, ref = 'HEAD'] = match;

  const url = `${(options.archives ?? 'https://codeload.github.com').replace(/\/+$/, '')}/${owner}/${repo}/tar.gz/${ref.split('/').map(encodeURIComponent).join('/')}`;
  const response = await (options.fetch ?? globalThis.fetch)(url);
  if (!response.ok) throw new CreateError(`Downloading the template ${owner}/${repo}#${ref} failed with ${response.status}`);

  const work = mkdtempSync(join(tmpdir(), 'create-coho-'));
  const cleanup = (): void => rmSync(work, { recursive: true, force: true });
  try
  {
    const archive = join(work, 'template.tar.gz');
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    const dir = join(work, 'template');
    mkdirSync(dir);

    // An archive holds one folder named for the repository and ref; its contents are the template.
    const tar = spawnSync('tar', ['-xzf', archive, '--strip-components=1', '-C', dir], { encoding: 'utf8' });
    if (tar.error !== undefined || tar.status !== 0)
    {
      throw new CreateError(`Unpacking the template needs tar: ${tar.error?.message ?? tar.stderr.trim()}`);
    }
    return { dir, from: `${owner}/${repo}#${ref}`, cleanup };
  }
  catch (error)
  {
    cleanup();
    throw error;
  }
}
