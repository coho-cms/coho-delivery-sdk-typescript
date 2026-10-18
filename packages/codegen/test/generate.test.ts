import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CodegenError, drift, generate, readTypeModel, write } from '../src/index.ts';
import type { Field, Generated, TypeModel } from '../src/index.ts';

/**
 * Each fixture's generated files are compared byte for byte with the ones checked in
 * under `expected/`, which `npm run typecheck` also compiles against the runtime and
 * `npm run lint` holds to this repository's style. After an intended change, rewrite
 * them with `COHO_UPDATE_GOLDEN=1 npm test` and review the diff.
 */
const FIXTURES = ['cli-next-blog', 'delivery-fixture', 'assets'];

function fixture(name: string): TypeModel
{
    return readTypeModel(JSON.parse(readFileSync(new URL(`../../../spec/type-model/fixtures/${name}.json`, import.meta.url), 'utf8')));
}

for (const name of FIXTURES)
{
    test(`${name} generates its expected files, byte for byte`, () =>
    {
        const generated = generate(fixture(name));
        const expected = fileURLToPath(new URL(`./expected/${name}`, import.meta.url));

        if (process.env['COHO_UPDATE_GOLDEN'] === '1')
        {
            write(generated.files, expected);
            return;
        }
        assert.deepEqual(drift(generated.files, expected), []);
        assert.deepEqual(generated.warnings, []);
    });
}

test('each type is its own file, importing the types it links to', () =>
{
    const generated = generate(model({
        post: [{ id: 'author', kind: 'reference', many: false, of: ['person'] }, { id: 'related', kind: 'reference', many: true, of: ['post'] }],
        person: [{ id: 'name' }],
    }));

    assert.deepEqual(generated.files.map((file) => file.path), ['index.ts', 'Person.ts', 'Post.ts']);
    const post = file(generated, 'Post.ts');
    assert.match(post, /^import type \{ Person \} from "\.\/Person\.ts";$/m);
    // Not itself, though it links to itself.
    assert.doesNotMatch(post, /from "\.\/Post\.ts"/);
    assert.match(post, /^export interface Post extends runtime\.EntryBase<"post">\n\{\n {4}\/\*\* author \*\/$/m);
    assert.match(file(generated, 'index.ts'), /^export type \{ Post \} from "\.\/Post\.ts";$/m);
});

test('a type model with no types is index.ts alone, with only the untyped reads', () =>
{
    const generated = generate(model({}));

    assert.deepEqual(generated.files.map((each) => each.path), ['index.ts']);
    const index = file(generated, 'index.ts');
    assert.match(index, /^export type AnyEntry = never;$/m);
    assert.match(index, /^export const shape: runtime\.Shape = \{\};$/m);
});

test('types whose files would be one file on a case-insensitive file system are refused', () =>
{
    assert.throws(
        () => generate(model({ blogPost: [], blogpost: [] })),
        (error: unknown) => error instanceof CodegenError && /Blogpost\.ts and BlogPost\.ts|BlogPost\.ts and Blogpost\.ts/.test(error.message),
    );
});

/** A type model with the given types, each field filled out with the defaults a plain optional field has. */
function model(types: Record<string, readonly Partial<Field>[]>, overrides: Partial<TypeModel> = {}): TypeModel
{
    return readTypeModel({
        irVersion: '1.0',
        source: { project: 'p1', ref: 'v1.0.0', immutable: true, schemaHash: 'sha256:0' },
        types: Object.fromEntries(
            Object.entries(types).map(([slug, fields]) => [
                slug,
                {
                    slug,
                    name: slug,
                    version: 'v',
                    fields: fields.map((field) => ({ name: field.id, kind: 'text', presence: 'maybe', required: false, localized: false, sortable: false, ...field })),
                },
            ]),
        ),
        ...overrides,
    });
}

/** One generated file's contents, by its path. */
function file(generated: Generated, path: string): string
{
    const found = generated.files.find((each) => each.path === path);
    assert.ok(found !== undefined, `${path} was not generated`);
    return found.contents;
}

/** Every file generated for {@link types}, one after another. */
const code = (types: TypeModel): string => generate(types).files.map((each) => each.contents).join('\n');

test('the order of types in the model does not change the output', () =>
{
    const a = model({ post: [{ id: 'title' }], author: [{ id: 'name' }] });
    const b = model({ author: [{ id: 'name' }], post: [{ id: 'title' }] });

    assert.equal(code(a), code(b));
});

test('a type named like one of the generated code\'s own names is given Entry after it, with a warning', () =>
{
    const generated = generate(model({ coho: [], linked: [], index: [] }));

    assert.match(file(generated, 'CohoEntry.ts'), /export interface CohoEntry extends runtime\.EntryBase<"coho">/);
    assert.match(file(generated, 'LinkedEntry.ts'), /export interface LinkedEntry extends runtime\.EntryBase<"linked">/);
    // Index.ts would be index.ts on a case-insensitive file system.
    assert.match(file(generated, 'IndexEntry.ts'), /export interface IndexEntry extends runtime\.EntryBase<"index">/);
    assert.equal(generated.warnings.length, 3);
});

test('a type slugged like an untyped read is read as <slug>Type, with a warning', () =>
{
    const generated = generate(model({ byId: [] }));
    const contents = file(generated, 'index.ts');

    assert.match(contents, /readonly byIdType: runtime\.TypeReader<ById, never>;/);
    assert.match(contents, /byIdType: content\.type<ById, never>\("byId"\),/);
    assert.match(generated.warnings[0] ?? '', /coho\.byIdType/);
});

test('a field kind this generator does not know is typed unknown, with a warning', () =>
{
    const generated = generate(model({ post: [{ id: 'shape', kind: 'polygon' }] }));

    assert.match(file(generated, 'Post.ts'), /readonly shape\?: unknown;/);
    assert.match(generated.warnings[0] ?? '', /'polygon'/);
});

test('a link whose target type is not on the ref is an untyped entry', () =>
{
    const contents = code(model({ post: [{ id: 'author', kind: 'reference', many: false, of: [] }] }));

    assert.match(contents, /readonly author\?: runtime\.Linked<runtime\.HydratedEntry>;/);
});

test('repeater items are typed by their id until component types are', () =>
{
    const generated = generate(model({ page: [{ id: 'blocks', kind: 'repeater', of: ['hero'] }] }));

    assert.match(file(generated, 'RepeaterItem.ts'), /export type RepeaterItem = /);
    assert.match(file(generated, 'Page.ts'), /^import type \{ RepeaterItem \} from "\.\/RepeaterItem\.ts";$/m);
    assert.match(file(generated, 'Page.ts'), /readonly blocks\?: readonly RepeaterItem\[\];/);
});

test('an asset field is a nullable asset, a list with many, and an image asset when it accepts only raster images', () =>
{
    const contents = code(model({
        page: [
            { id: 'hero', kind: 'asset', many: false, accept: ['image/png', 'image/webp'] },
            { id: 'logo', kind: 'asset', many: false, accept: ['image/*'] },
            { id: 'files', kind: 'asset', many: true, accept: [] },
            { id: 'cover', kind: 'asset', many: false, presence: 'always', required: true, accept: ['image/jpeg'] },
        ],
    }));

    assert.match(contents, /readonly hero\?: runtime\.ImageAsset \| null;/);
    // An image family includes SVG, which has no pixels to resize.
    assert.match(contents, /readonly logo\?: runtime\.Asset \| null;/);
    assert.match(contents, /readonly files\?: readonly runtime\.Asset\[\];/);
    // Required, and still nullable: an asset that is gone on the ref is delivered as null.
    assert.match(contents, /readonly cover: runtime\.ImageAsset \| null;/);
    assert.match(contents, /Accepts image\/png, image\/webp\./);
});

test('choice values are escaped, and a display name cannot end its doc comment', () =>
{
    const contents = code(model({ post: [{ id: 'mood', name: 'Mood */ oops', kind: 'choice', values: ['say "hi"', 'back\\slash'] }] }));

    assert.match(contents, /"say \\"hi\\"" \| "back\\\\slash" \| \(string & \{\}\)/);
    assert.match(contents, /\/\*\* Mood \*\\\/ oops \*\//);
});

test('a model from a branch, and the model\'s own warnings, are reported', () =>
{
    const generated = generate(
        model({ post: [] }, {
            source: { project: 'p1', ref: 'feature/x', immutable: false, schemaHash: 'sha256:0' },
            warnings: [{ type: 'post', field: 'author', message: "links to type 'ghost', which is not on this ref" }],
        }),
    );

    assert.deepEqual(generated.warnings, [
        "post.author: links to type 'ghost', which is not on this ref",
        "Generated from 'feature/x', a branch: its types can change. Release builds should name a tag.",
    ]);
    assert.match(file(generated, 'index.ts'), /ref feature\/x \(a branch, whose types can change\)/);
});

test('a type model of another major version is refused', () =>
{
    assert.throws(
        () => readTypeModel({ irVersion: '2.0', source: {}, types: {} }),
        (error: unknown) => error instanceof CodegenError && /version 2\.0; this generator reads 1\.x/.test(error.message),
    );
});
