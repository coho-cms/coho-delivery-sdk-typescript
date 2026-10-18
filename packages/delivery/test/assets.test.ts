import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadUrl, IMAGE_WIDTHS, imageUrl, srcset } from '../src/index.ts';
import type { Asset } from '../src/index.ts';

const BASE = 'https://assets.test/p1';

const PHOTO: Asset = {
    url: `${BASE}/a/abc/culvert.png`,
    imageUrl: `${BASE}/i/abc/culvert.png`,
    file: { filename: 'culvert.png', mediaType: 'image/png', width: 2000, height: 1000 },
    focalPoint: { x: 0.25, y: 0.333 },
    alt: 'A culvert under Elm Street',
};

const PDF: Asset = {
    url: `${BASE}/a/def/roundabout-functionality.pdf`,
    file: { filename: 'roundabout-functionality.pdf', mediaType: 'application/pdf', byteSize: 52000 },
};

test('an image with no options is its original', () =>
{
    assert.equal(imageUrl(PHOTO), PHOTO.url);
});

test('a resize goes to the image base, its parameters in a fixed order', () =>
{
    assert.equal(
        imageUrl(PHOTO, { quality: 80, format: 'auto', width: 800 }),
        `${BASE}/i/abc/culvert.png?w=800&fm=auto&q=80`,
    );
});

test('a crop centres on the focal point, rounded to two decimals', () =>
{
    assert.equal(
        imageUrl(PHOTO, { width: 400, height: 400, fit: 'fill' }),
        `${BASE}/i/abc/culvert.png?w=400&h=400&fit=fill&fx=0.25&fy=0.33`,
    );
    // A scale keeps the whole image, so it has nothing to centre.
    assert.equal(imageUrl(PHOTO, { width: 400, fit: 'scale' }), `${BASE}/i/abc/culvert.png?w=400&fit=scale`);
});

test('a file that is not a raster image is its original whatever the options', () =>
{
    assert.equal(imageUrl(PDF, { width: 400 }), PDF.url);
    assert.equal(srcset(PDF), PDF.url);
});

test('a responsive srcset offers the edge widths from 640, up to the original', () =>
{
    const candidates = srcset(PHOTO, { format: 'auto' }).split(', ');
    assert.deepEqual(
        candidates.map((candidate) => candidate.split(' ')[1]),
        IMAGE_WIDTHS.filter((width) => width >= 640 && width <= 2000).map((width) => `${width}w`),
    );
    assert.equal(candidates[0], `${BASE}/i/abc/culvert.png?w=640&fm=auto 640w`);
});

test('given widths are sorted and deduplicated, and a crop keeps its shape at each', () =>
{
    assert.equal(
        srcset(PHOTO, { widths: [800, 400, 800], width: 400, height: 200, fit: 'fill' }),
        [
            `${BASE}/i/abc/culvert.png?w=400&h=200&fit=fill&fx=0.25&fy=0.33 400w`,
            `${BASE}/i/abc/culvert.png?w=800&h=400&fit=fill&fx=0.25&fy=0.33 800w`,
        ].join(', '),
    );
});

test('an image smaller than every width is offered at its own size', () =>
{
    const icon: Asset = { ...PHOTO, file: { width: 120, height: 120 } };
    assert.equal(srcset(icon), `${BASE}/i/abc/culvert.png?w=120 120w`);
});

test('densities give 1x and 2x of a fixed width', () =>
{
    assert.equal(
        srcset(PHOTO, { width: 300, densities: [1, 2] }),
        `${BASE}/i/abc/culvert.png?w=300 1x, ${BASE}/i/abc/culvert.png?w=600 2x`,
    );
    assert.throws(() => srcset(PHOTO, { densities: [1, 2] }), /needs a width/);
});

test('a download is the original, asked for as an attachment', () =>
{
    assert.equal(downloadUrl(PDF), `${PDF.url}?dl=1`);
    assert.equal(downloadUrl({ url: 'https://assets.test/a?v=1' }), 'https://assets.test/a?v=1&dl=1');
});

test('an asset with no URL is refused, not linked to nothing', () =>
{
    assert.throws(() => downloadUrl({}), /no URL/);
    assert.throws(() => imageUrl({}), /no URL/);
});
