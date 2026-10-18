# @coho-cms/codegen

Generates a typed content library from your Coho CMS content types: one TypeScript interface per content type, and a client whose reads return them.

It belongs in your content library, the package your sites and services install, as a dev dependency beside `@coho-cms/delivery`. `npm create coho@latest` sets that library up for you.

```bash
npm install --save-dev @coho-cms/codegen
npm install --save-peer @coho-cms/delivery
```

## Commands

```bash
coho-codegen pull       # fetch the type model for the configured ref into coho-ir.json
coho-codegen generate   # write src/coho/ from coho-ir.json: a file per type, and index.ts
coho-codegen check      # fail if src/coho differs from what generate would write
```

Commit `coho-ir.json` and `src/coho/`. `generate` removes the files of types no longer on the ref, and leaves anything it did not write. A schema change then shows up as a diff in review, and `check` in CI catches generated code that is out of date. `generate` and `check` never call the server.

`pull` needs `COHO_TOKEN`: a project token with read access. It is read from the environment, or for local runs from a `.env` file beside the config, and never from the config itself. Keep it in CI secrets and out of every app that installs the library. `pull --ref v1.4.0` pulls another tag than the config names. An unchanged type model costs a `304`.

## Configuration

`coho.config.json`, next to your `package.json`. Paths are relative to it.

```json
{
  "url": "https://app.coho.example",
  "account": "0192…",
  "project": "0192…",
  "ref": "v1.4.0",
  "typeModel": "coho-ir.json",
  "outDir": "src/coho"
}
```

Generate from a tag for a release. A branch's types can change, and `generate` warns when the model came from one.

## What is generated

```ts
import { createCoho, isResolved } from '@acme/content';

const coho = createCoho({
  url: 'https://delivery.coho.example',
  project: '0192…',
  key: process.env.COHO_DELIVERY_KEY,
  ref: 'prod',
  locale: 'en-US',
});

const post = await coho.blogPost.bySlug('hello-world', { depth: 2 });
const latest = await coho.blogPost.list({ order: '-publishedAt', limit: 3 });
```

- **One interface per content type, in its own file**, named from its slug: `blogPost` becomes `BlogPost`, in `BlogPost.ts`. `index.ts` exports them all, with `createCoho`. Its fields sit beside the system keys `_id`, `_type`, `_slug` and `_locale`.
- **A field is optional when delivery can leave it out**, which includes every localized field. A choice accepts values added after generation, so new content never breaks the build.
- **References are typed by their targets**: `Linked<TeamMember>`, which is the entry, or a stub saying why it is not there.
- **An asset field is an `Asset | null`**, or a `readonly Asset[]` when it holds several, and an `ImageAsset` when it accepts only raster images, which always have dimensions and resize. A single asset is nullable even when required, because an asset deleted on the ref is delivered as null; in a list it is left out. Build its URLs with `imageUrl` and `srcset` from `@coho-cms/delivery`, or `<CohoImage>` from `@coho-cms/react`. Delivery does not serve asset fields yet (coho-data doc 40 §14.6).
- **`order` accepts only fields the type can be sorted by**, so an unsortable order is a compile error rather than a refused request.
- **`AnyEntry`** is the union of every type; switch on `_type` to narrow it. `source` names the tag the code was generated from.
- **The library reads no environment.** The app passes the delivery key to `createCoho`.

If a type's name would collide with one the generated code defines (`Coho`, `AnyEntry`, `Linked`, `Unresolved`, `RepeaterItem`), or with `index.ts` (`Index`), its interface gets `Entry` after it. Two types whose files differ only in case, such as `BlogPost.ts` and `Blogpost.ts`, are refused: they would be one file on macOS and Windows. A type slugged `bySlug`, `byId` or `byIds` is read as `coho.<slug>Type`. `generate` says when either happens.

## License

Apache-2.0
