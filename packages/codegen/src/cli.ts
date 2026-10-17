#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.ts';
import { drift, pull, readTypeModelFile, write } from './files.ts';
import { generate } from './generate.ts';
import { CodegenError } from './model.ts';

const USAGE = `Usage: coho-codegen <command> [--config coho.config.json]

Commands:
  pull      Fetch the type model for the configured ref into the type model file.
            Needs COHO_TOKEN, from the environment or a .env beside the config.
            --ref <ref> pulls another tag or branch than the config names.
  generate  Write TypeScript for the type model into the output directory.
  check     Fail if the output directory differs from what generate would write.`;

async function main(argv: string[]): Promise<number>
{
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            config: { type: 'string', short: 'c', default: 'coho.config.json' },
            ref: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
    });
    const command = positionals[0];
    if (values.help === true)
    {
        console.log(USAGE);
        return 0;
    }
    if (command === undefined)
    {
        console.error(USAGE);
        return 1;
    }

    const loaded = loadConfig(values.config);
    const shown = (path: string): string => relative(process.cwd(), path) || '.';

    switch (command)
    {
        case 'pull': {
            // A .env beside the config may hold the token for local runs. CI sets the variable,
            // which wins: a value already in the environment is never replaced.
            const envFile = join(dirname(values.config), '.env');
            if (process.env['COHO_TOKEN'] === undefined && existsSync(envFile) && typeof process.loadEnvFile === 'function')
            {
                process.loadEnvFile(envFile);
            }
            const token = process.env['COHO_TOKEN'];
            if (token === undefined || token === '') throw new CodegenError('COHO_TOKEN is not set: pull needs a project token with read access');
            const config = values.ref === undefined ? loaded.config : { ...loaded.config, ref: values.ref };
            const pulled = await pull(config, loaded.typeModel, { token });
            console.log(pulled.changed ? `Updated ${shown(loaded.typeModel)} from ${pulled.model.source.ref}.` : `${shown(loaded.typeModel)} is up to date.`);
            return 0;
        }
        case 'generate': {
            const generated = generate(readTypeModelFile(loaded.typeModel));
            write(generated.files, loaded.outDir);
            for (const warning of generated.warnings) console.error(`warning: ${warning}`);
            console.log(`Wrote ${generated.files.map((file) => file.path).join(', ')} to ${shown(loaded.outDir)}.`);
            return 0;
        }
        case 'check': {
            const problems = drift(generate(readTypeModelFile(loaded.typeModel)).files, loaded.outDir);
            if (problems.length === 0)
            {
                console.log('Generated code is up to date.');
                return 0;
            }
            for (const problem of problems) console.error(`${shown(loaded.outDir)}: ${problem}`);
            console.error('Generated code is out of date: run coho-codegen generate.');
            return 1;
        }
        default:
            console.error(`Unknown command '${command}'.\n\n${USAGE}`);
            return 1;
    }
}

main(process.argv.slice(2)).then(
    (code) =>
    {
        process.exitCode = code;
    },
    (error: unknown) =>
    {
    // A CodegenError is something to fix; anything else is a bug, and its stack helps.
        console.error(`error: ${error instanceof CodegenError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        process.exitCode = 1;
    },
);
