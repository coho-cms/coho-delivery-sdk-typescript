import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CodegenError, drift, generate, readTypeModel, write } from '../src/index.ts';
import type { Field, Generated, TypeModel } from '../src/index.ts';
import type { AnyPage, LandingPage, Page, ServicePage } from './expected/inheritance/index.ts';
import type { Event, Talk } from './expected/lists/index.ts';
import type { Article, Person, Page as TraitPage, Seo, SocialCard } from './expected/traits/index.ts';

/**
 * Each fixture's generated files are compared byte for byte with the ones checked in
 * under `expected/`, which `npm run typecheck` also compiles against the runtime and
 * `npm run lint` holds to this repository's style. After an intended change, rewrite
 * them with `COHO_UPDATE_GOLDEN=1 npm test` and review the diff.
 */
const FIXTURES = ['cli-next-blog', 'delivery-fixture', 'assets', 'repeaters', 'inheritance', 'traits', 'lists'];

function fixture(name: string): TypeModel
{
    return readTypeModel(JSON.parse(readFileSync(new URL(`../../../spec/type-model/fixtures/${name}.json`, import.meta.url), 'utf8')));
}

for (const name of FIXTURES)
{
    test(`${name} generates its expected files, byte for byte`, () =>
    {
        const model = fixture(name);
        const generated = generate(model);
        const expected = fileURLToPath(new URL(`./expected/${name}`, import.meta.url));

        if (process.env['COHO_UPDATE_GOLDEN'] === '1')
        {
            write(generated.files, expected);
            return;
        }
        assert.deepEqual(drift(generated.files, expected), []);
        // The fixtures are tags, so the only warnings are the model's own.
        assert.deepEqual(generated.warnings, (model.warnings ?? []).map((each) => `${each.type}.${each.field}: ${each.message}`));
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

/** {@link model}'s types, each extending the type [parents] names, and abstract where [abstract] lists it. */
function extending(parents: Record<string, string>, abstract: readonly string[], types: TypeModel['types']): TypeModel['types']
{
    return Object.fromEntries(Object.entries(types).map(([slug, type]) => [
        slug,
        { ...type, ...(parents[slug] === undefined ? {} : { extends: parents[slug] }), ...(abstract.includes(slug) ? { abstract: true } : {}) },
    ]));
}

/** Component types for {@link model}'s overrides, filled out as {@link model} fills out types. */
function components(types: Record<string, readonly Partial<Field>[]>): TypeModel['types']
{
    return model(types).types;
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

test('a list is an array of its item kind, optional by presence, and never a link', () =>
{
    const generated = generate(model({
        event: [
            { id: 'keywords', kind: 'list', item: 'text', localized: true, max: 10 },
            { id: 'scores', kind: 'list', item: 'number' },
            { id: 'sessions', kind: 'list', item: 'datetime', presence: 'always', required: true, min: 1 },
            { id: 'seats', kind: 'list', item: 'integer', min: 2, max: 4 },
        ],
    }));
    const event = file(generated, 'Event.ts');

    assert.match(event, /^ {4}\/\*\* keywords\. At most 10 values\. The locale's own list, empty when it has none\. Absent where the locale has no translation\. \*\/\n {4}readonly keywords\?: readonly string\[\];$/m);
    assert.match(event, /^ {4}readonly scores\?: readonly number\[\];$/m);
    assert.match(event, /^ {4}\/\*\* sessions\. Each an ISO 8601 date and time\. At least 1 value\. \*\/\n {4}readonly sessions: readonly string\[\];$/m);
    assert.match(event, /^ {4}\/\*\* seats\. 2 to 4 values\. \*\/$/m);
    // Passed through as delivery sends it: no link, and only a required one is always there.
    assert.match(file(generated, 'index.ts'), /^ {4}event: \{ always: \["sessions"\] \},$/m);
    assert.deepEqual(generated.warnings, []);
});

test('a list in a component is typed as at the top level, and a localized one is optional', () =>
{
    const generated = generate(model(
        { event: [{ id: 'agenda', kind: 'repeater', of: ['talk'] }] },
        { components: components({ talk: [{ id: 'tracks', kind: 'list', item: 'integer', localized: true }, { id: 'speakers', kind: 'list', item: 'text', presence: 'always', required: true }] }) },
    ));
    const talk = file(generated, 'Talk.ts');

    assert.match(talk, /^ {4}\/\*\* tracks\. The locale's own list, empty when it has none\. Absent where the locale has no translation\. \*\/\n {4}readonly tracks\?: readonly number\[\];$/m);
    assert.match(talk, /^ {4}readonly speakers: readonly string\[\];$/m);
    assert.match(file(generated, 'index.ts'), /^ {4}event: \{ items: \{ agenda: \["talk"\] \} \},$/m);
});

test('a list of an item kind this generator does not know holds unknown values, with a warning', () =>
{
    const generated = generate(model({ post: [{ id: 'spots', kind: 'list', item: 'point' }] }));

    assert.match(file(generated, 'Post.ts'), /readonly spots\?: readonly unknown\[\];/);
    assert.match(generated.warnings[0] ?? '', /post\.spots is a list of 'point'/);
});

test('a link whose target type is not on the ref is an untyped entry', () =>
{
    const contents = code(model({ post: [{ id: 'author', kind: 'reference', many: false, of: [] }] }));

    assert.match(contents, /readonly author\?: runtime\.Linked<runtime\.HydratedEntry>;/);
});

test('a repeater whose components are not on the ref holds untyped items', () =>
{
    const generated = generate(model({ page: [{ id: 'blocks', kind: 'repeater', of: [] }] }));

    assert.match(file(generated, 'RepeaterItem.ts'), /export type RepeaterItem = /);
    assert.match(file(generated, 'Page.ts'), /^import type \{ RepeaterItem \} from "\.\/RepeaterItem\.ts";$/m);
    assert.match(file(generated, 'Page.ts'), /readonly blocks\?: readonly RepeaterItem\[\];/);
});

test('a component type is an item interface of its own, and a repeater holds a union of them', () =>
{
    const generated = generate(model(
        { page: [{ id: 'blocks', kind: 'repeater', of: ['hero', 'quote'] }, { id: 'refs', kind: 'repeater', of: ['quote'] }] },
        { components: components({ hero: [{ id: 'headline' }], quote: [{ id: 'text', presence: 'always', required: true }] }) },
    ));

    assert.deepEqual(generated.files.map((each) => each.path), ['index.ts', 'Page.ts', 'Hero.ts', 'Quote.ts']);
    assert.match(file(generated, 'Quote.ts'), /^export interface Quote extends runtime\.ItemBase<"quote">\n\{\n {4}\/\*\* text \*\/\n {4}readonly text: string;$/m);
    const page = file(generated, 'Page.ts');
    assert.match(page, /^import type \{ Hero \} from "\.\/Hero\.ts";\nimport type \{ Quote \} from "\.\/Quote\.ts";$/m);
    assert.match(page, /readonly blocks\?: readonly \(Hero \| Quote\)\[\];/);
    assert.match(page, /readonly refs\?: readonly Quote\[\];/);

    const index = file(generated, 'index.ts');
    // Exported, but not entries: no reader, and not in AnyEntry.
    assert.match(index, /^export type \{ Quote \} from "\.\/Quote\.ts";$/m);
    assert.match(index, /^export type AnyEntry = Page;$/m);
    assert.doesNotMatch(index, /readonly quote:/);
    assert.match(index, /^ {4}page: \{ items: \{ blocks: \["hero", "quote"\], refs: \["quote"\] \} \},$/m);
});

test('a component cannot share a name with a content type', () =>
{
    assert.throws(
        () => generate(model({ quote: [] }, { components: components({ quote: [] }) })),
        (error: unknown) => error instanceof CodegenError && /both be named Quote/.test(error.message),
    );
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

test('a type with descendants is read and linked as its family, and an abstract one is in no entry\'s type', () =>
{
    const generated = generate(fixture('inheritance'));
    const index = file(generated, 'index.ts');

    // Delivery lists a type with its descendants.
    assert.match(index, /^ {4}readonly page: runtime\.TypeReader<AnyPage, "rank">;$/m);
    assert.match(index, /^ {4}readonly servicePage: runtime\.TypeReader<AnyServicePage, "rank">;$/m);
    assert.match(index, /^ {4}readonly landingPage: runtime\.TypeReader<LandingPage, "rank">;$/m);
    // A read of one entry by slug or id keeps it only if its `_type` is in the family.
    assert.match(index, /^ {8}page: content\.type<AnyPage, "rank">\("page", \["landingPage", "premiumService", "servicePage"\]\),$/m);
    assert.match(index, /^ {8}landingPage: content\.type<LandingPage, "rank">\("landingPage"\),$/m);
    assert.match(index, /^export type AnyEntry = LandingPage \| Menu \| PremiumService \| ServicePage;$/m);
    assert.doesNotMatch(index, /^ {4}page: \{/m);
    // The runtime keeps an item only if its `_type` is listed, so a base component lists its family.
    assert.match(index, /items: \{ blocks: \["quoteBlock", "textBlock"\] \}/);

    assert.match(file(generated, 'Page.ts'), /^export interface Page extends runtime\.EntryBase<"landingPage" \| "premiumService" \| "servicePage">$/m);
    assert.match(file(generated, 'Page.ts'), /^export type AnyPage = LandingPage \| PremiumService \| ServicePage;$/m);
    assert.match(file(generated, 'Menu.ts'), /readonly featured\?: runtime\.Linked<AnyServicePage>;/);
    assert.match(file(generated, 'ServicePage.ts'), /^\/\*\* Service page\. Extends Page, and has every field it has\. \*\/$/m);
    // A type with no descendants has no family.
    assert.doesNotMatch(code(fixture('inheritance')), /AnyPremiumService|AnyLandingPage|AnyMenu/);
});

test('a family whose alias a type already has is named <Type>Family, with a warning', () =>
{
    const generated = generate(model({}, {
        types: extending({ post: 'page' }, [], model({ page: [], post: [], anyPage: [] }).types),
    }));

    assert.match(file(generated, 'Page.ts'), /^export type PageFamily = Page \| Post;$/m);
    assert.match(file(generated, 'index.ts'), /readonly page: runtime\.TypeReader<PageFamily, never>;/);
    assert.deepEqual(generated.warnings, ["The types that extend 'page' are named PageFamily, because AnyPage is taken."]);
});

test('an abstract type with no concrete descendants keeps its own _type, and has no family', () =>
{
    const abstract = model({}, { types: extending({ post: 'page' }, ['page', 'post'], model({ page: [], post: [] }).types) });
    const generated = generate(abstract);

    assert.match(file(generated, 'Page.ts'), /^export interface Page extends runtime\.EntryBase<"page">$/m);
    assert.doesNotMatch(code(abstract), /AnyPage/);
    assert.match(file(generated, 'index.ts'), /^export type AnyEntry = never;$/m);
});

/** Compiled by `npm run typecheck`, never called: the inheritance fixture's types relate as a hierarchy should. */
export function aHierarchyByTheTypes(landing: LandingPage, service: ServicePage, any: AnyPage): void
{
    // Every member of a family has the abstract base's fields, and so is one.
    const pages: Page[] = [landing, service, any];
    void pages;
    // An abstract type has no entries of its own.
    // @ts-expect-error: no entry's _type is "page"
    const own: Page['_type'] = 'page';
    void own;
}

test('a trait is an interface every type with it extends, and is in no entry\'s type', () =>
{
    const generated = generate(fixture('traits'));

    assert.match(file(generated, 'Article.ts'), /^export interface Article extends runtime\.EntryBase<"article">, Seo, Publishing, SocialCard$/m);
    assert.match(file(generated, 'Article.ts'), /Has the traits Seo, Publishing, and SocialCard\./);
    assert.match(file(generated, 'Seo.ts'), /^export interface Seo\n\{\n {4}\/\*\* Meta title\. Absent where the locale has no translation\. \*\/$/m);
    const index = file(generated, 'index.ts');
    assert.match(index, /^export type \{ Seo \} from "\.\/Seo\.ts";$/m);
    // Not a type: no reader, not in AnyEntry.
    assert.doesNotMatch(index, /readonly seo:/);
    assert.match(index, /^export type AnyEntry = Article \| Page \| Person;$/m);
});

/** Compiled by `npm run typecheck`, never called: code written against a trait takes every type with it. */
export function aTraitByTheTypes(article: Article, page: TraitPage, person: Person): void
{
    const described: Seo[] = [article, page];
    const shared: SocialCard[] = [article, person];
    void described;
    void shared;
    // @ts-expect-error: a person does not have the SEO trait
    const notSeo: Seo = person as Person & { metaTitle: number };
    void notSeo;
}

/** Compiled by `npm run typecheck`, never called: the lists fixture's lists hold their item kind, and an empty one is a value. */
export function aListByTheTypes(event: Event, talk: Talk): void
{
    const keywords: readonly string[] = event.keywords ?? [];
    const sessions: readonly string[] = event.sessions;
    const tracks: readonly number[] = talk.tracks ?? [];
    const none: Event['keywords'] = [];
    void [keywords, sessions, tracks, none];
    // @ts-expect-error: a list of text holds no numbers
    const numbers: Event['keywords'] = [1];
    void numbers;
    // @ts-expect-error: a list is read only
    event.sessions.push('2026-01-01T00:00:00Z');
}
