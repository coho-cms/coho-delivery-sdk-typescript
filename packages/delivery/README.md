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

## Keys

The delivery key is sent as `Authorization: Bearer` and never in a URL. Keep it on the server: a key in a browser bundle is a key anyone can read.

## Caching

Each client keeps a private cache of responses, following `Cache-Control` and `ETag`. A tag named directly is fetched once. An environment is reused for its short `max-age`, then revalidated, which costs a `304` when nothing was promoted. Pass `cache: false` to turn it off.

## Errors

A refusal throws `CohoDeliveryError`. Branch on its `code`: `REF_NOT_FOUND`, `KEY_REQUIRED`, `PROJECT_NOT_FOUND`, `INVALID_QUERY` or `RESOLUTION_LIMIT` for the request; `ARTIFACT_UNREADABLE` or `POOL_UNAVAILABLE` for the server; or `UNEXPECTED_RESPONSE` for an answer that isn't a problem document. A missing entry is `null`, not an error.

## License

Apache-2.0
