# create-coho

Creates your content library for Coho CMS: a TypeScript package, generated from your project's content types, that your sites and services install.

```bash
npm create coho@alpha acme-content
```

It copies the [library template](https://github.com/coho-cms/coho-template-typescript), names the package, points it at your Coho project, and installs. In a terminal it asks for anything you didn't pass; a blank answer keeps the template's placeholder, to fill in `coho.config.json` later. Pass options after `--`:

```bash
npm create coho@alpha acme-content -- --name @acme/content --project 0192… --ref v1.4.0
```

| Option | |
|---|---|
| `--name <package>` | The package name, such as `@acme/content` |
| `--url <url>` | The Coho URL |
| `--account <id>`, `--project <id>` | Your account and project |
| `--ref <tag>` | The tag to generate from |
| `--template <folder \| owner/repo#ref>` | Another template than the one bundled with this version |
| `--no-install` | Don't run `npm install` |
| `-y`, `--yes` | Ask nothing |

**A version of create-coho always creates the same library.** It carries the template it was released with, and pins the library to `@coho-cms/delivery` and `@coho-cms/codegen` at its own version. `create-coho@0.1.0-alpha.3` creates libraries on `0.1.0-alpha.3`.

A checkout's `.git`, `node_modules`, `dist` and `.env` are never copied, so a template folder with your own token in it is safe to pass to `--template`.

## In testing

Releases are alphas, under the `alpha` dist-tag, so `npm create coho@alpha` reaches them. The version under `latest` is a placeholder until the first release.

## License

Apache-2.0
