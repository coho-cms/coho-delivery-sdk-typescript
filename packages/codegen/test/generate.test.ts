import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { CodegenError, generate, readTypeModel } from '../src/index.ts';
import type { Field, TypeModel } from '../src/index.ts';

/**
 * Each fixture's generated module is compared byte for byte with the one checked in
 * under `expected/`, which `npm run typecheck` also compiles against the runtime.
 * After an intended change, rewrite them with `COHO_UPDATE_GOLDEN=1 npm test` and
 * review the diff.
 */
const FIXTURES = ['cli-next-blog', 'delivery-fixture'];

function fixture(name: string): TypeModel {
  return readTypeModel(JSON.parse(readFileSync(new URL(`../../../spec/type-model/fixtures/${name}.json`, import.meta.url), 'utf8')));
}

for (const name of FIXTURES) {
  test(`${name} generates its expected module, byte for byte`, () => {
    const generated = generate(fixture(name));
    const expected = new URL(`./expected/${name}/index.ts`, import.meta.url);
    const contents = generated.files[0]?.contents ?? '';

    if (process.env['COHO_UPDATE_GOLDEN'] === '1') {
      mkdirSync(new URL('.', expected), { recursive: true });
      writeFileSync(expected, contents);
      return;
    }
    assert.deepEqual(generated.files.map((file) => file.path), ['index.ts']);
    assert.equal(contents, readFileSync(expected, 'utf8'));
    assert.deepEqual(generated.warnings, []);
  });
}

/** A type model with the given types, each field filled out with the defaults a plain optional field has. */
function model(types: Record<string, readonly Partial<Field>[]>, overrides: Partial<TypeModel> = {}): TypeModel {
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

const code = (generated: TypeModel): string => generate(generated).files[0]?.contents ?? '';

test('the order of types in the model does not change the output', () => {
  const a = model({ post: [{ id: 'title' }], author: [{ id: 'name' }] });
  const b = model({ author: [{ id: 'name' }], post: [{ id: 'title' }] });

  assert.equal(code(a), code(b));
});

test('a type named like one of the module\'s own names is given Entry after it, with a warning', () => {
  const generated = generate(model({ coho: [], linked: [] }));
  const contents = generated.files[0]?.contents ?? '';

  assert.match(contents, /export interface CohoEntry extends runtime\.EntryBase<"coho">/);
  assert.match(contents, /export interface LinkedEntry extends runtime\.EntryBase<"linked">/);
  assert.equal(generated.warnings.length, 2);
});

test('a type slugged like an untyped read is read as <slug>Type, with a warning', () => {
  const generated = generate(model({ byId: [] }));
  const contents = generated.files[0]?.contents ?? '';

  assert.match(contents, /readonly byIdType: runtime\.TypeReader<ById, never>;/);
  assert.match(contents, /byIdType: content\.type<ById, never>\("byId"\),/);
  assert.match(generated.warnings[0] ?? '', /coho\.byIdType/);
});

test('a field kind this generator does not know is typed unknown, with a warning', () => {
  const generated = generate(model({ post: [{ id: 'shape', kind: 'polygon' }] }));

  assert.match(generated.files[0]?.contents ?? '', /readonly shape\?: unknown;/);
  assert.match(generated.warnings[0] ?? '', /'polygon'/);
});

test('a link whose target type is not on the ref is an untyped entry', () => {
  const contents = code(model({ post: [{ id: 'author', kind: 'reference', many: false, of: [] }] }));

  assert.match(contents, /readonly author\?: runtime\.Linked<runtime\.HydratedEntry>;/);
});

test('repeater items are typed by their id until component types are', () => {
  const contents = code(model({ page: [{ id: 'blocks', kind: 'repeater', of: ['hero'] }] }));

  assert.match(contents, /export type RepeaterItem = /);
  assert.match(contents, /readonly blocks\?: readonly RepeaterItem\[\];/);
});

test('choice values are escaped, and a display name cannot end its doc comment', () => {
  const contents = code(model({ post: [{ id: 'mood', name: 'Mood */ oops', kind: 'choice', values: ['say "hi"', 'back\\slash'] }] }));

  assert.match(contents, /"say \\"hi\\"" \| "back\\\\slash" \| \(string & \{\}\)/);
  assert.match(contents, /\/\*\* Mood \*\\\/ oops \*\//);
});

test('a model from a branch, and the model\'s own warnings, are reported', () => {
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
  assert.match(generated.files[0]?.contents ?? '', /ref feature\/x \(a branch, whose types can change\)/);
});

test('a type model of another major version is refused', () => {
  assert.throws(
    () => readTypeModel({ irVersion: '2.0', source: {}, types: {} }),
    (error: unknown) => error instanceof CodegenError && /version 2\.0; this generator reads 1\.x/.test(error.message),
  );
});
