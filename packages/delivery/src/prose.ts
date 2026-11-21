import type { Asset } from './assets.ts'

/**
 * Turning an `asset:` reference in a body into the file it names (coho-data doc 80 ML-1).
 *
 * A Markdown or HTML field names an asset by **slug** — `![A bridge](asset:bridge-at-dusk)`
 * — rather than by URL, so the body carries no asset domain, survives being moved between
 * branches, and is seen by everything that counts a file as used. Nothing renders that on
 * its own: Coho records what the prose named in the entry's `_bodyAssets`, delivery embeds
 * those assets as it embeds any asset field, and this turns one into the other.
 *
 * It is here rather than in each application because the rule is not obvious and has to
 * match the server's: three copies of these patterns already exist, and every consumer
 * that renders a body would otherwise write a fourth.
 *
 * ## ⚠️ Resolve at the read, and never before a write
 *
 * Call this where an entry arrives, once, rather than at each place a body is drawn — a
 * body usually reaches more than one renderer, and the version that none of them can
 * forget is the one at the read.
 *
 * ⛔ **Never resolve a body you may write back.** A resolved body holds URLs, and saving
 * one destroys the reference the scheme exists to keep: the asset stops counting as used,
 * the link breaks when the file is replaced, and moving the entry to another project
 * carries the old domain with it. Anything that edits content — an editor, a migration, a
 * script that reads and saves — must keep the body exactly as delivered.
 *
 * ## ⚠️ What an unresolved reference does
 *
 * A reference to an asset the entry does not carry is **left exactly as written**. That is
 * an asset not merged onto this ref, or a slug typed by hand; an image then falls back to
 * its alt text. Rewriting it to nothing would hide it, and throwing would stop a page over
 * one figure.
 */

/** The scheme a body names an asset by. */
export const ASSET_SCHEME = 'asset:'

/** The key Coho records an entry's prose assets under. */
export const BODY_ASSETS = '_bodyAssets'

/** A slug's shape, as the server reads one. These must agree. */
const SLUG = '[A-Za-z0-9][A-Za-z0-9._-]*'

/** `![alt](asset:slug)` and `[label](asset:slug)`, with Markdown's optional title after it. */
const TARGET = new RegExp(`(!?\\[[^\\]]*\\]\\(\\s*)${ASSET_SCHEME}(${SLUG})(\\s*(?:"[^"]*")?\\s*\\))`, 'g')

/**
 * `src`, `href` or `poster` naming an asset: a video directive's attribute in Markdown, or
 * an attribute in an HTML field. Only attributes that fetch something, and only when the
 * whole value is the reference — so `alt="asset:x"` and a URL with the text inside it are
 * not mistaken for one.
 */
const ATTRIBUTE = new RegExp(`(\\b(?:src|href|poster)\\s*=\\s*["'])${ASSET_SCHEME}(${SLUG})(["'])`, 'g')

/** [slug] as a body names it. */
export function assetReference(slug: string): string
{
    return `${ASSET_SCHEME}${slug}`
}

/** The slug [value] references, or undefined when it is an ordinary URL or anything else. */
export function referencedSlug(value: unknown): string | undefined
{
    if (typeof value !== 'string' || !value.startsWith(ASSET_SCHEME)) return undefined
    const slug = value.slice(ASSET_SCHEME.length)
    return new RegExp(`^${SLUG}$`).test(slug) ? slug : undefined
}

/** The assets an entry carries for its prose, or none when it has no prose or names nothing. */
export function bodyAssets(entry: unknown): readonly Asset[]
{
    const held = (entry as Record<string, unknown> | null | undefined)?.[BODY_ASSETS]
    return Array.isArray(held) ? held.filter((a) => a !== null && typeof a === 'object') as Asset[] : []
}

/** Slug to URL, for the assets that have both: one with no URL cannot be resolved to. */
function urls(assets: readonly Asset[]): Map<string, string>
{
    const by = new Map<string, string>()
    for (const asset of assets)
    {
        if (asset.slug && asset.url) by.set(asset.slug, asset.url)
    }
    return by
}

/** [text] with every `asset:` reference [assets] can place replaced by that asset's URL. */
export function resolveProse(text: string, assets: readonly Asset[]): string
{
    if (!text.includes(ASSET_SCHEME)) return text
    const by = urls(assets)
    if (by.size === 0) return text

    const swap = (whole: string, before: string, slug: string, after: string) =>
    {
        const url = by.get(slug)
        return url === undefined ? whole : `${before}${url}${after}`
    }
    return text.replace(TARGET, swap).replace(ATTRIBUTE, swap)
}

/**
 * [entry] with every `asset:` reference in it resolved, at any depth: its own prose, the
 * prose of every repeater item it holds, and any entry it links.
 *
 * **Each entry resolves against its own `_bodyAssets`.** A linked entry read in the same
 * graph carries its own, so a page does not resolve a linked article's figures against its
 * own list.
 *
 * Strings only, and only ones holding the scheme, so a field that is not prose comes back
 * as it was. What did not change is returned as the same object rather than a copy, so an
 * entry with no references — almost all of them — is returned identical.
 *
 * ⛔ The warning above applies here most of all: the result is for rendering, never for
 * saving.
 */
export function resolveEntry<T>(entry: T): T
{
    const walk = (value: unknown, assets: readonly Asset[]): unknown =>
    {
        if (typeof value === 'string') return resolveProse(value, assets)

        if (Array.isArray(value))
        {
            const next = value.map((held) => walk(held, assets))
            return next.some((held, i) => held !== value[i]) ? next : value
        }

        if (value !== null && typeof value === 'object')
        {
            const own = bodyAssets(value)
            const here = own.length > 0 ? own : assets
            const held = Object.entries(value)
            const next = held.map(([key, each]) => [key, walk(each, here)] as const)
            return next.some(([, each], i) => each !== held[i]![1]) ? Object.fromEntries(next) : value
        }

        return value
    }
    return walk(entry, bodyAssets(entry)) as T
}
