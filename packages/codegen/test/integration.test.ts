import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hydrate } from '@coho-cms/delivery';
import type { EntryGraph, Issue } from '@coho-cms/delivery';
import { BASE, KEY, graph, replay } from '../../delivery/test/support.ts';
import { createCoho, isResolved, shape, source } from './expected/delivery-fixture/index.ts';
import type { Outline, OutlineSection } from './expected/delivery-fixture/index.ts';

/**
 * The generated module, run. `expected/delivery-fixture` is what the generator writes
 * for the types of the delivery recordings' content, and here it reads those
 * recordings through the runtime, as a customer's library reads the server.
 */

/** A client over the recordings, in {@link locale}, or in none for `null`. */
function coho(locale: string | null = 'en-US')
{
    const { fetch } = replay();
    return createCoho({ baseUrl: BASE, key: KEY, ref: 'v0.0.1', locale: locale ?? undefined, fetch });
}

test('a typed read is hydrated through the generated client', async () =>
{
    const chain = await coho().article.bySlug('chain-1', { depth: 2 });

    assert.equal(chain?._type, 'article');
    assert.equal(chain?.title, 'Chain 1');
    const next = chain?.related?.[0];
    assert.ok(next !== undefined && isResolved(next));
    assert.equal(next.title, 'Chain 2');
});

test('a typed list is ordered by a sortable field', async () =>
{
    const page = await coho().article.list({ order: '-rank', limit: 3 });

    assert.deepEqual(page.items.map((article) => article.rank), [103, 102, 101]);
    assert.equal(page.hasMore, true);
});

test('a type with no entries lists as an empty page', async () =>
{
    // The recording asked without a locale.
    const page = await coho(null).notice.list({ order: '-priority' });

    assert.deepEqual(page.items, []);
    assert.equal(page.hasMore, false);
});

test('the untyped reads return any type, narrowed by _type', async () =>
{
    const entry = await coho().bySlug('chain-1', { depth: 1 });

    assert.equal(entry?._type, 'article');
    if (entry?._type === 'article') assert.equal(entry.rank, 101);
});

test('a read in another locale projects item fields and keeps an empty list, through the generated types', async () =>
{
    const figure = await coho('de-DE').figure.byId('00000000-0000-7000-8000-0000000000f3');

    assert.equal(figure?._type, 'figure');
    // A localized label in each step: German in the first, none in the second.
    assert.deepEqual(figure?.steps?.map((step) => step.label), ['Messen', undefined]);
    assert.deepEqual(figure?.steps?.map((step) => step.minutes), [5, 2]);
    // A list of text, empty in German on purpose, and a list of integers.
    const keywords: readonly string[] | undefined = figure?.keywords;
    const sizes: readonly number[] | undefined = figure?.sizes;
    assert.deepEqual(keywords, []);
    assert.deepEqual(sizes, [3, 5]);
});

test('items inside items are hydrated at every level, through the generated types and shape', async () =>
{
    const outline = await coho().outline.byId('00000000-0000-7000-8000-0000000000b1');

    assert.equal(outline?._type, 'outline');
    const section = outline?.sections?.[0];
    assert.equal(section?._type, 'outlineSection');
    assert.equal(section?.heading, 'Plan');
    // A point holds points: three levels, each typed as one.
    const first = section?.points?.[0];
    const second = first?.children?.[0];
    const third = second?.children?.[0];
    assert.deepEqual([first?._id, second?._id, third?._id], [
        '00000000-0000-7000-8000-0000000000b3',
        '00000000-0000-7000-8000-0000000000b4',
        '00000000-0000-7000-8000-0000000000b5',
    ]);
    assert.deepEqual([first?._type, second?._type, third?._type], ['point', 'point', 'point']);
    // The third is written in pt-BR only.
    assert.deepEqual([first?.text, second?.text, third?.text], ['Survey', 'Measure', undefined]);
    assert.ok(third !== undefined && !('text' in third));
    // A localized repeater, read as the en-US list.
    assert.deepEqual(section?.notes?.map((note) => [note._id, note._type, note.text]), [['00000000-0000-7000-8000-0000000000b6', 'note', 'Bring cones']]);
});

test('the generated shape leaves out a nested item of a component it was not generated with, and keeps its siblings', () =>
{
    const recorded = graph('entry-with-nested-items');
    const [id = ''] = recorded.roots;
    const entry = recorded.entries[id];
    assert.ok(entry);
    const [section] = entry.fields['sections'] as readonly OutlineSection[];
    const point = section?.points?.[0];
    assert.ok(section && point);
    const added: EntryGraph = {
        ...recorded,
        entries: { [id]: { ...entry, fields: { sections: [{ ...section, points: [{ ...point, children: [{ _id: 'x1', _type: 'poll' }, ...(point.children ?? [])] }] }] } } },
    };

    const issues: Issue[] = [];
    const [outline] = hydrate(added, shape, { onIssue: (issue) => issues.push(issue) }) as Outline[];
    const children = outline?.sections?.[0]?.points?.[0]?.children;
    assert.deepEqual(children?.map((child) => child._id), ['00000000-0000-7000-8000-0000000000b4']);
    assert.equal(children?.[0]?.children?.[0]?._id, '00000000-0000-7000-8000-0000000000b5');
    assert.deepEqual(issues.map((issue) => `${issue.kind} ${issue.field}`), ['unknown-item sections/0/points/0/children']);
});

test('the module names the type model it was generated from', () =>
{
    assert.equal(source.ref, 'v0.0.1');
    assert.equal(source.immutable, true);
});

/** Compiled by `npm run typecheck`, never called: what the types refuse. */
export function refusedByTheTypes(client: ReturnType<typeof coho>): void
{
    // @ts-expect-error: a text field is not sortable
    void client.article.list({ order: 'title' });
    // @ts-expect-error: a notice has no rank
    void client.notice.list({ order: 'rank' });
    // @ts-expect-error: a list is never sortable
    void client.figure.list({ order: 'sizes' });
}
