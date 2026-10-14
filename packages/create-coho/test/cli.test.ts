import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bundleTemplate } from '../src/scaffold.ts';
import { VERSION, temp, template } from './fixture.ts';

const CLI = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const BUNDLED = fileURLToPath(new URL('../template', import.meta.url));

/** Runs create-coho in [dir], without a terminal, so nothing is asked. */
function run(dir: string, args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
}

const json = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

test('a library is created from a template folder, named, configured, and pinned to this version\'s SDK', () => {
  const cwd = temp();

  const created = run(cwd, ['content', '--template', template(), '--name', '@acme/content', '--project', 'p1', '--ref', 'v1.4.0', '--no-install']);

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
  assert.match(created.stdout, /set url, account in coho\.config\.json/);
});

test('without a terminal nothing is asked, and the name defaults from the directory', () => {
  const cwd = temp();

  const created = run(cwd, ['news', '--template', template(), '--no-install']);

  assert.equal(created.status, 0, created.stderr);
  assert.equal(json(join(cwd, 'news', 'package.json'))['name'], '@your-org/news');
});

test('a bundled template\'s dotfiles come back in the library', () => {
  const bundle = join(temp(), 'template');
  bundleTemplate(template({ npmrc: true }), bundle);
  const cwd = temp();

  const created = run(cwd, ['content', '--template', bundle, '--name', '@acme/content', '--no-install']);

  assert.equal(created.status, 0, created.stderr);
  assert.ok(existsSync(join(cwd, 'content', '.gitignore')));
  assert.ok(existsSync(join(cwd, 'content', '.npmrc')));
});

test('a directory with files in it is refused, and so is a name npm would refuse', () => {
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
test('with no bundled template, and no --template, nothing is created or asked', { skip: existsSync(BUNDLED) && 'a bundle is present' }, () => {
  const cwd = temp();

  const refused = run(cwd, ['content', '--name', '@acme/content', '--no-install']);

  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /no bundled template/);
  assert.ok(!existsSync(join(cwd, 'content')));
});

test('without --template, the bundled template is used', { skip: existsSync(BUNDLED) && 'a bundle is present' }, () => {
  bundleTemplate(template(), BUNDLED);
  try {
    const cwd = temp();

    const created = run(cwd, ['content', '--name', '@acme/content', '--no-install']);

    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stdout, /from the bundled template/);
    assert.ok(existsSync(join(cwd, 'content', '.gitignore')));
  } finally {
    rmSync(BUNDLED, { recursive: true, force: true });
  }
});

test('--help prints the usage', () => {
  const help = run(temp(), ['--help']);

  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: npm create coho@latest/);
});
