# coho-delivery-sdk-typescript

TypeScript packages for reading content from Coho CMS.

| Package | What it is |
|---|---|
| [`@coho-cms/delivery`](packages/delivery) | The delivery client, and the runtime generated content libraries call |
| [`@coho-cms/codegen`](packages/codegen) | Generates a typed content library from your project's content types |
| [`create-coho`](packages/create-coho) | `npm create coho`: creates your content library from the template |

## Development

Node 22.18 or later, which runs the TypeScript tests directly.

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
```

`npm run lint -- --fix` reformats. Allman braces: an opening brace goes on its own line.

`spec/` is a copy of [coho-sdk-spec](https://github.com/coho-cms/coho-sdk-spec): recorded delivery responses and type model fixtures, produced by the Coho server. The tests run against it, so these packages agree with the server. Don't edit it by hand.

## Publishing

The three packages are published to npm together, at one version: `create-coho` pins every library it creates to that version of `@coho-cms/delivery` and `@coho-cms/codegen`, and carries the library template inside it.

1. Bump all three versions to the same new one, such as `2026.1.1`, and merge.
2. Tag [coho-template-typescript](https://github.com/coho-cms/coho-template-typescript) at the commit to ship, with the release tag: `release-v` and the version, such as `release-v2026.1.1`.
3. Push the same tag here, at the release commit. It runs the **Publish** workflow, which takes the version from the tag, tests, bundles the template from the template's tag into `create-coho`, and publishes all three: under `latest` for a release, or under the prerelease's name for one such as `release-v2026.2.0-alpha.1`, so `latest` never points at a prerelease.

Versions match the release branch, `2026.1.0` from `v2026.1.0`, and a fix is a patch, `2026.1.1`. The tags carry `release-` so they never share a name with a branch.

A version cannot be published twice. There is no npm token: each package has this repository's `publish.yml` as its trusted publisher on npmjs.com.

To try `create-coho` from a checkout before publishing, bundle a template into it, or pass `--template`:

```bash
npm run bundle -w create-coho -- ../coho-template-typescript
```

## License

Apache-2.0
