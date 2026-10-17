import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CodegenError } from './model.ts';

/**
 * `coho.config.json`. Paths are relative to the file. The token is never here: `pull`
 * reads it from `COHO_TOKEN`, so the file can be committed.
 */
export interface CodegenConfig
{
    /** The Coho API's origin, such as `https://app.coho.example`. Only `pull` needs it. */
    readonly url?: string;

    /** The account id. */
    readonly account?: string;

    readonly project?: string;

    /** The tag or branch to generate from. Release builds should name a tag. */
    readonly ref?: string;

    /** The type model file. Default `coho-ir.json`. */
    readonly typeModel?: string;

    /** Where generated code goes. Default `src/coho`. Nothing else should be kept there. */
    readonly outDir?: string;
}

export interface Loaded
{
    readonly config: CodegenConfig;

    /** The type model file, resolved. */
    readonly typeModel: string;

    /** The output directory, resolved. */
    readonly outDir: string;
}

export function loadConfig(file: string): Loaded
{
    let config: unknown;
    try
    {
        config = JSON.parse(readFileSync(file, 'utf8'));
    }
    catch (error)
    {
        throw new CodegenError(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof config !== 'object' || config === null || Array.isArray(config))
    {
        throw new CodegenError(`${file} is not a JSON object`);
    }
    const loaded = config as CodegenConfig;
    const base = dirname(resolve(file));
    return {
        config: loaded,
        typeModel: resolve(base, loaded.typeModel ?? 'coho-ir.json'),
        outDir: resolve(base, loaded.outDir ?? 'src/coho'),
    };
}
