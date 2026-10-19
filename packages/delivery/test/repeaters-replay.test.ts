import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContentClient, hydrate } from '../src/index.ts';
import type { EntryBase, EntryGraph, Issue, ItemBase } from '../src/index.ts';
import { BASE, KEY, graph, replay } from './support.ts';

/**
 * An entry with repeater items as delivery actually sent it (the `entry-with-repeater`
 * recording), read through the client with the shape generated code writes.
 */

const FIGURE = '00000000-0000-7000-8000-0000000000f2';

/** What generated code declares for the delivery fixture's `citation` component. */
interface Citation extends ItemBase<'citation'>
{
    readonly authors: string;
    readonly year: number;
    readonly title: string;
    readonly url?: string;
}

interface Figure extends EntryBase<'figure'>
{
    readonly caption?: string;
    readonly sources?: readonly Citation[];
}

const shape = { figure: { items: { sources: ['citation'] } } };

test('repeater items arrive as stored, each with its _id and _type', async () =>
{
    const { fetch } = replay();
    const client = createContentClient({ baseUrl: BASE, key: KEY, ref: 'v0.0.1', locale: undefined, fetch }, shape);
    const figure = await client.type<Figure>('figure').byId(FIGURE);

    const [first, second] = figure?.sources ?? [];
    assert.ok(first && second);
    assert.equal(first._id, '00000000-0000-7000-8000-0000000000a1');
    assert.equal(first._type, 'citation');
    assert.equal(first.year, 2022);
    assert.equal(first.url, 'https://doi.org/10.1061/9780784415788');
    // Sent without a `_type`; the server filled it in, since `sources` holds one component.
    assert.equal(second._type, 'citation');
    assert.equal(second.url, undefined);
});

test('an item of a component the shape does not list is left out, and reported once', () =>
{
    const recorded = graph('entry-with-repeater');
    const entry = recorded.entries[FIGURE];
    assert.ok(entry);
    const sources = entry.fields['sources'] as readonly Record<string, unknown>[];
    const added: EntryGraph = {
        ...recorded,
        entries: {
            [FIGURE]: {
                ...entry,
                fields: { ...entry.fields, sources: [...sources, { _id: 'x1', _type: 'video' }, { _id: 'x2', _type: 'video' }, { _id: 'x3' }] },
            },
        },
    };

    const issues: Issue[] = [];
    const [figure] = hydrate(added, shape, { onIssue: (issue) => issues.push(issue) });
    assert.deepEqual((figure?.['sources'] as Citation[]).map((each) => each._id), [
        '00000000-0000-7000-8000-0000000000a1',
        '00000000-0000-7000-8000-0000000000a2',
    ]);
    assert.deepEqual(issues.map((issue) => `${issue.kind} ${issue.field}`), ['unknown-item sources']);
});

test('without items in the shape, a repeater passes through untouched', () =>
{
    const recorded = graph('entry-with-repeater');
    const [figure] = hydrate(recorded, { figure: {} });
    assert.deepEqual(figure?.['sources'], recorded.entries[FIGURE]?.fields['sources']);
});
