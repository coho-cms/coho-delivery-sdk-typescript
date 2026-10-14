import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configFromEnv, createContentClient } from '../src/index.ts';

const TOKEN = `coho_pt_${'a'.repeat(43)}`;

test('a delivery key reads released content from delivery', () => {
  assert.deepEqual(
    configFromEnv({
      COHO_DELIVERY_URL: 'https://delivery.test',
      COHO_DELIVERY_KEY: 'k',
      COHO_PROJECT: 'p1',
      COHO_REF: 'prod',
      COHO_LOCALE: 'en-US',
    }),
    { url: 'https://delivery.test', key: 'k', project: 'p1', ref: 'prod', locale: 'en-US' },
  );
});

test('a preview token previews unreleased content through Coho', () => {
  assert.deepEqual(
    configFromEnv({ COHO_URL: 'https://coho.test', COHO_ACCOUNT: 'acme', COHO_PROJECT: 'p1', COHO_REF: 'dev', COHO_PREVIEW_TOKEN: TOKEN }),
    { url: 'https://coho.test', account: 'acme', token: TOKEN, project: 'p1', ref: 'dev', locale: undefined },
  );
});

test('a public environment needs no key, and an empty variable is unset', () => {
  const config = configFromEnv({ COHO_DELIVERY_URL: 'https://delivery.test', COHO_DELIVERY_KEY: '', COHO_PROJECT: 'p1', COHO_REF: 'prod', COHO_PREVIEW_TOKEN: ' ' });
  assert.equal(config.key, undefined);
  assert.equal(config.token, undefined);
});

test('what is missing is named, for what is being read', () => {
  assert.throws(() => configFromEnv({ COHO_PROJECT: 'p1' }), /COHO_DELIVERY_URL, COHO_REF are needed to read released content/);
  assert.throws(
    () => configFromEnv({ COHO_PREVIEW_TOKEN: TOKEN, COHO_PROJECT: 'p1', COHO_REF: 'dev' }),
    /COHO_URL, COHO_ACCOUNT are needed to read a preview, since COHO_PREVIEW_TOKEN is set/,
  );
});

test('a key and a preview token together are refused, not chosen between', () => {
  assert.throws(
    () => configFromEnv({ COHO_URL: 'u', COHO_ACCOUNT: 'a', COHO_DELIVERY_URL: 'u', COHO_PROJECT: 'p', COHO_REF: 'dev', COHO_DELIVERY_KEY: 'k', COHO_PREVIEW_TOKEN: TOKEN }),
    /not both/,
  );
});

test('what it returns is what a content client takes', async () => {
  const calls: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    calls.push(String(input));
    return new Response(JSON.stringify({ roots: [], entries: {}, unresolved: {}, hasMore: false }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
    });
  };
  const env = { COHO_URL: 'https://coho.test', COHO_ACCOUNT: 'acme', COHO_PROJECT: 'p1', COHO_REF: 'dev', COHO_PREVIEW_TOKEN: TOKEN };

  await createContentClient({ ...configFromEnv(env), fetch: fetch as typeof globalThis.fetch }).type('article').list();

  assert.deepEqual(calls, ['https://coho.test/api/v1/accounts/acme/projects/p1/preview/dev/entries?type=article']);
});
