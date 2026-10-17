// Formatting only, for now: Allman braces, four-space indents, a blank line around each
// documented member, no trailing spaces.
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

/**
 * A blank line between two members of an interface, type literal or class when either
 * has a doc comment, so each documented member reads as its own paragraph. Members
 * without one may sit together, and members on one line are left alone.
 */
const blankLineAroundDocumented = {
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        messages: { blankLine: 'Expected a blank line between a documented member and the one beside it.' },
    },
    create(context)
    {
        const sourceCode = context.sourceCode;
        const isDoc = (comment) => comment.type === 'Block' && comment.value.startsWith('*');
        // The comments on the lines above a member, not one trailing the member before it.
        const leading = (member) =>
        {
            const before = sourceCode.getTokenBefore(member);
            return sourceCode.getCommentsBefore(member).filter((comment) => comment.loc.start.line > before.loc.end.line);
        };
        function check(members)
        {
            for (let i = 1; i < members.length; i++)
            {
                const comments = leading(members[i]);
                if (!comments.some(isDoc) && !leading(members[i - 1]).some(isDoc)) continue;
                const start = comments[0] ?? members[i];
                const before = sourceCode.getTokenBefore(start, { includeComments: true });
                const gap = start.loc.start.line - before.loc.end.line;
                if (gap !== 1) continue;
                context.report({
                    loc: start.loc,
                    messageId: 'blankLine',
                    fix: (fixer) => fixer.insertTextAfter(before, '\n'),
                });
            }
        }
        return {
            TSInterfaceBody: (node) => check(node.body),
            TSTypeLiteral: (node) => check(node.members),
            ClassBody: (node) => check(node.body),
        };
    },
};

export default [
    {
        // Codegen's expected output is linted too, so the generator keeps to this style.
        ignores: ['**/dist/', 'packages/create-coho/template/'],
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
            local: { rules: { 'allman-declarations': allmanDeclarations, 'blank-line-around-documented': blankLineAroundDocumented } },
        },
        rules: {
            '@stylistic/brace-style': ['error', 'allman', { allowSingleLine: true }],
            'local/allman-declarations': 'error',
            'local/blank-line-around-documented': 'error',
            '@stylistic/indent': ['error', 4],
            '@stylistic/no-trailing-spaces': 'error',
        },
    },
];
