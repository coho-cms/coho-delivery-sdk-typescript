import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContentClient, hydrate } from '../src/index.ts';
import type { EntryBase, Issue, ItemBase } from '../src/index.ts';
import { BASE, KEY, graph, replay } from './support.ts';

/**
 * An entry read in one locale, with a localized field inside its repeater items and
 * lists of plain values (type model 1.5), as delivery actually sent it (the
 * `entry-with-localized-items` recording), read with the shape generated code writes.
 */

const FIGURE = '00000000-0000-7000-8000-0000000000f3';

/** What generated code declares for the delivery fixture's `step` component. */
interface Step extends ItemBase<'step'>
{
    readonly label?: string;
    readonly minutes?: number;
}

interface Figure extends EntryBase<'figure'>
{
    readonly caption?: string;
    readonly steps?: readonly Step[];
    readonly keywords?: readonly string[];
    readonly sizes?: readonly number[];
}

const shape = { figure: { items: { sources: ['citation'], steps: ['step'] } } };

async function figure(): Promise<{ figure: Figure | null; issues: Issue[] }>
{
    const { fetch } = replay();
    const issues: Issue[] = [];
    const client = createContentClient({ baseUrl: BASE, key: KEY, ref: 'v0.0.1', locale: 'de-DE', fetch, onIssue: (issue) => issues.push(issue) }, shape);
    return { figure: await client.type<Figure>('figure').byId(FIGURE), issues };
}

test('a localized field inside an item is the locale\'s value, and absent where the locale has none', async () =>
{
    const { figure: read, issues } = await figure();

    assert.equal(read?._locale, 'de-DE');
    const [first, second] = read?.steps ?? [];
    assert.ok(first && second);
    assert.equal(first.label, 'Messen');
    assert.equal(first.minutes, 5);
    // Labelled in en-US and it-IT only. Not a missing field: nothing about an item is checked.
    assert.equal('label' in second, false);
    assert.equal(second.minutes, 2);
    assert.deepEqual(issues, []);
});

test('a list arrives as the array delivery sent, and an empty one is kept', async () =>
{
    const { figure: read } = await figure();

    // None in this locale, on purpose: a value, not an absent field.
    assert.deepEqual(read?.keywords, []);
    assert.deepEqual(read?.sizes, [3, 5]);
});

test('a list is neither a link nor a repeater, so hydration passes it through untouched', () =>
{
    const recorded = graph('entry-with-localized-items');
    const [hydrated] = hydrate(recorded, shape);

    assert.deepEqual(hydrated?.['keywords'], []);
    assert.deepEqual(hydrated?.['sizes'], recorded.entries[FIGURE]?.fields['sizes']);
    assert.deepEqual(hydrated?.['steps'], recorded.entries[FIGURE]?.fields['steps']);
});
