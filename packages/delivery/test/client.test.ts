import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { CohoDeliveryError, createDeliveryClient } from '../src/index.ts';
import { BASE, KEY, OTHER_KEY, graph, replay } from './support.ts';
import type { Call } from './support.ts';

/** A fetch that answers every request with one response, recording what it was asked. */
function answering(response: () => Response): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return response();
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const ok = (headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify({ roots: [], entries: {}, unresolved: {}, hasMore: false }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });

/* REQUESTS */
/* REQUESTS */
/* REQUESTS */

test('requests go to the contract\'s paths, with the key in a header and the parameters in name order', async () => {
  const { fetch, calls } = answering(ok());
  const client = createDeliveryClient({ url: 'https://delivery.test/', project: 'p1', key: 'secret', fetch, cache: false });

  await client.entries('v1.0.0', { type: 'article', order: '-rank', limit: 3, locale: 'en-US' });
  await client.entryBySlug('release/1', 'a b');
  await client.entriesById('prod', ['id-2', 'id-1'], { depth: 1 });

  assert.deepEqual(calls.map((call) => call.url), [
    'https://delivery.test/v1/projects/p1/v1.0.0/entries?limit=3&locale=en-US&order=-rank&type=article',
    'https://delivery.test/v1/projects/p1/release%2F1/entries-by-slug/a%20b',
    'https://delivery.test/v1/projects/p1/prod/entries-by-id?depth=1&ids=id-2,id-1',
  ]);
  for (const call of calls) {
    assert.equal(call.headers['authorization'], 'Bearer secret');
    assert.equal(call.url.includes('secret'), false);
  }
});

test('a baseUrl replaces the url and project, for mounts they cannot express', async () => {
  const { fetch, calls } = answering(ok());
  const client = createDeliveryClient({ baseUrl: 'https://bff.test/api/accounts/acme/projects/p1/preview/', fetch, cache: false });

  await client.entries('feature/x');

  assert.equal(calls[0]?.url, 'https://bff.test/api/accounts/acme/projects/p1/preview/feature%2Fx/entries');
  assert.equal(calls[0]?.headers['authorization'], undefined);
});

test('a client needs a url and a project, or a baseUrl', () => {
  assert.throws(() => createDeliveryClient({ url: 'https://delivery.test' }), TypeError);
});

test('an empty id list asks nothing', async () => {
  const { fetch, calls } = answering(ok());
  const client = createDeliveryClient({ baseUrl: BASE, fetch });

  assert.deepEqual(await client.entriesById('v0.0.1', []), { roots: [], entries: {}, unresolved: {} });
  assert.equal(calls.length, 0);
});

/* RECORDED ANSWERS */
/* RECORDED ANSWERS */
/* RECORDED ANSWERS */

test('a recorded read comes back as the server sent it', async () => {
  const { fetch } = replay();
  const client = createDeliveryClient({ baseUrl: BASE, key: KEY, fetch });

  assert.deepEqual(await client.entryBySlug('v0.0.1', 'chain-1', { depth: 2, locale: 'en-US' }), graph('entry-by-slug-depth-2'));
  assert.deepEqual(await client.entries('v0.0.1', { type: 'article', order: '-rank', limit: 3, locale: 'en-US' }), graph('entries-ordered'));
});

test('a missing entry is null, not an error', async () => {
  const { fetch } = replay();
  const client = createDeliveryClient({ baseUrl: BASE, key: KEY, fetch });

  assert.equal(await client.entryBySlug('v0.0.1', 'nope'), null);
});

test('refusals throw with the server\'s code', async () => {
  const { fetch } = replay();
  const keyed = createDeliveryClient({ baseUrl: BASE, key: KEY, fetch });

  await assert.rejects(keyed.entries('v9.9.9'), { name: 'CohoDeliveryError', code: 'REF_NOT_FOUND', status: 404 });
  await assert.rejects(keyed.entries('v0.0.1', { order: 'rank' }), { code: 'INVALID_QUERY', status: 400 });
  await assert.rejects(createDeliveryClient({ baseUrl: BASE, fetch }).entries('v0.0.1'), { code: 'KEY_REQUIRED', status: 401 });
});

test('a key for another project says so, though delivery answers as if the project did not exist', async () => {
  const { fetch } = replay();
  const client = createDeliveryClient({ baseUrl: BASE, key: OTHER_KEY, fetch });

  await assert.rejects(client.entries('v0.0.1'), (error: unknown) => {
    assert.ok(error instanceof CohoDeliveryError);
    assert.equal(error.code, 'PROJECT_NOT_FOUND');
    assert.match(error.message, /key was issued for this project/);
    return true;
  });
});

test('an answer that is not a problem document is UNEXPECTED_RESPONSE', async () => {
  const { fetch } = answering(() => new Response('<h1>Bad gateway</h1>', { status: 502, headers: { 'content-type': 'text/html' } }));
  const client = createDeliveryClient({ baseUrl: BASE, fetch });

  await assert.rejects(client.entries('v0.0.1'), { code: 'UNEXPECTED_RESPONSE', status: 502 });
});

/* CACHING */
/* CACHING */
/* CACHING */

test('a tag named directly is fetched once', async () => {
  const { fetch, calls } = replay();
  const client = createDeliveryClient({ baseUrl: BASE, key: KEY, fetch });

  const first = await client.entryBySlug('v0.0.1', 'chain-1', { locale: 'en-US' });
  const second = await client.entryBySlug('v0.0.1', 'chain-1', { locale: 'en-US' });

  assert.equal(calls.length, 1);
  assert.equal(second, first);
});

test('an environment is revalidated after its max-age, and a 304 reuses the body', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  try {
    let status = 200;
    const { fetch, calls } = answering(() =>
      status === 304
        ? new Response(null, { status: 304, headers: { 'cache-control': 'public, max-age=30', etag: '"e1"' } })
        : ok({ 'cache-control': 'public, max-age=30', etag: '"e1"' })(),
    );
    const client = createDeliveryClient({ baseUrl: BASE, fetch });

    const first = await client.entries('prod');
    mock.timers.tick(10_000);
    await client.entries('prod');
    assert.equal(calls.length, 1, 'fresh for 30 seconds');

    mock.timers.tick(25_000);
    status = 304;
    const again = await client.entries('prod');
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.headers['if-none-match'], '"e1"');
    assert.equal(again, first);
  } finally {
    mock.timers.reset();
  }
});

test('no-store is never kept, and a client without a cache always asks', async () => {
  const noStore = answering(ok({ 'cache-control': 'no-store', etag: '"e1"' }));
  const storing = createDeliveryClient({ baseUrl: BASE, fetch: noStore.fetch });
  await storing.entries('prod');
  await storing.entries('prod');
  assert.equal(noStore.calls.length, 2);
  assert.equal(noStore.calls[1]?.headers['if-none-match'], undefined);

  const immutable = answering(ok({ 'cache-control': 'public, max-age=31536000, immutable' }));
  const uncached = createDeliveryClient({ baseUrl: BASE, fetch: immutable.fetch, cache: false });
  await uncached.entries('v1.0.0');
  await uncached.entries('v1.0.0');
  assert.equal(immutable.calls.length, 2);
});

test('a cached body cannot be changed by the caller it was given to', async () => {
  const { fetch } = replay();
  const client = createDeliveryClient({ baseUrl: BASE, key: KEY, fetch });

  const read = await client.entryBySlug('v0.0.1', 'chain-1', { locale: 'en-US' });
  assert.throws(() => {
    // Past the readonly types on purpose: the freeze is what stops it at runtime.
    (read as unknown as { roots: string[] }).roots.push('x');
  }, TypeError);
});
