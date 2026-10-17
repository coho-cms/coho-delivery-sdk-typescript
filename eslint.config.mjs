// Formatting only, for now: Allman braces, four-space indents, no trailing spaces.
//
// The parser is Babel's, not typescript-eslint's: typescript-eslint needs TypeScript's
// JavaScript API, which TypeScript 7 no longer ships. No rule here needs types.
import babelParser from '@babel/eslint-parser';
import stylistic from '@stylistic/eslint-plugin';

/**
  * Allman braces for interface and enum bodies, which `@stylistic/brace-style` leaves
  * alone: the opening brace on its own line, at the declaration's indent. A body that
  * fits on one line may stay there, as brace-style allows for blocks.
  */
const allmanDeclarations = {
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        messages: { nextLine: 'Opening brace should be on its own line.' },
    },
    create(context)
    {
        const sourceCode = context.sourceCode;
        function check(declaration, open, close)
        {
            const before = sourceCode.getTokenBefore(open);
            if (before.loc.end.line !== open.loc.start.line || open.loc.start.line === close.loc.end.line) return;
            const indent = sourceCode.lines[declaration.loc.start.line - 1].match(/^\s*/)[0];
            context.report({
                node: declaration,
                loc: open.loc,
                messageId: 'nextLine',
                fix: (fixer) => fixer.replaceTextRange([before.range[1], open.range[0]], `\n${indent}`),
            });
        }
        return {
            TSInterfaceBody: (node) => check(node.parent, sourceCode.getFirstToken(node), sourceCode.getLastToken(node)),
            TSEnumDeclaration: (node) => check(node, sourceCode.getTokenAfter(node.id), sourceCode.getLastToken(node)),
        };
    },
};

export default [
    {
        // Generated code is whatever codegen emits, and is checked against that instead.
        ignores: ['**/dist/', 'packages/create-coho/template/', 'packages/codegen/test/expected/'],
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: babelParser,
            parserOptions: {
                requireConfigFile: false,
                babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ['typescript'] } },
            },
        },
        plugins: {
            '@stylistic': stylistic,
            local: { rules: { 'allman-declarations': allmanDeclarations } },
        },
        rules: {
            '@stylistic/brace-style': ['error', 'allman', { allowSingleLine: true }],
            'local/allman-declarations': 'error',
            '@stylistic/indent': ['error', 4],
            '@stylistic/no-trailing-spaces': 'error',
        },
    },
];
