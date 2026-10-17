/**
 * The delivery API's response shapes, as it sends them.
 *
 * Read-only throughout: a response may be shared with the client's cache, so it is
 * never changed in place.
 */

/** One entry: one locale's values, flattened. */
export interface Entry
{
    readonly id: string;

    /** Unique on its ref. */
    readonly slug: string;

    /** The content type's slug. */
    readonly type: string;

    /** The locale this entry was projected for. Absent when none was requested. */
    readonly locale?: string;

    /**
     * The author's fields. A localized field with no value in the requested locale
     * is absent, not null. A reference holds an entry id, or an array of them.
     */
    readonly fields: Readonly<Record<string, unknown>>;
}

/**
 * Why a requested or referenced entry is not in `entries`. `depth` means it is
 * beyond the requested depth; `absent` means it is not on the ref. Open, so a
 * reason the server adds later does not break parsing.
 */
export type UnresolvedReason = 'depth' | 'absent' | (string & {});

/** What every read returns: the roots, everything reached from them, and what was not. */
export interface EntryGraph
{
    /** The entries asked for that exist, in the order the read defines. */
    readonly roots: readonly string[];

    /** The roots and every entry reached from them, keyed by id. */
    readonly entries: Readonly<Record<string, Entry>>;

    readonly unresolved: Readonly<Record<string, UnresolvedReason>>;
}

/** A page of a list. */
export interface EntryList extends EntryGraph
{
    readonly hasMore: boolean;
}

/** An RFC 9457 problem document. Branch on `code`, not on the status. */
export interface Problem
{
    readonly code: string;
    readonly title: string;
    readonly status: number;
    readonly type?: string;
    readonly detail?: string;
}
