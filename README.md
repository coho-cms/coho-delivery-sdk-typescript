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

1. Bump all three versions to the same new one, such as `0.1.1`, and merge.
2. Tag [coho-template-typescript](https://github.com/coho-cms/coho-template-typescript) at the commit to ship.
3. Run the **Publish** workflow, naming that tag and the dist-tag: `latest` for a release, or `alpha` for a prerelease such as `0.2.0-alpha.1`, which `latest` must never point at. It tests, bundles the template into `create-coho`, and publishes all three.
4. Tag this repository at the release commit, such as `v0.1.1`.

Versions follow semver within 0.x: a fix is a patch, `0.1.1`, and a change that breaks a generated library or the runtime's API is a minor, `0.2.0`, which `^0.1.0` does not take.

A version cannot be published twice. The workflow needs `NPM_TOKEN`, an npm token that can publish `create-coho` and the `@coho-cms` scope without a one-time password.

To try `create-coho` from a checkout before publishing, bundle a template into it, or pass `--template`:

```bash
npm run bundle -w create-coho -- ../coho-template-typescript
```

## License

Apache-2.0
