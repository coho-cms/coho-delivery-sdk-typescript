import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const temp = (): string => mkdtempSync(join(tmpdir(), 'create-coho-test-'));

/** create-coho's own version: the SDK version a library it creates is pinned to. */
export const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

/**
 * A checkout shaped like coho-template-typescript, with everything it might also hold
 * that must not be copied: history, installed and built files, a packed tarball, and
 * a developer's `.env` with their token in it. Its SDK is at an old version, so pinning
 * has something to replace.
 */
export function template(options: { npmrc?: boolean } = {}): string
{
    const dir = join(temp(), 'coho-template-typescript');
    const files: Record<string, string> = {
        'package.json': JSON.stringify(
            {
                name: '@your-org/content',
                version: '0.1.0',
                private: true,
                peerDependencies: { '@coho-cms/delivery': '^0.0.1' },
                devDependencies: { '@coho-cms/codegen': '0.0.1', '@coho-cms/delivery': '0.0.1', typescript: '7.0.2' },
            },
            null,
            2,
        ),
        'package-lock.json': JSON.stringify({ name: '@your-org/content', lockfileVersion: 3, packages: { '': { name: '@your-org/content' } } }, null, 2),
        'coho.config.json': JSON.stringify(
            { url: 'https://app.coho.example', account: 'your-account-id', project: 'your-project-id', ref: 'v1.0.0', typeModel: 'coho-ir.json', outDir: 'src/coho' },
            null,
            2,
        ),
        'README.md': '# coho-template-typescript\n\nThe starting point for your content library.\n',
        '.gitignore': 'node_modules/\ndist/\n.env\n',
        '.env.example': 'COHO_TOKEN=\n',
        'src/index.ts': "export * from './coho/index.ts';\n",
        '.env': 'COHO_TOKEN=coho_pt_secret\n',
        '.git/HEAD': 'ref: refs/heads/v2026.1.0\n',
        'node_modules/typescript/package.json': '{}',
        'dist/index.js': '',
        'your-org-content-0.1.0.tgz': '',
    };
    if (options.npmrc === true) files['.npmrc'] = 'engine-strict=true\n';

    for (const [path, contents] of Object.entries(files))
    {
        mkdirSync(join(dir, path, '..'), { recursive: true });
        writeFileSync(join(dir, path), contents);
    }
    return dir;
}
