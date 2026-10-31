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
- **A field is optional when delivery can leave it out**, which includes every localized field, in a repeater's items too. A choice accepts values added after generation, so new content never breaks the build.
- **References are typed by their targets**: `Linked<TeamMember>`, which is the entry, or a stub saying why it is not there.
- **An asset field is an `Asset | null`**, or a `readonly Asset[]` when it holds several, and an `ImageAsset` when it accepts only raster images, which always have dimensions and resize. A single asset is nullable even when required, because an asset deleted on the ref is delivered as null; in a list it is left out. Build its URLs with `imageUrl` and `srcset` from `@coho-cms/delivery`, or `<CohoImage>` from `@coho-cms/react`. Delivery does not serve asset fields yet (coho-data doc 40 §14.6).
- **A repeater holds typed items.** Each component type is an interface of its own, `Citation` in `Citation.ts`, with `_id` and `_type` beside its fields, and a repeater is a list of them: `readonly Citation[]`, or `readonly (Callout | Quote)[]` when it holds several. Switch on `_type` to narrow an item. An item of a component added after the code was generated is left out of the list, and reported, so an item is never typed as something it is not. A repeater whose components are not on the ref holds `RepeaterItem`s, typed by their `_id` alone. Needs a type model of 1.2 or later.
- **A type that others extend is read and linked as its family.** Delivery lists a type with the types that extend it, so `coho.page` reads `AnyPage`, the union of `Page` and every type below it, and a reference to `page` is a `Linked<AnyPage>`; a repeater of a base component holds any component in its family. Each interface is flat, with every field it inherits, and an abstract type's `_type` is any of its descendants', so every member of a family is assignable to its base: `Page` is the fields they share. `AnyPage` is in `Page.ts`. Needs a type model of 1.3 or later.
- **A trait is an interface every type with it extends.** `Seo`, in `Seo.ts`, has the fields the trait declares, and `interface Article extends runtime.EntryBase<"article">, Seo, Publishing` says the article has them, as it has every trait its parent has. So a function that takes a `Seo` takes an entry of any type with the trait. A trait is not a type: it has no reader and is in no `AnyEntry`. Needs a type model of 1.4 or later.
- **A list holds plain values**: `readonly string[]` for text and date-times, and `readonly number[]` for integers and numbers. Its `min` and `max` count its values, and it is never sortable. A localized list is the requested locale's array, where an empty one is a value, none in that locale, and a locale with no translation leaves the field out. References and assets that hold several are still `readonly Linked<…>[]` and `readonly Asset[]`. Needs a type model of 1.5 or later; an older generator types a list `unknown`, with a warning.
- **`order` accepts only fields the type can be sorted by**, so an unsortable order is a compile error rather than a refused request.
- **`AnyEntry`** is the union of every type an entry can be, so not an abstract one; switch on `_type` to narrow it. `source` names the tag the code was generated from.
- **The library reads no environment.** The app passes the delivery key to `createCoho`.

If a type's name would collide with one the generated code defines (`Coho`, `AnyEntry`, `Linked`, `Unresolved`, `RepeaterItem`), or with `index.ts` (`Index`), its interface gets `Entry` after it. Two types whose files differ only in case, such as `BlogPost.ts` and `Blogpost.ts`, are refused: they would be one file on macOS and Windows. A type slugged `bySlug`, `byId` or `byIds` is read as `coho.<slug>Type`. A family whose `Any<Type>` name a type already has is named `<Type>Family`. `generate` says when any of these happens.

## License

Apache-2.0
