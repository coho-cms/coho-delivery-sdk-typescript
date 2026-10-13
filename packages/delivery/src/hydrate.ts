import type { Entry, EntryGraph } from './types.ts';

/** Whether a reference field holds one link or an array of them. */
export type LinkKind = 'one' | 'many';

/**
 * What hydration needs to know about one content type. Generated code writes it
 * from the type model. Untyped callers may write one by hand, or pass none, in
 * which case references stay ids.
 */
export interface TypeShape {
  /** The reference fields, by field id. */
  readonly links?: Readonly<Record<string, LinkKind>>;
  /** The fields delivery always includes: required, and not localized. */
  readonly always?: readonly string[];
}

/** Type shapes, by content type slug. */
export type Shape = Readonly<Record<string, TypeShape>>;

/**
 * The system keys on every hydrated entry. A field id cannot begin with `_`, so
 * these can never collide with a field, whatever a type declares.
 */
export interface EntryBase<T extends string = string> {
  readonly _id: string;
  readonly _type: T;
  readonly _slug: string;
  /** The locale the entry was projected for. Absent when none was requested. */
  readonly _locale?: string;
}

/** An entry's fields beside its system keys, untyped. */
export type HydratedEntry = EntryBase & { readonly [field: string]: unknown };

/** Where a reference's target would be, and why it is not. */
export interface Unresolved {
  readonly _id: string;
  /**
   * `depth` and `absent` as delivery reports them: beyond the requested depth, or
   * not on the ref. `cycle` where following the link would close a loop.
   */
  readonly _unresolved: 'depth' | 'absent' | 'cycle' | (string & {});
}

/** A reference: its target, or a stub saying why the target is not here. */
export type Linked<T> = T | Unresolved;

export function isResolved<T>(value: Linked<T>): value is T {
  return !(typeof value === 'object' && value !== null && '_unresolved' in value);
}

/** Something about an entry that its type says cannot happen. Reported, never thrown. */
export interface Issue {
  /**
   * `missing-field`: a field the type always has is absent, as old entries are after
   * a field becomes required. `unexpected-value`: one link where the type says many,
   * or the other way round. `unlisted-link`: a link delivery neither resolved nor
   * reported, which means the shape and the content disagree about the field.
   */
  readonly kind: 'missing-field' | 'unexpected-value' | 'unlisted-link';
  readonly id: string;
  readonly slug: string;
  readonly type: string;
  readonly field: string;
  readonly message: string;
}

export interface HydrateOptions {
  /** Called once for each issue found. Defaults to `console.warn`. */
  readonly onIssue?: (issue: Issue) => void;
}

/**
 * The graph's roots, in order, with each reference replaced by its target or a stub.
 *
 * The result is plain data: no classes, getters or dates, and no cycles, so it
 * survives `JSON.stringify` and a server-to-client component boundary unchanged.
 * Each root gets its own pass, so its tree holds everything reachable from it.
 * Within a pass an entry is built once and shared, and a link back to an entry
 * still being built becomes a `cycle` stub, which is what keeps the result acyclic.
 */
export function hydrate(graph: EntryGraph, shape: Shape = {}, options: HydrateOptions = {}): HydratedEntry[] {
  const onIssue = options.onIssue ?? warn;
  const reported = new Set<string>();
  const report = (kind: Issue['kind'], entry: Entry, field: string, what: string): void => {
    const key = `${kind} ${entry.id} ${field}`;
    if (reported.has(key)) return;
    reported.add(key);
    onIssue({ kind, id: entry.id, slug: entry.slug, type: entry.type, field, message: `${entry.type} '${entry.slug}' ${what}` });
  };

  return graph.roots.flatMap((rootId) => {
    const root = graph.entries[rootId];
    if (root === undefined) return [];

    const built = new Map<string, HydratedEntry>();
    const building = new Set<string>();

    const follow = (from: Entry, field: string, value: unknown): unknown => {
      // Not an id: left as delivery sent it.
      if (typeof value !== 'string') return value;
      const done = built.get(value);
      if (done !== undefined) return done;
      if (building.has(value)) return stub(value, 'cycle');
      const target = graph.entries[value];
      if (target !== undefined) return build(target);
      const reason = graph.unresolved[value];
      if (reason === undefined) {
        report('unlisted-link', from, field, `links '${field}' to ${value}, which delivery neither returned nor reported`);
      }
      return stub(value, reason ?? 'absent');
    };

    const build = (entry: Entry): HydratedEntry => {
      building.add(entry.id);
      const type = shape[entry.type];
      const out: Record<string, unknown> = { _id: entry.id, _type: entry.type, _slug: entry.slug };
      if (entry.locale !== undefined) out['_locale'] = entry.locale;

      for (const [field, value] of Object.entries(entry.fields)) {
        const kind = type?.links?.[field];
        if (kind === undefined || value === null) out[field] = value;
        else if (kind === 'many' && Array.isArray(value)) out[field] = value.map((id) => follow(entry, field, id));
        else if (kind === 'one' && !Array.isArray(value)) out[field] = follow(entry, field, value);
        else {
          report('unexpected-value', entry, field, `has ${kind === 'many' ? 'one link' : 'several links'} in '${field}', where its type has ${kind === 'many' ? 'several' : 'one'}`);
          out[field] = value;
        }
      }

      for (const field of type?.always ?? []) {
        if (!(field in entry.fields)) report('missing-field', entry, field, `has no '${field}', which its type requires`);
      }

      building.delete(entry.id);
      const result = out as HydratedEntry;
      built.set(entry.id, result);
      return result;
    };

    return [build(root)];
  });
}

function stub(id: string, reason: Unresolved['_unresolved']): Unresolved {
  return { _id: id, _unresolved: reason };
}

function warn(issue: Issue): void {
  console.warn(`[coho] ${issue.message}`);
}
