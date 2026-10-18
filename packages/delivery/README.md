# @coho-cms/delivery

The Coho CMS delivery client, and the runtime your generated content library calls.

Most projects don't import this directly. They install their own content library, generated from their content types, which depends on this package and gives every content type its own typed reads. Use this package directly for untyped access, or for anything the generated reads don't cover.

```bash
npm install @coho-cms/delivery
```

## Untyped reads

```ts
import { createDeliveryClient } from '@coho-cms/delivery';

const delivery = createDeliveryClient({
  url: 'https://delivery.coho.example',
  project: '0192…',
  key: process.env.COHO_DELIVERY_KEY,
});

const home = await delivery.entryBySlug('prod', 'home-page', { depth: 2, locale: 'en-US' });
// { roots: [id], entries: { [id]: entry }, unresolved: { [id]: 'depth' | 'absent' } }, or null
```

`entries`, `entry`, `entryBySlug` and `entriesById` return the delivery API's response as it was sent: the entries you asked for in `roots`, everything they reference within `depth` hops in `entries`, and anything referenced but not returned in `unresolved`.

## Hydrated reads

`createContentClient` returns entries with their references replaced by the entries they point at. It is what generated libraries are built on.

```ts
import { createContentClient, isResolved, type EntryBase, type Linked } from '@coho-cms/delivery';

// What a generated library declares for you.
interface Author extends EntryBase<'author'> { fullName: string }
interface BlogPost extends EntryBase<'blogPost'> { title?: string; publishedAt: string; author?: Linked<Author> }

const content = createContentClient(
  { url: 'https://delivery.coho.example', project: '0192…', key: process.env.COHO_DELIVERY_KEY, ref: 'prod', locale: 'en-US' },
  { blogPost: { links: { author: 'one' }, always: ['publishedAt'] } },
);

const post = await content.type<BlogPost, 'publishedAt'>('blogPost').bySlug('hello-world', { depth: 2 });
if (post?.author && isResolved(post.author)) console.log(post.author.fullName);
```

- **Entries are plain data**, with their fields beside the system keys `_id`, `_type`, `_slug` and `_locale`. A field id cannot start with `_`, so the two never collide. Results survive `JSON.stringify` and a server-to-client component boundary.
- **A reference that is not resolved is a stub**, `{ _id, _unresolved }`: `depth` when it is beyond the requested depth, `absent` when it is not on the ref, and `cycle` where following it would loop back.
- **Problems are reported, not thrown.** An entry missing a field its type always has, which happens to older entries after a field becomes required, is passed to `onIssue`, once per entry and field. The default is `console.warn`.

## Released and unreleased content

What a client reads depends on its credential.

| | Released | Unreleased (a preview) |
|---|---|---|
| Refs | Tags, and environments pointing at one, such as `qa` and `prod` | Branches, and environments pointing at one, such as `dev` |
| Served by | Delivery, cached at the edge | Coho, live, never cached |
| `url` | Delivery's, such as `https://delivery.coho.example` | Coho's own, where you sign in, such as `https://api.coho.example` |
| Credential | `key`: a delivery key | `token`: a project token, `coho_pt_…`, with the viewer role, plus the `account` |

```ts
const preview = createDeliveryClient({
  url: 'https://api.coho.example',
  account: '0191…',
  project: '0192…',
  token: process.env.COHO_PREVIEW_TOKEN!,
});

const draft = await preview.entryBySlug('dev', 'home-page', { depth: 2, locale: 'en-US' });
```

Both answer the same requests in the same shapes, so a preview runs the code production does. Create a token for previews with `coho token create --role viewer`, separate from any token your content library uses to pull its types.

**Keep both on the server.** A credential is sent as `Authorization: Bearer` and never in a URL, but a key or token in a browser bundle is one anyone can read, and a token reads everything unreleased. A client given a token refuses to start in a browser.

### From the environment

`configFromEnv` turns environment variables into a config, so whether a deployment previews or reads releases is a matter of its variables:

```ts
import { configFromEnv, createContentClient } from '@coho-cms/delivery';

const content = createContentClient(configFromEnv(process.env));
```

| Variable | |
|---|---|
| `COHO_PROJECT`, `COHO_REF` | Always |
| `COHO_LOCALE` | Optional |
| `COHO_DELIVERY_URL`, `COHO_DELIVERY_KEY` | Released content. The key may be left out for a public environment |
| `COHO_PREVIEW_TOKEN`, `COHO_URL`, `COHO_ACCOUNT` | A preview |

Setting a preview token and a delivery key together is refused, since they read different content. For a Next.js app, put them in `.env.local`, never with a `NEXT_PUBLIC_` prefix.

## Assets

`imageUrl`, `srcset` and `downloadUrl` build an asset's URLs from what the asset carries: no request, no secret, so they work on the server and in a browser alike. For React, `@coho-cms/react` wraps them in `<CohoImage>` and `<CohoAssetLink>`.

```ts
import { downloadUrl, imageUrl, srcset } from '@coho-cms/delivery';

imageUrl(post.hero, { width: 800, format: 'auto' });                     // resized at the edge
imageUrl(post.hero, { width: 400, height: 400, fit: 'fill' });           // cropped around its focal point
srcset(post.hero, { format: 'auto' });                                    // 640w … up to the original
srcset(post.hero, { width: 300, densities: [1, 2] });                     // 1x, 2x
downloadUrl(post.brochure);                                               // the original, as an attachment
```

- **Only raster images resize.** An SVG, a PDF or any other file has only its original, which `imageUrl` and `srcset` return whatever the options.
- **The edge snaps widths up** to `IMAGE_WIDTHS`, so a `srcset` built from them lands on cached images. A crop (`fill`, `crop`, `thumb`) centres on the asset's focal point.
- **`downloadUrl` adds `dl=1`**, since a browser ignores `download` on a link to another origin. The edge does not honour it yet, so until it does the file opens in the browser.
- **An asset is as public as its URL**, drafts included, and deleting it does not stop the URL working.

The asset shape is the asset API's (`url`, `imageUrl`, `file`, `focalPoint`, `alt`, `title`). Delivery does not serve asset fields yet.

## Caching

Each client keeps a private cache of responses, following `Cache-Control` and `ETag`. A tag named directly is fetched once. An environment is reused for its short `max-age`, then revalidated, which costs a `304` when nothing was promoted. A preview is fetched every time. Pass `cache: false` to turn it off.

## Errors

A refusal throws `CohoDeliveryError`. Branch on its `code`: `REF_NOT_FOUND`, `KEY_REQUIRED`, `PROJECT_NOT_FOUND`, `INVALID_QUERY` or `RESOLUTION_LIMIT` for the request; `ARTIFACT_UNREADABLE` or `POOL_UNAVAILABLE` for the server; or `UNEXPECTED_RESPONSE` for an answer that isn't a problem document. A preview adds `UNAUTHENTICATED`, for a token that has expired or been revoked, and `ACCOUNT_SUSPENDED`, `ACCOUNT_CLOSED` and `USER_SUSPENDED`. A missing entry is `null`, not an error.

## License

Apache-2.0
