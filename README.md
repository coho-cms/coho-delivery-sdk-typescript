# coho-delivery-sdk-typescript

TypeScript packages for reading content from Coho CMS.

| Package | What it is |
|---|---|
| [`@coho-cms/delivery`](packages/delivery) | The delivery client, and the runtime generated content libraries call |
| [`@coho-cms/codegen`](packages/codegen) | Generates a typed content library from your project's content types |
| [`create-coho`](packages/create-coho) | `npm create coho@latest`: creates your content library. Not released yet |

## Development

Node 22.18 or later, which runs the TypeScript tests directly.

```bash
npm install
npm test
npm run typecheck
npm run build
```

`spec/` is a copy of [coho-sdk-spec](https://github.com/coho-cms/coho-sdk-spec): recorded delivery responses and type model fixtures, produced by the Coho server. The tests run against it, so these packages agree with the server. Don't edit it by hand.

## Publishing

While in testing, `@coho-cms/delivery` and `@coho-cms/codegen` are published to GitHub Packages as alphas, not to npm. Bump both versions (`0.1.0-alpha.2`, and so on), merge, and run the **Publish** workflow. A version cannot be published twice.

Installing from GitHub Packages needs a token even for public packages: a personal access token (classic) with `read:packages`, as `NODE_AUTH_TOKEN`, and an `.npmrc` that sends the scope there:

```
@coho-cms:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

A package published for the first time is private. Make each one public once, in its settings on GitHub, so other repositories' workflows can install it.

## License

Apache-2.0
