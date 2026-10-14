import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** A refusal to go on, with a message for whoever ran it. */
export class CreateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateError';
  }
}

/** What the new library is set up with. A value left out keeps the template's placeholder. */
export interface Answers {
  readonly name: string;
  readonly url?: string;
  readonly account?: string;
  readonly project?: string;
  readonly ref?: string;
}

/**
 * Never copied: a checkout's history, what installing and building leave behind, and
 * above all a developer's own `.env`, which holds their token.
 */
const LEFT_BEHIND = new Set(['.git', 'node_modules', 'dist', '.env', 'coho-ir.json.tmp']);

/**
 * Dotfiles npm leaves out of a published package, by the name they travel under
 * instead. A bundled template keeps them under these names, and a new library gets
 * them back. Losing `.gitignore` would let a library's `.env` be committed.
 */
const PACKED_AS: Readonly<Record<string, string>> = { gitignore: '.gitignore', npmrc: '.npmrc' };

/** The packages a library is generated against, released together with create-coho. */
const SDK = ['@coho-cms/delivery', '@coho-cms/codegen'] as const;

/** Copies the template in [from] into [to], leaving behind what must not travel. */
export function copyTemplate(from: string, to: string): void {
  cpSync(from, to, {
    recursive: true,
    filter: (source) => source === from || (!LEFT_BEHIND.has(basename(source)) && !source.endsWith('.tgz')),
  });
}

/**
 * Bundles the template checkout in [from] into [to], to be published inside
 * create-coho: the lockfile stays behind, since a new library pins its own versions,
 * and each dotfile npm would drop travels under its packed name.
 */
export function bundleTemplate(from: string, to: string): void {
  rmSync(to, { recursive: true, force: true });
  copyTemplate(from, to);
  rmSync(join(to, 'package-lock.json'), { force: true });
  for (const [packed, dotfile] of Object.entries(PACKED_AS)) {
    if (existsSync(join(to, dotfile))) renameSync(join(to, dotfile), join(to, packed));
  }
}

/** Gives a library copied from a bundled template its dotfiles back. */
export function restoreDotfiles(dir: string): void {
  for (const [packed, dotfile] of Object.entries(PACKED_AS)) {
    if (existsSync(join(dir, packed))) renameSync(join(dir, packed), join(dir, dotfile));
  }
}

/** Sets the library up as [answers] say: its package name, and where its content types come from. */
export function customize(dir: string, answers: Answers): void {
  editJson(join(dir, 'package.json'), (pkg) => {
    pkg['name'] = answers.name;
  });

  editJson(join(dir, 'coho.config.json'), (config) => {
    for (const key of ['url', 'account', 'project', 'ref'] as const) {
      const value = answers[key];
      if (value !== undefined && value !== '') config[key] = value;
    }
  });

  // The README's title is the template's own name. The rest still applies to the library.
  const readme = join(dir, 'README.md');
  if (existsSync(readme)) writeFileSync(readme, readFileSync(readme, 'utf8').replace(/^# .*$/m, `# ${answers.name}`));
}

/**
 * Pins the library to the SDK released with this create-coho, [version]: exactly, for
 * the packages it builds with, and from there up for its peer dependency. The
 * template's lockfile goes, so the first install resolves exactly these.
 */
export function pinSdk(dir: string, version: string): void {
  editJson(join(dir, 'package.json'), (pkg) => {
    const dev = (pkg['devDependencies'] ?? {}) as Record<string, string>;
    for (const name of SDK) dev[name] = version;
    pkg['devDependencies'] = dev;

    const peer = (pkg['peerDependencies'] ?? {}) as Record<string, string>;
    peer['@coho-cms/delivery'] = `^${version}`;
    pkg['peerDependencies'] = peer;
  });
  rmSync(join(dir, 'package-lock.json'), { force: true });
}

/** Whether npm would accept [name], such as `@acme/content`. */
export function isValidPackageName(name: string): boolean {
  return name.length <= 214 && /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name);
}

/** Whether [dir] can be created into: it does not exist, or holds nothing but a `.git`. */
export function isFree(dir: string): boolean {
  return !existsSync(dir) || readdirSync(dir).every((name) => name === '.git');
}

function editJson(path: string, edit: (json: Record<string, unknown>) => void): void {
  if (!existsSync(path)) throw new CreateError(`The template has no ${basename(path)}`);
  const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  edit(json);
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}
