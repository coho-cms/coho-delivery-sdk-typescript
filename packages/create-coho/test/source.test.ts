import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { CreateError } from '../src/scaffold.ts';
import { resolveTemplate } from '../src/source.ts';
import { temp, template } from './fixture.ts';

test('a local folder is used as it is, and nothing is cleaned up', async () => {
  const dir = template();

  const resolved = await resolveTemplate(dir);
  resolved.cleanup();

  assert.equal(resolved.dir, dir);
  assert.ok(existsSync(join(dir, 'package.json')));
});

test('something that is neither a folder nor owner/repo is refused', async () => {
  await assert.rejects(resolveTemplate('not a template'), CreateError);
});

test('a GitHub repository is downloaded for its ref, unpacked, and cleaned up after', async () => {
  // An archive shaped like GitHub's: one folder, named for the repository and ref.
  const work = temp();
  cpSync(template(), join(work, 'coho-template-typescript-v2026.1.0'), { recursive: true });
  const archive = join(work, 'archive.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', work, 'coho-template-typescript-v2026.1.0']).status, 0);

  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(request.url ?? '');
    response.end(readFileSync(archive));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address() as AddressInfo;
    const resolved = await resolveTemplate('coho-cms/coho-template-typescript#v2026.1.0', { archives: `http://127.0.0.1:${port}` });

    assert.deepEqual(asked, ['/coho-cms/coho-template-typescript/tar.gz/v2026.1.0']);
    assert.equal(resolved.from, 'coho-cms/coho-template-typescript#v2026.1.0');
    assert.ok(existsSync(join(resolved.dir, 'package.json')), 'the archive\'s folder is stripped');

    resolved.cleanup();
    assert.ok(!existsSync(resolved.dir));
  } finally {
    server.close();
  }
});

test('a failed download says which template', async () => {
  const fetch = (async () => new Response('Not Found', { status: 404 })) as typeof globalThis.fetch;

  await assert.rejects(
    resolveTemplate('coho-cms/nope#v1', { fetch }),
    (error: unknown) => error instanceof CreateError && /coho-cms\/nope#v1 failed with 404/.test(error.message),
  );
});
