import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContentClient, createDeliveryClient, imageUrl, srcset } from '../src/index.ts';
import type { Asset, EntryBase, ImageAsset } from '../src/index.ts';
import { BASE, KEY, replay } from './support.ts';

/**
 * An entry with assets as delivery 2.1.0 actually sent it (the `entry-with-assets`
 * recording), read through the client and the asset helpers.
 */

const FIGURE = '00000000-0000-7000-8000-0000000000f1';
const PHOTO = '00000000-0000-7000-8000-0000000000e1';
const MISSING = '00000000-0000-7000-8000-0000000000ef';

/** What generated code declares for the delivery fixture's `figure` type. */
interface Figure extends EntryBase<'figure'>
{
    readonly caption?: string;
    readonly image?: Asset | null;
    readonly poster?: Asset | null;
    readonly gallery?: readonly Asset[];
}

function figures()
{
    const { fetch } = replay();
    // The recording asked with no locale.
    const client = createContentClient({ baseUrl: BASE, key: KEY, ref: 'v0.0.1', locale: undefined, fetch }, { figure: {} });
    return client.type<Figure>('figure');
}

test('an embedded asset is read through as the asset, with its file and URLs', async () =>
{
    const figure = await figures().byId(FIGURE);

    const image = figure?.image;
    assert.ok(image);
    assert.equal(image.id, PHOTO);
    assert.equal(image.alt, 'A suspension bridge at dusk');
    assert.deepEqual(image.focalPoint, { x: 0.25, y: 0.75 });
    assert.equal(image.file?.width, 1600);
    assert.match(image.url ?? '', /\/a\/1{64}\/Bridge%20at%20dusk\.jpg$/);
});

test('the helpers build resized URLs from a delivered image, and only the original for anything else', async () =>
{
    const figure = await figures().byId(FIGURE);
    const [photo, logo, brochure] = figure?.gallery ?? [];
    assert.ok(photo && logo && brochure);

    assert.match(imageUrl(photo, { width: 400, height: 400, fit: 'fill' }), /\/i\/1{64}\/Bridge%20at%20dusk\.jpg\?w=400&h=400&fit=fill&fx=0\.25&fy=0\.75$/);
    // An ImageAsset is what a field accepting only raster images is typed as.
    const image: ImageAsset = photo as ImageAsset;
    // Widths up to the original's 1600, and none beyond: the edge never enlarges.
    assert.ok(srcset(image).includes(' 1440w'));
    assert.ok(!srcset(image).includes(' 1920w'));
    assert.equal(imageUrl(logo, { width: 400 }), logo.url);
    assert.equal(srcset(brochure), brochure.url);
});

test('a missing asset is null in a single field and left out of a list', async () =>
{
    const figure = await figures().byId(FIGURE);

    assert.equal(figure?.poster, null);
    assert.deepEqual(figure?.gallery?.map((asset) => asset.id), [PHOTO, '00000000-0000-7000-8000-0000000000e2', '00000000-0000-7000-8000-0000000000e3']);
});

test('the raw client carries the warnings that name what is missing', async () =>
{
    const { fetch } = replay();
    const delivery = createDeliveryClient({ baseUrl: BASE, key: KEY, fetch });

    const graph = await delivery.entry('v0.0.1', FIGURE);

    assert.deepEqual(graph?.warnings, [
        { code: 'ASSET_MISSING', entry: FIGURE, field: 'gallery', asset: MISSING },
        { code: 'ASSET_MISSING', entry: FIGURE, field: 'poster', asset: MISSING },
    ]);
});
