import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CodegenError, drift, loadConfig, pull, readTypeModelFile, write } from '../src/index.ts';

const MODEL = readFileSync(new URL('../../../spec/type-model/fixtures/cli-next-blog.json', import.meta.url));

const temp = (): string => mkdtempSync(join(tmpdir(), 'coho-codegen-'));

interface Call
{
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** A fetch that answers every request with `answer()`, recording what it was asked. */
function server(answer: (call: Call) => Response): { fetch: typeof globalThis.fetch; calls: Call[] }
{
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
  {
    const call = { url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) };
    calls.push(call);
    return answer(call);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const config = { url: 'https://app.test/', account: 'acme', project: 'p1', ref: 'release/1' };

/* PULL */
/* PULL */
/* PULL */

test('pull asks the BFF for the ref\'s type model with the token, and writes it as it arrived', async () =>
{
  const path = join(temp(), 'coho-ir.json');
  const { fetch, calls } = server(() => new Response(MODEL, { status: 200 }));

  const pulled = await pull(config, path, { token: 'coho_pt_x', fetch });

  assert.equal(calls[0]?.url, 'https://app.test/api/v1/accounts/acme/projects/p1/refs/release%2F1/type-model');
  assert.equal(calls[0]?.headers['authorization'], 'Bearer coho_pt_x');
  assert.equal(calls[0]?.headers['if-none-match'], undefined);
  assert.equal(pulled.changed, true);
  assert.deepEqual(readFileSync(path), MODEL);
});

test('pull asks whether the model changed with the file\'s hash, and a 304 leaves it alone', async () =>
{
  const path = join(temp(), 'coho-ir.json');
  writeFileSync(path, MODEL);
  const { fetch, calls } = server(() => new Response(null, { status: 304 }));

  const pulled = await pull(config, path, { token: 't', fetch });

  assert.equal(calls[0]?.headers['if-none-match'], `"${createHash('sha256').update(MODEL).digest('hex')}"`);
  assert.equal(pulled.changed, false);
  assert.deepEqual(readFileSync(path), MODEL);
});

test('a refused pull says why, and points at the token', async () =>
{
  const problem = JSON.stringify({ code: 'FORBIDDEN', title: 'Forbidden', status: 403, detail: "Requires 'content:read'" });
  const { fetch } = server(() => new Response(problem, { status: 403, headers: { 'content-type': 'application/problem+json' } }));

  await assert.rejects(
    pull(config, join(temp(), 'coho-ir.json'), { token: 't', fetch }),
    (error: unknown) => error instanceof CodegenError && /403 \(FORBIDDEN: Requires 'content:read'\)\. Check COHO_TOKEN/.test(error.message),
  );
});

test('a model this generator cannot read is refused before anything is written', async () =>
{
  const path = join(temp(), 'coho-ir.json');
  writeFileSync(path, MODEL);
  const newer = JSON.stringify({ irVersion: '2.0', source: {}, types: {} });
  const { fetch } = server(() => new Response(newer, { status: 200 }));

  await assert.rejects(pull(config, path, { token: 't', fetch }), CodegenError);
  assert.deepEqual(readFileSync(path), MODEL);
});

test('pull needs the whole address in the config', async () =>
{
  await assert.rejects(pull({ project: 'p1' }, join(temp(), 'm.json'), { token: 't' }), /needs url, account, project and ref/);
});

/* GENERATED FILES */
/* GENERATED FILES */
/* GENERATED FILES */

test('drift is empty for what was written, and names each kind of difference', () =>
{
  const out = join(temp(), 'src', 'coho');
  const files = [{ path: 'index.ts', contents: 'export {};\n' }];

  write(files, out);
  assert.deepEqual(drift(files, out), []);

  writeFileSync(join(out, 'index.ts'), 'export const edited = true;\n');
  writeFileSync(join(out, 'extra.ts'), '');
  assert.deepEqual(drift(files, out).sort(), [
    'extra.ts is in the output directory, but nothing generates it',
    'index.ts differs from what the type model generates',
  ]);

  assert.deepEqual(drift(files, join(temp(), 'nowhere')), ['index.ts is missing']);
});

test('a missing type model says to pull it', () =>
{
  assert.throws(() => readTypeModelFile(join(temp(), 'coho-ir.json')), /run coho-codegen pull/);
});

test('the config\'s paths are relative to it, with defaults', () =>
{
  const dir = temp();
  mkdirSync(join(dir, 'lib'));
  writeFileSync(join(dir, 'lib', 'coho.config.json'), JSON.stringify({ project: 'p1', outDir: 'generated' }));

  const loaded = loadConfig(join(dir, 'lib', 'coho.config.json'));

  assert.equal(loaded.typeModel, join(dir, 'lib', 'coho-ir.json'));
  assert.equal(loaded.outDir, join(dir, 'lib', 'generated'));
  assert.equal(existsSync(loaded.typeModel), false);
});
