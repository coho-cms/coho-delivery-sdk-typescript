#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { describeToken } from './coho.ts';
import type { TokenDescription } from './coho.ts';
import { CreateError, copyTemplate, customize, isFree, isValidPackageName, pinSdk, restoreDotfiles, writeEnv } from './scaffold.ts';
import type { Answers } from './scaffold.ts';
import { bundledTemplate, resolveTemplate } from './source.ts';

/** This create-coho's version, which is also the SDK version a library it creates is pinned to. */
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const USAGE = `Usage: npm create coho@latest [directory] -- [options]

Creates a content library: a TypeScript package, generated from your Coho project's
content types, that your sites and services install.

Options:
  --template <folder | owner/repo#ref>  Another template than the one bundled with this version
  --name <package>   The package name, such as @acme/content
  --url <url>        The Coho URL, such as https://app.coho.example
  --token <token>    A project token, coho_pt_…; or COHO_TOKEN. It says which account
                     and project the library is for, and goes in the library's .env
  --ref <tag>        The tag to generate from
  --no-install       Don't run npm install
  -y, --yes          Ask nothing: use what is given, and placeholders for the rest
  -h, --help`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      template: { type: 'string' },
      name: { type: 'string' },
      url: { type: 'string' },
      token: { type: 'string' },
      ref: { type: 'string' },
      'no-install': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }

  // Before any question: a create-coho with no bundled template cannot go on without --template.
  const bundled = values.template === undefined ? bundledTemplate() : undefined;

  // Questions only in a terminal, and only for what was not given. The output can be
  // muted, so a token is not echoed as it is typed or pasted.
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const prompt = process.stdin.isTTY === true && values.yes !== true ? createInterface({ input: process.stdin, output, terminal: true }) : undefined;
  const ask = async (question: string, fallback: string): Promise<string> => {
    if (prompt === undefined) return fallback;
    const answer = (await prompt.question(`${question}${fallback === '' ? '' : ` (${fallback})`}: `)).trim();
    return answer === '' ? fallback : answer;
  };
  const askSecret = async (question: string): Promise<string> => {
    if (prompt === undefined) return '';
    process.stdout.write(`${question}: `);
    muted = true;
    try {
      return (await prompt.question('')).trim();
    } finally {
      muted = false;
      process.stdout.write('\n');
    }
  };

  let answers: Answers;
  let target: string;
  let token: string;
  let described: TokenDescription | undefined;
  try {
    target = resolve(positionals[0] ?? (await ask('Directory', 'content')));
    if (!isFree(target)) throw new CreateError(`${shown(target)} already has files in it`);

    const name = values.name ?? (await ask('Package name', `@your-org/${basename(target)}`));
    if (!isValidPackageName(name)) throw new CreateError(`'${name}' is not a package name npm accepts, such as @acme/content`);

    // A blank answer keeps the template's placeholder, to fill in coho.config.json later.
    const url = values.url ?? (await ask('Coho URL, as `coho status` shows it', ''));
    // COHO_TOKEN only with a URL to ask: the coho CLI reads the same variable, so it may be set for that.
    token = values.token ?? (url === '' ? '' : process.env['COHO_TOKEN']?.trim() || (await askSecret('Project token, coho_pt_… (blank to set it later)')));
    if (token !== '' && url === '') throw new CreateError('A token needs the Coho URL to ask: pass --url');
    // Before anything is created: a token Coho refuses leaves nothing half made.
    if (token !== '') described = await describeToken(url, token);
    answers = {
      name,
      url,
      account: described?.account.id,
      project: described?.project.id,
      ref: values.ref ?? (await ask('Tag to generate from', '')),
    };
  } finally {
    prompt?.close();
  }

  const template = bundled ?? (await resolveTemplate(values.template ?? ''));
  try {
    copyTemplate(template.dir, target);
    restoreDotfiles(target);
    customize(target, answers);
    pinSdk(target, VERSION);
    if (token !== '') writeEnv(target, token);
  } finally {
    template.cleanup();
  }
  console.log(`Created ${answers.name} in ${shown(target)}, from ${template.from}, on @coho-cms ${VERSION}.`);
  if (described !== undefined) {
    const account = described.account.name ?? described.account.id;
    console.log(`It reads ${described.project.name}, in ${account}, with the token in .env.`);
    // The library only reads types; a token that can do more is more to lose if it leaks.
    if (described.token.role !== 'viewer') {
      console.log(`That token is a ${described.token.role}. The library only reads, so a viewer token is enough: coho token create --role viewer`);
    }
  }

  const installed = values['no-install'] === true ? false : install(target);
  const unset = (['url', 'account', 'project', 'ref'] as const).filter((key) => (answers[key] ?? '') === '');

  console.log('\nNext:');
  console.log(`  cd ${shown(target)}`);
  if (!installed) console.log('  npm install');
  if (unset.length > 0) console.log(`  set ${unset.join(', ')} in coho.config.json`);
  if (token === '') console.log('  cp .env.example .env, and set COHO_TOKEN: a project token with read access');
  console.log('  npm run pull');
  console.log('  npm run generate');
  return 0;
}

/** Runs npm install in [dir], and says whether it worked. */
function install(dir: string): boolean {
  console.log('\nInstalling…');
  // `npm create` runs this through npm, which says where its own CLI is. Otherwise npm is on the PATH.
  const npm = process.env['npm_execpath'];
  const result = npm !== undefined && npm.endsWith('.js')
    ? spawnSync(process.execPath, [npm, 'install'], { cwd: dir, stdio: 'inherit' })
    : spawnSync('npm', ['install'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.log('npm install failed. The library is created; run npm install in it once that is fixed.');
    return false;
  }
  return true;
}

function shown(path: string): string {
  return relative(process.cwd(), path) || '.';
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // A CreateError is something to fix; anything else is a bug, and its stack helps.
    console.error(`error: ${error instanceof CreateError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = 1;
  },
);
