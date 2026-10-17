import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hydrate, isResolved } from '../src/index.ts';
import type { EntryGraph, HydratedEntry, Issue, Shape } from '../src/index.ts';
import { graph } from './support.ts';

const C1 = '00000000-0000-7000-8000-0000000000c1';
const C2 = '00000000-0000-7000-8000-0000000000c2';
const C3 = '00000000-0000-7000-8000-0000000000c3';
const ABSENT = '00000000-0000-7000-8000-0000000000ff';

const shape: Shape = { article: { links: { related: 'many' } } };

/** The `related` links of an entry, as hydration left them. */
const related = (entry: unknown): HydratedEntry[] => (entry as { related: HydratedEntry[] }).related;

test('a depth-2 read is a tree: links resolve, the dangling one is absent, and the way back to the root is a cycle', () =>
{
  const [root] = hydrate(graph('entry-by-slug-depth-2'), shape);
  assert.ok(root);

  assert.equal(root._slug, 'chain-1');
  const [two] = related(root);
  assert.equal(two?._slug, 'chain-2');
  const [three, absent] = related(two);
  assert.equal(three?._slug, 'chain-3');
  assert.deepEqual(absent, { _id: ABSENT, _unresolved: 'absent' });
  assert.deepEqual(related(three), [{ _id: C1, _unresolved: 'cycle' }]);

  // No cycles, so the tree survives serialization.
  assert.doesNotThrow(() => JSON.stringify(root));
});

test('a link beyond the requested depth is a depth stub', () =>
{
  const [root] = hydrate(graph('entry-by-slug'), shape);
  assert.deepEqual(related(root), [{ _id: C2, _unresolved: 'depth' }]);
});

test('without a shape, references stay ids', () =>
{
  const [root] = hydrate(graph('entry-by-slug-depth-2'));
  assert.deepEqual(related(root), [C2]);
});

test('system keys sit beside the fields, and a field named like one is untouched', () =>
{
  const entry = { id: 'e1', slug: 'thing', type: 'product', locale: 'en-US', fields: { id: 'SKU-1', type: 'widget', slug: 'x', locale: 'fr' } };
  const [hydrated] = hydrate({ roots: ['e1'], entries: { e1: entry }, unresolved: {} });

  assert.deepEqual(hydrated, {
    _id: 'e1', _type: 'product', _slug: 'thing', _locale: 'en-US',
    id: 'SKU-1', type: 'widget', slug: 'x', locale: 'fr',
  });
});

test('each root has its own tree, so a root met on another root\'s path is not cut short', () =>
{
  // The page is chain-3, chain-2, chain-1, each linking to the next round the loop.
  const items = hydrate(graph('entries-ordered'), shape);
  assert.deepEqual(items.map((item) => item._slug), ['chain-3', 'chain-2', 'chain-1']);

  // chain-2 is on chain-3's path, and still resolves chain-3 in its own tree.
  const fromTwo = related(items[1])[0];
  assert.equal(fromTwo?._slug, 'chain-3');
  assert.ok(isResolved(fromTwo));
});

test('a field the type always has, missing from an entry, is reported once per entry, and the entry is still returned', () =>
{
  const issues: Issue[] = [];
  const strict: Shape = { article: { links: { related: 'many' }, always: ['body'] } };

  const items = hydrate(graph('entries-ordered'), strict, { onIssue: (issue) => issues.push(issue) });

  assert.equal(items.length, 3);
  // Every chain entry lacks `body`, and each appears in all three trees.
  assert.deepEqual(
    issues.map(({ kind, slug, field }) => `${kind} ${slug} ${field}`).sort(),
    ['missing-field chain-1 body', 'missing-field chain-2 body', 'missing-field chain-3 body'],
  );
  assert.equal(issues[0]?.message.includes("has no 'body'"), true);
});

test('a link delivery neither returned nor reported is reported, and becomes an absent stub', () =>
{
  const issues: Issue[] = [];
  const unlisted: EntryGraph = {
    roots: ['a'],
    entries: { a: { id: 'a', slug: 'a', type: 'article', fields: { related: ['zzz'] } } },
    unresolved: {},
  };

  const [root] = hydrate(unlisted, shape, { onIssue: (issue) => issues.push(issue) });

  assert.deepEqual(related(root), [{ _id: 'zzz', _unresolved: 'absent' }]);
  assert.deepEqual(issues.map((issue) => issue.kind), ['unlisted-link']);
});

test('one link where the type has many is reported, and passed through', () =>
{
  const issues: Issue[] = [];
  const single: EntryGraph = {
    roots: [C1],
    entries: { [C1]: { id: C1, slug: 'chain-1', type: 'article', fields: { related: C2 } } },
    unresolved: { [C2]: 'depth' },
  };

  const [root] = hydrate(single, shape, { onIssue: (issue) => issues.push(issue) });

  assert.equal(root?.['related'], C2);
  assert.deepEqual(issues.map((issue) => issue.kind), ['unexpected-value']);
});

test('a null link stays null and is not reported', () =>
{
  const issues: Issue[] = [];
  const empty: EntryGraph = {
    roots: ['a'],
    entries: { a: { id: 'a', slug: 'a', type: 'article', fields: { related: null } } },
    unresolved: {},
  };

  const [root] = hydrate(empty, shape, { onIssue: (issue) => issues.push(issue) });

  assert.equal(root?.['related'], null);
  assert.deepEqual(issues, []);
});

test('isResolved tells a target from a stub', () =>
{
  assert.equal(isResolved({ _id: C3, _unresolved: 'depth' }), false);
  assert.equal(isResolved({ _id: C3, _type: 'article', _slug: 'chain-3' }), true);
});
