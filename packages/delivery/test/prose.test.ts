import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assetReference, bodyAssets, referencedSlug, resolveEntry, resolveProse } from '../src/index.ts'
import type { Asset } from '../src/index.ts'

/*
 * Resolving what a body points at (coho-data doc 80 ML-1).
 *
 * The rule has to match the server's, which is why it is here rather than in each
 * application. These hold it to the three shapes the portal writes, and to leaving
 * everything else — a reference nothing can place included — exactly as it was.
 */

const bridge: Asset = { id: 'e1', slug: 'bridge-at-dusk', url: 'https://assets.test/a/h1/bridge.jpg' }
const tour: Asset = { id: 'e2', slug: 'ring-road', url: 'https://assets.test/a/h2/tour.mp4' }
const sheet: Asset = { id: 'e3', slug: 'datasheet-2026', url: 'https://assets.test/a/h3/d.pdf' }
const assets = [bridge, tour, sheet]

test('an image, a video directive and a download link each resolve', () =>
{
    assert.equal(resolveProse('![A bridge](asset:bridge-at-dusk)', assets), `![A bridge](${bridge.url})`)
    assert.equal(resolveProse('::video[The tour]{src="asset:ring-road"}', assets), `::video[The tour]{src="${tour.url}"}`)
    assert.equal(resolveProse('[The datasheet](asset:datasheet-2026)', assets), `[The datasheet](${sheet.url})`)
})

test('a Markdown title survives, and an HTML attribute resolves too', () =>
{
    assert.equal(resolveProse('![A bridge](asset:bridge-at-dusk "At dusk")', assets), `![A bridge](${bridge.url} "At dusk")`)
    assert.equal(resolveProse('<img src="asset:bridge-at-dusk">', assets), `<img src="${bridge.url}">`)
    assert.equal(resolveProse("<video poster='asset:bridge-at-dusk'>", assets), `<video poster='${bridge.url}'>`)
})

test('only an attribute that fetches, and only when the value is the whole reference', () =>
{
    // `alt` fetches nothing, and a URL with the text inside it is not a reference.
    assert.equal(resolveProse('<img alt="asset:bridge-at-dusk">', assets), '<img alt="asset:bridge-at-dusk">')
    assert.equal(resolveProse('[x](https://other.test/asset:bridge-at-dusk)', assets), '[x](https://other.test/asset:bridge-at-dusk)')
    // Bare text is not a reference either, so a body can write about the scheme.
    assert.equal(resolveProse('Write asset:bridge-at-dusk to name it.', assets), 'Write asset:bridge-at-dusk to name it.')
})

test('a reference the entry does not carry is left exactly as written', () =>
{
    assert.equal(resolveProse('![Not here](asset:not-here-yet)', assets), '![Not here](asset:not-here-yet)')
    // An asset with no URL cannot be resolved to either.
    assert.equal(resolveProse('![A](asset:pending)', [{ id: 'e4', slug: 'pending' }]), '![A](asset:pending)')
})

test('an entry resolves at any depth, its repeater items included', () =>
{
    const entry = {
        _slug: 'home',
        _bodyAssets: assets,
        title: 'Home',
        modules: [
            { _id: 'm1', _type: 'proseModule', body: '![A bridge](asset:bridge-at-dusk)' },
            { _id: 'm2', _type: 'noteModule', note: 'See [the sheet](asset:datasheet-2026).' },
        ],
    }

    const resolved = resolveEntry(entry)
    assert.equal(resolved.modules[0]!.body, `![A bridge](${bridge.url})`)
    assert.equal(resolved.modules[1]!.note, `See [the sheet](${sheet.url}).`)
    assert.equal(resolved.title, 'Home')
})

test("a linked entry resolves against its own record, not the page's", () =>
{
    const other: Asset = { id: 'e9', slug: 'cone-field', url: 'https://assets.test/a/h9/cones.png' }
    const page = {
        _bodyAssets: [bridge],
        body: '![A bridge](asset:bridge-at-dusk)',
        featured: { _bodyAssets: [other], body: '![Cones](asset:cone-field)' },
    }

    const resolved = resolveEntry(page)
    assert.equal(resolved.body, `![A bridge](${bridge.url})`)
    assert.equal(resolved.featured.body, `![Cones](${other.url})`)
})

test('an entry with nothing to resolve is returned as it is, not copied', () =>
{
    const entry = { _slug: 'plain', body: '![A bridge](asset:bridge-at-dusk)' }

    assert.equal(resolveEntry(entry), entry)
    assert.deepEqual(bodyAssets(entry), [])
    assert.deepEqual(bodyAssets(undefined), [])
    assert.deepEqual(bodyAssets({ _bodyAssets: 'not a list' }), [])
})

test('a reference reads back as the slug it names', () =>
{
    assert.equal(assetReference('bridge-at-dusk'), 'asset:bridge-at-dusk')
    assert.equal(referencedSlug('asset:bridge-at-dusk'), 'bridge-at-dusk')
    assert.equal(referencedSlug('https://assets.test/a/h1/bridge.jpg'), undefined)
    assert.equal(referencedSlug('asset:'), undefined)
    assert.equal(referencedSlug('asset:not a slug'), undefined)
    assert.equal(referencedSlug(42), undefined)
})
