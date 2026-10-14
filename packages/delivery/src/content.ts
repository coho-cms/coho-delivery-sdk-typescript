import { createDeliveryClient } from './client.ts';
import type { DeliveryClient, DeliveryConfig, ReadOptions } from './client.ts';
import { hydrate } from './hydrate.ts';
import type { HydratedEntry, Issue, Shape } from './hydrate.ts';
import type { EntryGraph } from './types.ts';

/** What a content client reads, on top of where it reads it from. */
export interface ContentOptions {
  /**
   * The ref to read: an environment such as `prod`, or a tag. With a project token,
   * a branch, or an environment pointing at one such as `dev`.
   */
  readonly ref: string;
  /** The locale to project to, unless a read names its own. */
  readonly locale?: string;
  /** Called once per issue, for the life of the client. Defaults to `console.warn`. */
  readonly onIssue?: (issue: Issue) => void;
}

export type ContentConfig = DeliveryConfig & ContentOptions;

/** A page of hydrated entries. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
}

export interface TypeListOptions<O extends string> extends ReadOptions {
  /** A sortable field of the type, prefixed `-` for descending. */
  readonly order?: O | `-${O}`;
  readonly limit?: number;
  readonly offset?: number;
}

/** Reads of one content type, hydrated as `T`. `O` names its sortable fields. */
export interface TypeReader<T = HydratedEntry, O extends string = string> {
  /** The entry with this slug, or null if there is none or it is of another type. */
  bySlug(slug: string, options?: ReadOptions): Promise<T | null>;
  /** The entry with this id, or null if there is none or it is of another type. */
  byId(id: string, options?: ReadOptions): Promise<T | null>;
  list(options?: TypeListOptions<O>): Promise<Page<T>>;
}

/**
 * Hydrated reads on one ref. What generated code builds its typed client from, so
 * that the logic lives in this package and reaches every library with an update.
 */
export interface ContentClient<Any = HydratedEntry> {
  /** The untyped client underneath, for anything the hydrated reads do not cover. */
  readonly delivery: DeliveryClient;
  /** The entry with this slug, whatever its type, or null. */
  bySlug(slug: string, options?: ReadOptions): Promise<Any | null>;
  /** The entry with this id, whatever its type, or null. */
  byId(id: string, options?: ReadOptions): Promise<Any | null>;
  /** The entries that exist, sorted by id. Ids not on the ref are left out. */
  byIds(ids: readonly string[], options?: ReadOptions): Promise<Any[]>;
  /**
   * Reads of one content type. Generated code names `T` and the sortable fields `O`;
   * without them, entries are untyped and any field may be ordered by.
   */
  type<T = HydratedEntry, O extends string = string>(slug: string): TypeReader<T, O>;
}

export function createContentClient<Any = HydratedEntry>(config: ContentConfig, shape: Shape = {}): ContentClient<Any> {
  const delivery = createDeliveryClient(config);

  // Once per issue for the life of the client rather than per read, so a page
  // rendered a thousand times reports its broken entry once.
  const onIssue = config.onIssue ?? ((issue: Issue) => console.warn(`[coho] ${issue.message}`));
  const reported = new Set<string>();
  const report = (issue: Issue): void => {
    const key = `${issue.kind} ${issue.id} ${issue.field}`;
    if (reported.has(key)) return;
    reported.add(key);
    onIssue(issue);
  };

  const options = (asked: ReadOptions = {}): ReadOptions => ({ depth: asked.depth, locale: asked.locale ?? config.locale });
  const all = (graph: EntryGraph): HydratedEntry[] => hydrate(graph, shape, { onIssue: report });
  const first = (graph: EntryGraph | null): HydratedEntry | null => (graph === null ? null : all(graph)[0] ?? null);

  return {
    delivery,
    bySlug: async (slug, asked) => first(await delivery.entryBySlug(config.ref, slug, options(asked))) as Any | null,
    byId: async (id, asked) => first(await delivery.entry(config.ref, id, options(asked))) as Any | null,
    byIds: async (ids, asked) => all(await delivery.entriesById(config.ref, ids, options(asked))) as Any[],

    type: <T = HydratedEntry, O extends string = string>(slug: string): TypeReader<T, O> => {
      // A slug is unique per ref, not per type, so a typed read checks what it found.
      const ofType = (entry: HydratedEntry | null): T | null => (entry !== null && entry._type === slug ? (entry as T) : null);
      return {
        bySlug: async (entrySlug, asked) => ofType(first(await delivery.entryBySlug(config.ref, entrySlug, options(asked)))),
        byId: async (id, asked) => ofType(first(await delivery.entry(config.ref, id, options(asked)))),
        list: async (asked = {}) => {
          const page = await delivery.entries(config.ref, {
            ...options(asked),
            type: slug,
            order: asked.order,
            limit: asked.limit,
            offset: asked.offset,
          });
          return { items: all(page) as T[], hasMore: page.hasMore };
        },
      };
    },
  };
}
