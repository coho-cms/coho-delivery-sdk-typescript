import { ResponseCache, deepFreeze, freshUntil } from './cache.ts';
import { CohoDeliveryError } from './errors.ts';
import type { EntryGraph, EntryList, Problem } from './types.ts';

/** What every config takes, however it reaches Coho. */
export interface ClientOptions
{
  /** The fetch to use. Defaults to the global one. */
  readonly fetch?: typeof globalThis.fetch;
  /** The private response cache: on by default, holding up to 1000 responses. `false` turns it off. */
  readonly cache?: false | { readonly maxEntries?: number };
}

/**
 * Released content: tags, and environments pointing at them, such as `qa` and `prod`,
 * from delivery, with a delivery key.
 */
export interface ReleasedConfig extends ClientOptions
{
  /** Where delivery is served, such as `https://delivery.coho.example`. */
  readonly url: string;
  /** The project id. It selects the project; the key is what authorizes. */
  readonly project: string;
  /**
   * A delivery key, sent as `Authorization: Bearer` and never in a URL. Leave it out
   * only for an environment the project has opened to keyless reads.
   */
  readonly key?: string;
  readonly account?: never;
  readonly token?: never;
  readonly baseUrl?: never;
}

/**
 * Unreleased content: `dev` and branch heads, read live through Coho with a project
 * token. The same answers in the same shapes as delivery, never cached, so a preview
 * runs the code production runs.
 */
export interface PreviewConfig extends ClientOptions
{
  /** Coho's own URL, where you sign in, such as `https://api.coho.example`. Not delivery's. */
  readonly url: string;
  /** The account the project belongs to. */
  readonly account: string;
  readonly project: string;
  /**
   * A project token, `coho_pt_…`, with read access to the project: the viewer role is
   * enough. ⚠️ It reads everything unreleased, so keep it on the server, out of any
   * bundle a browser loads.
   */
  readonly token: string;
  readonly key?: never;
  readonly baseUrl?: never;
}

/** The whole base URL, `…/v1/projects/{project}`, for a mount `url` and `project` cannot express. */
export interface MountedConfig extends ClientOptions
{
  readonly baseUrl: string;
  /** A delivery key, sent as `Authorization: Bearer` and never in a URL. */
  readonly key?: string;
  readonly url?: never;
  readonly project?: never;
  readonly account?: never;
  readonly token?: never;
}

export type DeliveryConfig = ReleasedConfig | PreviewConfig | MountedConfig;

export interface ReadOptions
{
  /** How many reference hops to follow from each root, 0 to 5. The server's default is 0. */
  readonly depth?: number;
  /** The locale to project to. Without one, localized fields are absent. */
  readonly locale?: string;
}

export interface ListOptions extends ReadOptions
{
  readonly type?: string;
  /** A sortable field of `type`, prefixed `-` for descending. Needs `type`. */
  readonly order?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** The delivery API, untyped: entries come back as the server sends them. */
export interface DeliveryClient
{
  /** A page of entries on `ref`, in the order `order` asks for, or by id. */
  entries(ref: string, options?: ListOptions): Promise<EntryList>;
  /** One entry by id, or null if it is not on `ref`. */
  entry(ref: string, id: string, options?: ReadOptions): Promise<EntryGraph | null>;
  /** One entry by slug, or null if it is not on `ref`. */
  entryBySlug(ref: string, slug: string, options?: ReadOptions): Promise<EntryGraph | null>;
  /** Several entries by id, at most 100. An id not on `ref` is reported under `unresolved` as `absent`. */
  entriesById(ref: string, ids: readonly string[], options?: ReadOptions): Promise<EntryGraph>;
}

type Query = Readonly<Record<string, string | number | undefined>>;

const NOTHING: EntryGraph = deepFreeze({ roots: [], entries: {}, unresolved: {} });

export function createDeliveryClient(config: DeliveryConfig): DeliveryClient
{
  const { base, credential, reads } = connectionOf(config);
  const fetcher = config.fetch ?? globalThis.fetch;
  const cache = config.cache === false ? undefined : new ResponseCache(config.cache?.maxEntries ?? 1000);

  async function get<T>(path: string, query: Query): Promise<T>
  {
    const url = `${base}${path}${queryString(query)}`;
    const cached = cache?.get(url);
    if (cached !== undefined && cached.freshUntil > Date.now()) return cached.body as T;

    const headers: Record<string, string> = { accept: 'application/json' };
    if (credential !== undefined) headers['authorization'] = `Bearer ${credential}`;
    if (cached?.etag !== undefined) headers['if-none-match'] = cached.etag;

    const response = await fetcher(url, { headers });
    if (response.status === 304 && cached !== undefined)
    {
      remember(url, cached.body, response, cached.etag);
      return cached.body as T;
    }
    if (!response.ok) throw await refusal(response, reads);

    let body: unknown;
    try
    {
      body = deepFreeze(await response.json());
    }
    catch
    {
      throw new CohoDeliveryError(response.status, 'UNEXPECTED_RESPONSE', `Delivery answered ${response.status} with a body that is not JSON`);
    }
    remember(url, body, response);
    return body as T;
  }

  function remember(url: string, body: unknown, response: Response, previousEtag?: string): void
  {
    if (cache === undefined) return;
    const now = Date.now();
    const until = freshUntil(response.headers.get('cache-control'), now);
    const etag = response.headers.get('etag') ?? previousEtag;
    // Nothing to gain from keeping a body that can neither be served nor revalidated.
    if (until === null || (until <= now && etag === undefined)) cache.delete(url);
    else cache.set(url, { body, etag, freshUntil: until });
  }

  /** A single read's refusal for a missing entry is a null, not an error. */
  async function orNull<T>(read: Promise<T>): Promise<T | null>
  {
    try
    {
      return await read;
    }
    catch (error)
    {
      if (error instanceof CohoDeliveryError && error.code === 'ENTRY_NOT_FOUND') return null;
      throw error;
    }
  }

  const at = (ref: string) => `/${encodeURIComponent(ref)}`;

  return {
    entries: (ref, options = {}) =>
      get<EntryList>(`${at(ref)}/entries`, {
        type: options.type,
        order: options.order,
        limit: options.limit,
        offset: options.offset,
        depth: options.depth,
        locale: options.locale,
      }),

    entry: (ref, id, options = {}) =>
      orNull(get<EntryGraph>(`${at(ref)}/entries/${encodeURIComponent(id)}`, { depth: options.depth, locale: options.locale })),

    entryBySlug: (ref, slug, options = {}) =>
      orNull(get<EntryGraph>(`${at(ref)}/entries-by-slug/${encodeURIComponent(slug)}`, { depth: options.depth, locale: options.locale })),

    entriesById: async (ref, ids, options = {}) =>
      ids.length === 0
        ? NOTHING
        : get<EntryGraph>(`${at(ref)}/entries-by-id`, { ids: ids.join(','), depth: options.depth, locale: options.locale }),
  };
}

/** Released content, from delivery; or unreleased, read live through Coho's preview mount. */
type Reads = 'released' | 'preview';

/** The project token prefix (doc 29), by which Coho tells a token from a person's sign-in. */
const TOKEN_PREFIX = 'coho_pt_';

/**
 * Where requests go, and what authorizes them. Checked here as well as in the types,
 * for callers the types do not reach: plain JavaScript, and configs built from the
 * environment.
 */
function connectionOf(config: DeliveryConfig): { base: string; credential: string | undefined; reads: Reads }
{
  const trim = (url: string): string => url.replace(/\/+$/, '');

  if (config.token !== undefined)
  {
    if (config.key !== undefined) throw new TypeError('Coho delivery takes a key or a token, not both');
    if (config.url === undefined || config.account === undefined || config.project === undefined)
    {
      throw new TypeError('A Coho preview needs the url, account and project with its token');
    }
    if (!config.token.startsWith(TOKEN_PREFIX))
    {
      throw new TypeError(`A Coho preview token is a project token, starting ${TOKEN_PREFIX}`);
    }
    // A token in a browser is a token anyone can read, and it reads everything unreleased.
    if ('document' in globalThis)
    {
      throw new TypeError('A Coho project token must stay on the server: this code is running in a browser');
    }
    const project = `${encodeURIComponent(config.account)}/projects/${encodeURIComponent(config.project)}`;
    return { base: `${trim(config.url)}/api/v1/accounts/${project}/preview`, credential: config.token, reads: 'preview' };
  }

  if (config.baseUrl !== undefined) return { base: trim(config.baseUrl), credential: config.key, reads: 'released' };
  if (config.url === undefined || config.project === undefined)
  {
    throw new TypeError('Coho delivery needs a url and a project, or a baseUrl');
  }
  return {
    base: `${trim(config.url)}/v1/projects/${encodeURIComponent(config.project)}`,
    credential: config.key,
    reads: 'released',
  };
}

/**
 * Parameters in name order, whatever order the caller gave, so two call sites asking
 * the same question share one URL, and so one cache entry here and one at any edge.
 * Commas are left readable: `ids` is a comma-separated list.
 */
function queryString(query: Query): string
{
  const parts = Object.keys(query)
    .sort()
    .flatMap((name) =>
    {
      const value = query[name];
      return value === undefined ? [] : [`${name}=${encodeURIComponent(String(value)).replace(/%2C/gi, ',')}`];
    });
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

async function refusal(response: Response, reads: Reads): Promise<CohoDeliveryError>
{
  const problem = await problemOf(response);
  if (problem === undefined)
  {
    return new CohoDeliveryError(response.status, 'UNEXPECTED_RESPONSE', `Delivery answered ${response.status} with no problem document`);
  }
  const text = (problem.detail ?? problem.title).replace(/\.$/, '');
  return new CohoDeliveryError(response.status, problem.code, `${problem.code}: ${text}.${HINTS[reads][problem.code] ?? ''}`, problem);
}

/**
 * What to check, for the refusals whose answer is deliberately vague. A credential for
 * another project is answered exactly as a project that does not exist, so that one
 * customer's cannot confirm another's project; and each side serves only its own refs.
 */
const HINTS: Record<Reads, Partial<Record<string, string>>> = {
  released: {
    PROJECT_NOT_FOUND: ' Check that the key was issued for this project.',
    REF_NOT_FOUND: ' Delivery serves tags and the environments pointing at them; read a branch, or dev, with a project token.',
  },
  preview: {
    PROJECT_NOT_FOUND: ' Check that the token was issued for this project, and that the account is the one it belongs to.',
    REF_NOT_FOUND: ' A preview reads branches, and environments pointing at one such as dev; a release is read from delivery, with a key.',
  },
};

async function problemOf(response: Response): Promise<Problem | undefined>
{
  // Read either JSON type. The contract says `application/problem+json`, and servers
  // before 2026-10-13 labelled problems `application/json`.
  if (!(response.headers.get('content-type') ?? '').includes('json')) return undefined;
  try
  {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && typeof (body as { code?: unknown }).code === 'string')
    {
      return body as Problem;
    }
  }
  catch
  {
    // Labelled JSON and not JSON: no problem document to report.
  }
  return undefined;
}
