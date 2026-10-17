/**
 * A private cache of delivery responses, honouring `Cache-Control` and `ETag`.
 *
 * Private is what makes it allowed: the client holds the key, so it may keep keyed
 * responses that a shared cache must not. A tag named directly is `immutable` for a
 * year and is fetched once. An environment is fresh for its short `max-age`, then
 * revalidated with `If-None-Match`, which costs a `304` rather than a body when
 * nothing was promoted.
 */
export interface Cached
{
    readonly body: unknown;
    readonly etag: string | undefined;

    /** Until when, in milliseconds since the epoch, the body may be used without asking. */
    readonly freshUntil: number;
}

/** Bounded, least recently used out first. */
export class ResponseCache
{
    private readonly maxEntries: number;
    private readonly entries = new Map<string, Cached>();

    constructor(maxEntries: number)
    {
        this.maxEntries = maxEntries;
    }

    get(url: string): Cached | undefined
    {
        const cached = this.entries.get(url);
        if (cached !== undefined)
        {
            // A Map iterates in insertion order, so re-inserting marks it most recent.
            this.entries.delete(url);
            this.entries.set(url, cached);
        }
        return cached;
    }

    set(url: string, cached: Cached): void
    {
        this.entries.delete(url);
        this.entries.set(url, cached);
        if (this.entries.size > this.maxEntries)
        {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) this.entries.delete(oldest);
        }
    }

    delete(url: string): void
    {
        this.entries.delete(url);
    }
}

/**
 * Until when a response may be used without asking, from its `Cache-Control`, or
 * null when it must not be stored at all. A response that makes no claim is stale
 * at once, so it is only ever reused after a `304`.
 */
export function freshUntil(cacheControl: string | null, now: number): number | null
{
    let noStore = false;
    let noCache = false;
    let maxAge: number | undefined;

    for (const directive of (cacheControl ?? '').split(','))
    {
        const [name = '', value] = directive.trim().toLowerCase().split('=', 2);
        if (name === 'no-store') noStore = true;
        else if (name === 'no-cache') noCache = true;
        else if (name === 'max-age' && value !== undefined)
        {
            const seconds = Number(value);
            if (Number.isInteger(seconds) && seconds >= 0) maxAge = seconds;
        }
    }

    if (noStore) return null;
    if (noCache || maxAge === undefined) return now;
    return now + maxAge * 1000;
}

/** Freezes a parsed body, so a caller cannot change what later callers are served. */
export function deepFreeze<T>(value: T): T
{
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value))
    {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}
