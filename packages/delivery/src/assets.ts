/**
 * URLs for assets: an image resized on request, a set of widths for `srcset`, and a
 * file to download. Built from what the asset carries, with no request and no secret,
 * so they work wherever an entry is rendered, on the server or in a browser.
 *
 * The edge serves an asset two ways (coho-data doc 40 §5, §6): `url`, the original
 * bytes of any file, and for raster images only `imageUrl`, which resizes on request
 * from query parameters. The edge normalizes what it is sent, snapping widths up to
 * {@link IMAGE_WIDTHS}, so these functions only spell the request; they never resize.
 *
 * ⚠️ An asset is as public as its URL, drafts included, and deleting it does not stop
 * its URL working (doc 40 §7.0).
 */

/**
 * An asset, as Coho describes it: the shape of the asset API's responses, which
 * delivery is to serve for an entry's asset fields. Only what URLs are built from is
 * required; the rest is there for the page, such as `alt` for an image.
 */
export interface Asset
{
    /** The original bytes, from the asset CDN. */
    readonly url?: string;

    /** Raster images only: the base that resizes on request. */
    readonly imageUrl?: string;

    readonly file?: AssetFile;

    /** Where a crop centres, as fractions of the width and height. */
    readonly focalPoint?: { readonly x: number; readonly y: number };

    readonly title?: string;
    readonly alt?: string;
}

/** The bytes behind an asset, as the server sniffed them. */
export interface AssetFile
{
    readonly filename?: string;
    readonly mediaType?: string;
    readonly byteSize?: number;

    /** Raster images only, as is `height`. */
    readonly width?: number;

    readonly height?: number;
}

/**
 * How to resize an image. `scale`, the default fit, keeps the aspect ratio; `fill`
 * crops to exactly `width`×`height` around the focal point, as `crop` and `thumb` do.
 */
export interface ImageOptions
{
    readonly width?: number;
    readonly height?: number;
    readonly fit?: 'scale' | 'pad' | 'fill' | 'crop' | 'thumb';

    /** `auto` lets the edge pick AVIF, WebP or JPEG from what the browser accepts. */
    readonly format?: 'auto' | 'avif' | 'webp' | 'jpg' | 'png';

    /** 1 to 100. The edge rounds to a multiple of 5; its default is 75. */
    readonly quality?: number;

    /** The colour around a `pad`, as `rrggbb`. */
    readonly background?: string;
}

/**
 * The widths the edge serves. A requested width snaps up to the next one, so a
 * `srcset` built from these lands on cached images. Close to Next.js's default
 * device and image sizes, which makes them a good fit for `next/image` too.
 */
export const IMAGE_WIDTHS: readonly number[] = [
    16, 32, 48, 64, 96, 128, 192, 256, 320, 384, 480, 640, 750, 828, 960, 1080, 1200, 1440, 1600, 1920, 2048,
    2560, 3840,
];

/** The widths a responsive `srcset` offers by default: phones up to large screens. */
const RESPONSIVE_WIDTHS = IMAGE_WIDTHS.filter((width) => width >= 640);

/**
 * The asset's URL, resized when `options` asks for it. A file that is not a raster
 * image, such as an SVG or a PDF, has no resizing, so its original is returned
 * whatever the options. Throws if the asset has no URL at all.
 */
export function imageUrl(asset: Asset, options: ImageOptions = {}): string
{
    const query = imageQuery(asset, options);
    if (query === '' || asset.imageUrl === undefined) return originalUrl(asset);
    return `${asset.imageUrl}?${query}`;
}

/** What `srcset` builds: one width, or one pixel density. */
export interface SrcsetOptions extends ImageOptions
{
    /**
     * The widths to offer, for an image whose displayed width the page's `sizes`
     * describes. Defaults to the edge's widths from 640 up. Ignored with `densities`.
     */
    readonly widths?: readonly number[];

    /**
     * Pixel densities for an image shown at a fixed `width`, such as `[1, 2]` for
     * standard and high-density screens. Needs `width`.
     */
    readonly densities?: readonly number[];
}

/**
 * A `srcset` for the asset: `url 640w, url 750w, …` for a responsive image, or
 * `url 1x, url 2x` with `densities`. Widths beyond the original are left out, since
 * the edge never enlarges. A file that is not a raster image has one candidate, its
 * original.
 */
export function srcset(asset: Asset, options: SrcsetOptions = {}): string
{
    const { widths, densities, ...image } = options;
    if (asset.imageUrl === undefined) return originalUrl(asset);

    const ratio = image.width !== undefined && image.height !== undefined ? image.height / image.width : undefined;
    const at = (width: number): string =>
        imageUrl(asset, { ...image, width, height: ratio === undefined ? undefined : Math.round(width * ratio) });

    if (densities !== undefined)
    {
        if (image.width === undefined) throw new TypeError('srcset with densities needs a width');
        const base = image.width;
        return densities.map((density) => `${at(Math.round(base * density))} ${density}x`).join(', ');
    }

    const largest = asset.file?.width;
    const offered = [...new Set(widths ?? RESPONSIVE_WIDTHS)]
        .filter((width) => largest === undefined || width <= largest)
        .sort((a, b) => a - b);
    // An image smaller than every width offered is still offered, at its own size.
    if (offered.length === 0 && largest !== undefined) offered.push(largest);
    return offered.map((width) => `${at(width)} ${width}w`).join(', ');
}

/**
 * A URL that downloads the asset rather than opening it: the original, with `dl=1`
 * asking the edge to send it as an attachment under its filename. A browser ignores
 * the `download` attribute on a link to another origin, which the asset CDN is, so the
 * edge has to say it.
 *
 * ⚠️ The edge does not honour `dl` yet (doc 40 §5.1). Until it does, the file opens in
 * the browser as `url` does; the link needs no change when it starts to.
 */
export function downloadUrl(asset: Asset): string
{
    const url = originalUrl(asset);
    return `${url}${url.includes('?') ? '&' : '?'}dl=1`;
}

/** The query the edge resizes from, in a fixed order, so equal options make equal URLs. */
function imageQuery(asset: Asset, options: ImageOptions): string
{
    const { width, height, fit, format, quality, background } = options;
    const params: [string, string | number | undefined][] = [
        ['w', width],
        ['h', height],
        ['fit', fit],
        ['fm', format],
        ['q', quality],
        ['bg', background],
    ];
    // The edge cannot look the focal point up, so a crop is told where to centre.
    const focal = asset.focalPoint;
    if (focal !== undefined && (fit === 'fill' || fit === 'crop' || fit === 'thumb'))
    {
        params.push(['fx', round2(focal.x)], ['fy', round2(focal.y)]);
    }
    return params
        .filter((param): param is [string, string | number] => param[1] !== undefined)
        .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
        .join('&');
}

function originalUrl(asset: Asset): string
{
    if (asset.url === undefined) throw new TypeError('This asset has no URL: the deployment serving it has no asset CDN');
    return asset.url;
}

function round2(value: number): number
{
    return Math.round(value * 100) / 100;
}
