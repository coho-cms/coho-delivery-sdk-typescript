/**
 * `npm run bundle -- <template folder>`: bundles a checkout of the library template into
 * this package's `template/`, as the publish workflow does before publishing. A version
 * of create-coho then always creates the same library.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleTemplate } from '../src/scaffold.ts';

const given = process.argv[2];
// npm runs scripts from the package's folder; a relative path means where npm was run.
const from = given === undefined ? undefined : resolve(process.env['INIT_CWD'] ?? process.cwd(), given);
if (from === undefined || !existsSync(join(from, 'package.json')))
{
  console.error('Usage: npm run bundle -- <template folder>, a checkout of coho-template-typescript');
  process.exit(1);
}

const to = fileURLToPath(new URL('../template', import.meta.url));
bundleTemplate(from, to);
console.log(`Bundled ${from} into ${to}.`);
