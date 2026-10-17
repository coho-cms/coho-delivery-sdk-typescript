import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { bundleTemplate, copyTemplate, customize, isFree, isValidPackageName, pinSdk, restoreDotfiles } from '../src/scaffold.ts';
import { temp, template } from './fixture.ts';

const json = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

test('the template is copied without history, installed or built files, tarballs, or anyone\'s .env', () =>
{
    const target = join(temp(), 'content');

    copyTemplate(template(), target);

    for (const kept of ['package.json', 'coho.config.json', 'README.md', '.gitignore', '.env.example', 'src/index.ts'])
    {
        assert.ok(existsSync(join(target, kept)), `${kept} is copied`);
    }
    for (const left of ['.env', '.git', 'node_modules', 'dist', 'your-org-content-0.1.0.tgz'])
    {
        assert.ok(!existsSync(join(target, left)), `${left} is left behind`);
    }
});

test('a bundle keeps the dotfiles npm would drop under other names, and a library gets them back', () =>
{
    const bundle = join(temp(), 'template');
    bundleTemplate(template({ npmrc: true }), bundle);

    // npm leaves .gitignore and .npmrc out of a package, so they travel as gitignore and npmrc.
    assert.deepEqual(['gitignore', 'npmrc'].map((name) => existsSync(join(bundle, name))), [true, true]);
    assert.deepEqual(['.gitignore', '.npmrc', 'package-lock.json', '.env'].map((name) => existsSync(join(bundle, name))), [false, false, false, false]);

    const library = join(temp(), 'content');
    copyTemplate(bundle, library);
    restoreDotfiles(library);
    assert.equal(readFileSync(join(library, '.gitignore'), 'utf8'), 'node_modules/\ndist/\n.env\n');
    assert.ok(existsSync(join(library, '.npmrc')));
    assert.ok(!existsSync(join(library, 'gitignore')));
});

test('the library is named, pointed at its project, and titled', () =>
{
    const target = join(temp(), 'content');
    copyTemplate(template(), target);

    customize(target, { name: '@acme/content', url: 'https://coho.acme.example', project: 'p1', ref: 'v1.4.0', account: '' });

    assert.equal(json(join(target, 'package.json'))['name'], '@acme/content');
    // A blank answer keeps the placeholder, to be filled in later.
    assert.deepEqual(json(join(target, 'coho.config.json')), {
        url: 'https://coho.acme.example',
        account: 'your-account-id',
        project: 'p1',
        ref: 'v1.4.0',
        typeModel: 'coho-ir.json',
        outDir: 'src/coho',
    });
    assert.match(readFileSync(join(target, 'README.md'), 'utf8'), /^# @acme\/content\n\nThe starting point/);
});

test('the SDK is pinned to the version given, and the template\'s lockfile goes', () =>
{
    const target = join(temp(), 'content');
    copyTemplate(template(), target);

    pinSdk(target, '0.1.0-alpha.2');

    const pkg = json(join(target, 'package.json'));
    assert.deepEqual(pkg['devDependencies'], { '@coho-cms/codegen': '0.1.0-alpha.2', '@coho-cms/delivery': '0.1.0-alpha.2', typescript: '7.0.2' });
    assert.deepEqual(pkg['peerDependencies'], { '@coho-cms/delivery': '^0.1.0-alpha.2' });
    assert.ok(!existsSync(join(target, 'package-lock.json')));
});

test('package names follow npm\'s rules', () =>
{
    for (const name of ['@acme/content', 'acme-content', '@a.b/c_d~e']) assert.equal(isValidPackageName(name), true, name);
    for (const name of ['Acme', '@acme/', '@/content', 'has space', `${'x'.repeat(215)}`, '']) assert.equal(isValidPackageName(name), false, name);
});

test('a directory is free when it is missing, or holds nothing but a .git', () =>
{
    const dir = temp();
    assert.equal(isFree(join(dir, 'missing')), true);

    mkdirSync(join(dir, 'repo', '.git'), { recursive: true });
    assert.equal(isFree(join(dir, 'repo')), true);

    writeFileSync(join(dir, 'repo', 'README.md'), '');
    assert.equal(isFree(join(dir, 'repo')), false);
});
