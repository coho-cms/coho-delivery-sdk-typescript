import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContentClient, isResolved } from '../src/index.ts';
import type { EntryBase, Issue, Linked, Shape } from '../src/index.ts';
import { BASE, KEY, replay } from './support.ts';

const C2 = '00000000-0000-7000-8000-0000000000c2';
const C3 = '00000000-0000-7000-8000-0000000000c3';
const ABSENT = '00000000-0000-7000-8000-0000000000ff';

/** What generated code would declare for the recordings' `article` type. */
interface Article extends EntryBase<'article'>
{
    readonly title?: string;
    readonly body?: string;
    readonly rank?: number;
    readonly related?: readonly Linked<Article>[];
}

const shape: Shape = { article: { links: { related: 'many' } } };

function content(options: { shape?: Shape; onIssue?: (issue: Issue) => void; locale?: string } = {})
{
    const { fetch, calls } = replay();
    const locale = 'locale' in options ? options.locale : 'en-US';
    const client = createContentClient(
        { baseUrl: BASE, key: KEY, ref: 'v0.0.1', locale, fetch, onIssue: options.onIssue },
        options.shape ?? shape,
    );
    return { client, calls, articles: client.type<Article, 'rank'>('article') };
}

test('a typed read is hydrated', async () =>
{
    const { articles } = content();

    const chain = await articles.bySlug('chain-1', { depth: 2 });

    assert.equal(chain?.title, 'Chain 1');
    const next = chain?.related?.[0];
    assert.ok(next !== undefined && isResolved(next));
    assert.equal(next.title, 'Chain 2');
});

test('a slug of another type is null, the same as no entry', async () =>
{
    const { client } = content();
    assert.equal(await client.type('page').bySlug('chain-1', { depth: 2 }), null);

    // The recording asked without a locale.
    const bare = content({ locale: undefined });
    assert.equal(await bare.client.type('article').bySlug('nope'), null);
});

test('a read of a base type finds an entry of any type in its family', async () =>
{
    const { client } = content();

    // As generated code reads a base type that `article` extends.
    const chain = await client.type('page', ['article', 'landing']).bySlug('chain-1', { depth: 2 });

    assert.equal(chain?._type, 'article');
    assert.equal(await client.type('page', ['landing']).bySlug('chain-1', { depth: 2 }), null);
});

test('the configured locale is sent, unless a read names its own', async () =>
{
    const { articles, calls } = content();

    const chain = await articles.byId(C3, { depth: 1, locale: 'de-DE' });

    assert.equal(chain?.title, 'Kette 3');
    assert.match(calls[0]?.url ?? '', /locale=de-DE/);
});

test('a list keeps the page order and hasMore, and hydrates each item', async () =>
{
    const { articles } = content();

    const page = await articles.list({ order: '-rank', limit: 3 });

    assert.deepEqual(page.items.map((item) => item._slug), ['chain-3', 'chain-2', 'chain-1']);
    assert.equal(page.hasMore, true);
});

test('byIds leaves out the ids that are not on the ref', async () =>
{
    const { client } = content();

    const found = await client.byIds([C2, ABSENT]);

    assert.deepEqual(found.map((entry) => entry._slug), ['chain-2']);
});

test('an issue is reported once for the life of the client, not once per read', async () =>
{
    const issues: Issue[] = [];
    const { articles } = content({
        shape: { article: { links: { related: 'many' }, always: ['body'] } },
        onIssue: (issue) => issues.push(issue),
    });

    await articles.list({ order: '-rank', limit: 3 });
    await articles.list({ order: '-rank', limit: 3 });

    assert.deepEqual(issues.map((issue) => issue.slug).sort(), ['chain-1', 'chain-2', 'chain-3']);
});
