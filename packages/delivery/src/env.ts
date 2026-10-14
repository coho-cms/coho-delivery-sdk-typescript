import type { ContentConfig } from './content.ts';

/** Environment variables, such as `process.env`. */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * A content config from environment variables, so whether an app reads released
 * content or previews unreleased content is a deployment's choice, not a code change.
 * It is handed the environment rather than reading one, so it runs wherever the app
 * does and a library built on it reads no environment of its own.
 *
 * | Variable | |
 * |---|---|
 * | `COHO_PROJECT`, `COHO_REF` | Always. The ref is a tag or an environment, or with a preview token, a branch or `dev` |
 * | `COHO_LOCALE` | Optional |
 * | `COHO_DELIVERY_URL`, `COHO_DELIVERY_KEY` | Released content, from delivery. The key may be left out for a public environment |
 * | `COHO_PREVIEW_TOKEN`, `COHO_URL`, `COHO_ACCOUNT` | Unreleased content, live through Coho: a project token, Coho's URL, and the project's account |
 *
 * A preview token selects a preview. Setting it and a delivery key is refused rather
 * than one quietly winning, since the two read different content. An empty variable,
 * such as `COHO_DELIVERY_KEY=` in a `.env` file, counts as unset.
 *
 * ⚠️ Server-side only. Never give these a prefix that puts them in a browser bundle,
 * such as Next.js's `NEXT_PUBLIC_`.
 */
export function configFromEnv(env: Env): ContentConfig {
  const value = (name: string): string | undefined => {
    const set = env[name]?.trim();
    return set === undefined || set === '' ? undefined : set;
  };
  const token = value('COHO_PREVIEW_TOKEN');
  const key = value('COHO_DELIVERY_KEY');
  if (token !== undefined && key !== undefined) {
    throw new Error('Coho: set COHO_PREVIEW_TOKEN to preview unreleased content, or COHO_DELIVERY_KEY to read released content, not both');
  }

  const needed = token !== undefined
    ? ['COHO_URL', 'COHO_ACCOUNT', 'COHO_PROJECT', 'COHO_REF']
    : ['COHO_DELIVERY_URL', 'COHO_PROJECT', 'COHO_REF'];
  const missing = needed.filter((name) => value(name) === undefined);
  if (missing.length > 0) {
    const reading = token !== undefined ? 'a preview, since COHO_PREVIEW_TOKEN is set' : 'released content';
    throw new Error(`Coho: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} needed to read ${reading}`);
  }

  // Checked present above, so each `!` names a variable the list required.
  const common = { project: value('COHO_PROJECT')!, ref: value('COHO_REF')!, locale: value('COHO_LOCALE') };
  return token !== undefined
    ? { ...common, url: value('COHO_URL')!, account: value('COHO_ACCOUNT')!, token }
    : { ...common, url: value('COHO_DELIVERY_URL')!, key };
}
