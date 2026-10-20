# create-coho

Creates your content library for Coho CMS: a TypeScript package, generated from your project's content types, that your sites and services install.

```bash
npm create coho acme-content
```

It copies the [library template](https://github.com/coho-cms/coho-template-typescript), names the package, points it at your Coho project, and installs. In a terminal it asks for anything you didn't pass, and doesn't show the token as you type it. A blank answer keeps the template's placeholder, to fill in `coho.config.json` later. Pass options after `--`:

```bash
npm create coho acme-content -- --name @acme/content --url https://app.coho.example --ref v1.4.0
```

**Give it Coho's URL and a project token, and nothing else.** A token belongs to one project, so Coho tells `create-coho` which account and project the library is for: there are no ids to copy. The token goes in the library's `.env`, which is in its `.gitignore`, as the `COHO_TOKEN` that `npm run pull` reads. The library only reads, so a viewer token is enough:

```bash
coho token create --role viewer --label "acme-content library"
```

Nothing is created if Coho refuses the token.

| Option | |
|---|---|
| `--name <package>` | The package name, such as `@acme/content` |
| `--url <url>` | The Coho URL, as `coho status` shows it |
| `--token <token>` | A project token, `coho_pt_…`. Or set `COHO_TOKEN`; in a terminal it is asked for |
| `--ref <tag>` | The tag to generate from |
| `--template <folder \| owner/repo#ref>` | Another template than the one bundled with this version |
| `--no-install` | Don't run `npm install` |
| `-y`, `--yes` | Ask nothing |

**A version of create-coho always creates the same library.** It carries the template it was released with, and pins the library to `@coho-cms/delivery` and `@coho-cms/codegen` at its own version. `create-coho@0.1.0` creates libraries on `0.1.0`.

A checkout's `.git`, `node_modules`, `dist` and `.env` are never copied, so a template folder with your own token in it is safe to pass to `--template`.

## License

Apache-2.0
