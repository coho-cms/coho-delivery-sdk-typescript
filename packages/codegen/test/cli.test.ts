import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const MODEL = fileURLToPath(new URL('../../../spec/type-model/fixtures/cli-next-blog.json', import.meta.url));
const EXPECTED = fileURLToPath(new URL('./expected/cli-next-blog/index.ts', import.meta.url));

/** Runs the CLI in [dir], without COHO_TOKEN unless [env] gives one. */
function run(dir: string, args: string[], env: Record<string, string> = {})
{
  const inherited = { ...process.env };
  delete inherited['COHO_TOKEN'];
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...inherited, ...env } });
}

/** A library's directory: a config and a pulled type model. */
function library(): string
{
  const dir = mkdtempSync(join(tmpdir(), 'coho-library-'));
  writeFileSync(join(dir, 'coho.config.json'), JSON.stringify({ project: 'p1', ref: 'v1.0.0' }));
  copyFileSync(MODEL, join(dir, 'coho-ir.json'));
  return dir;
}

test('generate writes the module, and check passes until it is edited', () =>
{
  const dir = library();

  const generated = run(dir, ['generate']);
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(readFileSync(join(dir, 'src', 'coho', 'index.ts'), 'utf8'), readFileSync(EXPECTED, 'utf8'));
  assert.equal(run(dir, ['check']).status, 0);

  appendFileSync(join(dir, 'src', 'coho', 'index.ts'), '// edited\n');
  const checked = run(dir, ['check']);
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /index\.ts differs/);
  assert.match(checked.stderr, /run coho-codegen generate/);
});

test('pull without COHO_TOKEN is refused before anything is asked', () =>
{
  const pulled = run(library(), ['pull']);

  assert.equal(pulled.status, 1);
  assert.match(pulled.stderr, /COHO_TOKEN is not set/);
});

test('pull takes the token from a .env beside the config when the environment has none', () =>
{
  const dir = library();
  writeFileSync(join(dir, '.env'), 'COHO_TOKEN=coho_pt_from_file\n');

  // Past the token check, and stopped by the config, which names no server.
  const pulled = run(dir, ['pull']);
  assert.equal(pulled.status, 1);
  assert.match(pulled.stderr, /pull needs url, account, project and ref/);
});

test('--ref pulls another ref than the config names', async () =>
{
  const asked: string[] = [];
  const server = createServer((request, response) =>
  {
    asked.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(readFileSync(MODEL));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try
  {
    const dir = library();
    const { port } = server.address() as AddressInfo;
    writeFileSync(join(dir, 'coho.config.json'), JSON.stringify({ url: `http://127.0.0.1:${port}`, account: 'a', project: 'p1', ref: 'v1.0.0' }));

    // Not spawnSync: the server answers on this process's event loop.
    const child = spawn(process.execPath, [CLI, 'pull', '--ref', 'v2.0.0'], { cwd: dir, env: { ...process.env, COHO_TOKEN: 't' } });
    const [code] = await once(child, 'exit');

    assert.equal(code, 0);
    assert.deepEqual(asked, ['/api/v1/accounts/a/projects/p1/refs/v2.0.0/type-model']);
  }
  finally
  {
    server.close();
  }
});

test('no command is a usage error, and --help is not', () =>
{
  const dir = library();

  assert.equal(run(dir, []).status, 1);
  const help = run(dir, ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: coho-codegen <command>/);
});
