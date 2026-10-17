import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bundleTemplate } from '../src/scaffold.ts';
import { VERSION, temp, template } from './fixture.ts';

const CLI = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const BUNDLED = fileURLToPath(new URL('../template', import.meta.url));

/** Runs create-coho in {@link dir}, without a terminal, so nothing is asked. */
function run(dir: string, args: string[])
{
    return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: withoutToken() });
}

/** The same, without blocking, so a stand-in Coho in this process can answer it. */
function runAsync(dir: string, args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }>
{
    return new Promise((done) =>
    {
        const child = spawn(process.execPath, [CLI, ...args], { cwd: dir, env: withoutToken() });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('close', (status) => done({ status, stdout, stderr }));
    });
}

/** This environment, less a COHO_TOKEN set for the coho CLI, which create-coho would pick up. */
function withoutToken(): NodeJS.ProcessEnv
{
    const { COHO_TOKEN: _, ...env } = process.env;
    return env;
}

const TOKEN = `coho_pt_${'A'.repeat(22)}${'b'.repeat(43)}`;

/** A stand-in for Coho's `GET /api/v1/token`, answering {@link status} and {@link body}, and noting what it was asked. */
async function coho(status: number, body: unknown)
{
    const asked: { path: string; authorization: string | undefined }[] = [];
    const server = createServer((request, response) =>
    {
        asked.push({ path: request.url ?? '', authorization: request.headers.authorization });
        response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
    await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked, close: () => server.close() };
}

const described = (role: string) => ({
    account: { id: 'a1', name: 'Acme' },
    project: { id: 'p1', name: 'blog-sample' },
    token: { id: 't1', label: 'library', role, expiresAt: '2027-01-14T00:00:00Z' },
});

const json = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

test('a library is created from a template folder, named, configured, and pinned to this version\'s SDK', () =>
{
    const cwd = temp();

    const created = run(cwd, ['content', '--template', template(), '--name', '@acme/content', '--ref', 'v1.4.0', '--no-install']);

    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stdout, new RegExp(`Created @acme/content in content, .* on @coho-cms ${VERSION.replace(/\./g, '\\.')}\\.`));
    const pkg = json(join(cwd, 'content', 'package.json'));
    assert.equal(pkg['name'], '@acme/content');
    assert.deepEqual(pkg['devDependencies'], { '@coho-cms/codegen': VERSION, '@coho-cms/delivery': VERSION, typescript: '7.0.2' });
    assert.equal(json(join(cwd, 'content', 'coho.config.json'))['ref'], 'v1.4.0');
    assert.ok(existsSync(join(cwd, 'content', '.gitignore')));
    assert.ok(!existsSync(join(cwd, 'content', '.env')));
    assert.ok(!existsSync(join(cwd, 'content', 'package-lock.json')), 'the first install pins the SDK');
    // What was not given is listed to fill in.
    assert.match(created.stdout, /set url, account, project in coho\.config\.json/);
    assert.match(created.stdout, /cp \.env\.example \.env/);
});

test('with a URL and a token, Coho says which account and project, and the token goes in .env', async () =>
{
    const server = await coho(200, described('viewer'));
    try
    {
        const cwd = temp();

        const created = await runAsync(cwd, ['content', '--template', template(), '--name', '@acme/content', '--url', server.url, '--token', TOKEN, '--ref', 'v1.4.0', '--no-install']);

        assert.equal(created.status, 0, created.stderr);
        assert.deepEqual(server.asked, [{ path: '/api/v1/token', authorization: `Bearer ${TOKEN}` }]);
        const config = json(join(cwd, 'content', 'coho.config.json'));
        assert.deepEqual([config['url'], config['account'], config['project'], config['ref']], [server.url, 'a1', 'p1', 'v1.4.0']);
        assert.equal(readFileSync(join(cwd, 'content', '.env'), 'utf8'), `COHO_TOKEN=${TOKEN}\n`);
        assert.match(created.stdout, /It reads blog-sample, in Acme, with the token in \.env\./);
        assert.doesNotMatch(created.stdout, /viewer token is enough/);
        assert.doesNotMatch(created.stdout, /cp \.env\.example|set .* in coho\.config\.json/);
    }
    finally
    {
        server.close();
    }
});

test('a token that can do more than read is used, with a word about it', async () =>
{
    const server = await coho(200, described('maintainer'));
    try
    {
        const created = await runAsync(temp(), ['content', '--template', template(), '--url', server.url, '--token', TOKEN, '--no-install']);

        assert.equal(created.status, 0, created.stderr);
        assert.match(created.stdout, /That token is a maintainer\. The library only reads, so a viewer token is enough/);
    }
    finally
    {
        server.close();
    }
});

test('a token Coho refuses leaves nothing created', async () =>
{
    const server = await coho(401, { code: 'UNAUTHENTICATED', title: 'Not authenticated', status: 401, detail: 'This project token has been revoked' });
    try
    {
        const cwd = temp();

        const refused = await runAsync(cwd, ['content', '--template', template(), '--url', server.url, '--token', TOKEN, '--no-install']);

        assert.equal(refused.status, 1);
        assert.match(refused.stderr, /Coho refused the token \(UNAUTHENTICATED: This project token has been revoked\)\. Check that it is a current project token/);
        assert.ok(!existsSync(join(cwd, 'content')));
    }
    finally
    {
        server.close();
    }
});

test('a token without a URL, or a value that is not a project token, is refused before anything is asked', () =>
{
    const cwd = temp();

    const noUrl = run(cwd, ['content', '--template', template(), '--token', TOKEN, '--no-install']);
    assert.equal(noUrl.status, 1);
    assert.match(noUrl.stderr, /A token needs the Coho URL/);

    const notToken = run(cwd, ['content', '--template', template(), '--url', 'https://app.coho.example', '--token', 'coho_dk_key', '--no-install']);
    assert.equal(notToken.status, 1);
    assert.match(notToken.stderr, /A project token starts coho_pt_/);
    assert.ok(!existsSync(join(cwd, 'content')));
});

test('without a terminal nothing is asked, and the name defaults from the directory', () =>
{
    const cwd = temp();

    const created = run(cwd, ['news', '--template', template(), '--no-install']);

    assert.equal(created.status, 0, created.stderr);
    assert.equal(json(join(cwd, 'news', 'package.json'))['name'], '@your-org/news');
});

test('a bundled template\'s dotfiles come back in the library', () =>
{
    const bundle = join(temp(), 'template');
    bundleTemplate(template({ npmrc: true }), bundle);
    const cwd = temp();

    const created = run(cwd, ['content', '--template', bundle, '--name', '@acme/content', '--no-install']);

    assert.equal(created.status, 0, created.stderr);
    assert.ok(existsSync(join(cwd, 'content', '.gitignore')));
    assert.ok(existsSync(join(cwd, 'content', '.npmrc')));
});

test('a directory with files in it is refused, and so is a name npm would refuse', () =>
{
    const cwd = temp();
    mkdirSync(join(cwd, 'taken'));
    writeFileSync(join(cwd, 'taken', 'notes.md'), '');

    const taken = run(cwd, ['taken', '--template', template(), '--no-install']);
    assert.equal(taken.status, 1);
    assert.match(taken.stderr, /taken already has files in it/);

    const badName = run(cwd, ['fresh', '--template', template(), '--name', 'Not Valid', '--no-install']);
    assert.equal(badName.status, 1);
    assert.match(badName.stderr, /not a package name npm accepts/);
    assert.ok(!existsSync(join(cwd, 'fresh')), 'nothing is created');
});

// The two below use this package's own template/ folder, so they stand aside for a real bundle.
test('with no bundled template, and no --template, nothing is created or asked', { skip: existsSync(BUNDLED) && 'a bundle is present' }, () =>
{
    const cwd = temp();

    const refused = run(cwd, ['content', '--name', '@acme/content', '--no-install']);

    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /no bundled template/);
    assert.ok(!existsSync(join(cwd, 'content')));
});

test('without --template, the bundled template is used', { skip: existsSync(BUNDLED) && 'a bundle is present' }, () =>
{
    bundleTemplate(template(), BUNDLED);
    try
    {
        const cwd = temp();

        const created = run(cwd, ['content', '--name', '@acme/content', '--no-install']);

        assert.equal(created.status, 0, created.stderr);
        assert.match(created.stdout, /from the bundled template/);
        assert.ok(existsSync(join(cwd, 'content', '.gitignore')));
    }
    finally
    {
        rmSync(BUNDLED, { recursive: true, force: true });
    }
});

test('--help prints the usage', () =>
{
    const help = run(temp(), ['--help']);

    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: npm create coho@latest/);
});
