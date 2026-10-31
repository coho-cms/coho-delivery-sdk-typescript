import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, KEY, replay } from '../../delivery/test/support.ts';
import { createCoho, isResolved, source } from './expected/delivery-fixture/index.ts';

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
