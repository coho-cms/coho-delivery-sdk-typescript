import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContentClient, hydrate } from '../src/index.ts';
import type { EntryBase, EntryGraph, Issue, ItemBase } from '../src/index.ts';
import { BASE, KEY, graph, replay } from './support.ts';

/**
 * An entry whose items hold items (type model 1.6), as delivery actually sent it (the
 * `entry-with-nested-items` recording), read with the shape generated code writes,
 * which lists the components each component's repeaters hold as well.
 */

const OUTLINE = '00000000-0000-7000-8000-0000000000b1';

/** What generated code declares for the delivery fixture's `point` component, which holds itself. */
interface Point extends ItemBase<'point'>
{
    readonly text?: string;
    readonly children?: readonly Point[];
}

interface Note extends ItemBase<'note'>
{
    readonly text?: string;
}

interface OutlineSection extends ItemBase<'outlineSection'>
{
    readonly heading?: string;
    readonly points?: readonly Point[];
    readonly notes?: readonly Note[];
}

interface Outline extends EntryBase<'outline'>
{
    readonly sections?: readonly OutlineSection[];
}

const shape = {
    outline: { items: { sections: ['outlineSection'] } },
    outlineSection: { items: { points: ['point'], notes: ['note'] } },
    point: { items: { children: ['point'] } },
};

test('items inside items arrive at every level, each with its _id and _type', async () =>
{
    const { fetch } = replay();
    const issues: Issue[] = [];
    const client = createContentClient({ baseUrl: BASE, key: KEY, ref: 'v0.0.1', locale: 'en-US', fetch, onIssue: (issue) => issues.push(issue) }, shape);
    const outline = await client.type<Outline>('outline').byId(OUTLINE);

    const [section] = outline?.sections ?? [];
    assert.ok(section);
    assert.equal(section._type, 'outlineSection');
    assert.equal(section.heading, 'Plan');
    const first = section.points?.[0];
    const second = first?.children?.[0];
    const third = second?.children?.[0];
    assert.deepEqual([first?._id, second?._id, third?._id], [
        '00000000-0000-7000-8000-0000000000b3',
        '00000000-0000-7000-8000-0000000000b4',
        '00000000-0000-7000-8000-0000000000b5',
    ]);
    assert.deepEqual([first?.text, second?.text], ['Survey', 'Measure']);
    // Written in pt-BR only, so left out in en-US.
    assert.ok(third);
    assert.equal(third._type, 'point');
    assert.equal('text' in third, false);
    // A localized repeater is the locale's list.
    assert.deepEqual(section.notes?.map((note) => note.text), ['Bring cones']);
    assert.deepEqual(issues, []);
});

test('a nested item of a component the shape does not list is left out where it is, and its siblings are kept', () =>
{
    const recorded = graph('entry-with-nested-items');
    const entry = recorded.entries[OUTLINE];
    assert.ok(entry);
    const [section] = entry.fields['sections'] as readonly OutlineSection[];
    assert.ok(section);
    const [first] = section.points ?? [];
    assert.ok(first);
    const added: EntryGraph = {
        ...recorded,
        entries: {
            [OUTLINE]: {
                ...entry,
                fields: {
                    sections: [
                        {
                            ...section,
                            notes: [...(section.notes ?? []), { _id: 'n2', _type: 'sticker' }],
                            points: [{ ...first, children: [...(first.children ?? []), { _id: 'x1', _type: 'poll' }, { _id: 'x2', _type: 'poll' }, { _id: 'p2', _type: 'point', text: 'Mark' }] }],
                        },
                    ],
                },
            },
        },
    };

    const issues: Issue[] = [];
    const [outline] = hydrate(added, shape, { onIssue: (issue) => issues.push(issue) }) as Outline[];
    const kept = outline?.sections?.[0];
    assert.deepEqual(kept?.points?.[0]?.children?.map((point) => point._id), ['00000000-0000-7000-8000-0000000000b4', 'p2']);
    // Three levels down, untouched by what was left out beside it.
    assert.equal(kept?.points?.[0]?.children?.[0]?.children?.[0]?._id, '00000000-0000-7000-8000-0000000000b5');
    assert.deepEqual(kept?.notes?.map((note) => note._id), ['00000000-0000-7000-8000-0000000000b6']);
    // Once for each place, named by its path in the entry.
    assert.deepEqual(issues.map((issue) => `${issue.kind} ${issue.field}`), [
        'unknown-item sections/0/notes',
        'unknown-item sections/0/points/0/children',
    ]);
    assert.match(issues[1]?.message ?? '', /has an item of 'poll' in 'sections\/0\/points\/0\/children'/);
    // Hydration builds new items; what delivery sent is unchanged.
    assert.equal((added.entries[OUTLINE]?.fields['sections'] as OutlineSection[])[0]?.points?.[0]?.children?.length, 4);
});

test('a component the shape has no entry for keeps the items it holds as delivery sent them', () =>
{
    const recorded = graph('entry-with-nested-items');
    const [outline] = hydrate(recorded, { outline: { items: { sections: ['outlineSection'] } } });

    assert.deepEqual(outline?.['sections'], recorded.entries[OUTLINE]?.fields['sections']);
});
