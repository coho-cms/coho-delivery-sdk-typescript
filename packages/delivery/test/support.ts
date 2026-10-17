import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EntryGraph } from '../src/index.ts';

const directory = fileURLToPath(new URL('../../../spec/delivery/recordings/', import.meta.url));

/** One request to the snapshot implementation and its answer, recorded by coho-data. */
export interface Recording
{
    readonly request: {
        readonly method: string;

        /** Relative to the project's base URL. */
        readonly path: string;

        readonly auth: 'key' | 'none' | 'other-key';
    };
    readonly response: {
        readonly status: number;
        readonly headers: {
            readonly 'content-type'?: string;
            readonly 'cache-control'?: string;

            /** Whether one was sent. Its value is not recorded. */
            readonly etag: boolean;
        };
        readonly body: unknown;
    };
}

export function recording(name: string): Recording
{
    return JSON.parse(readFileSync(`${directory}${name}.json`, 'utf8')) as Recording;
}

/** A recording's body, as the graph it is. */
export function graph(name: string): EntryGraph
{
    return recording(name).response.body as EntryGraph;
}

export const BASE = 'https://delivery.test/v1/projects/p1';
export const KEY = 'test-key';
export const OTHER_KEY = 'other-key';

/** The path, and the query in name order and decoded, so equal requests compare equal. */
function normalize(pathAndQuery: string): string
{
    const [path = '', query = ''] = pathAndQuery.split('?', 2);
    const params = query === '' ? [] : query.split('&').map(decodeURIComponent).sort();
    return `${decodeURIComponent(path)}?${params.join('&')}`;
}

export interface Call
{
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
}

/**
 * A fetch that answers from the recordings, as the server did, plus `304` for an
 * `If-None-Match` naming the recording's ETag. Each recording's ETag is its name.
 */
export function replay(): { fetch: typeof globalThis.fetch; calls: Call[] }
{
    const all = readdirSync(directory)
        .filter((file) => file.endsWith('.json'))
        .map((file) => ({ name: file.slice(0, -'.json'.length), recorded: recording(file.slice(0, -'.json'.length)) }));
    const calls: Call[] = [];

    const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    {
        const url = String(input);
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        calls.push({ url, headers });

        if (!url.startsWith(BASE)) throw new Error(`Not a delivery URL: ${url}`);
        const authorization = headers['authorization'];
        const auth = authorization === undefined ? 'none' : authorization === `Bearer ${KEY}` ? 'key' : 'other-key';
        const wanted = normalize(url.slice(BASE.length));
        const match = all.find(({ recorded }) => recorded.request.auth === auth && normalize(recorded.request.path) === wanted);
        if (match === undefined) throw new Error(`Nothing recorded for ${auth} ${wanted}`);

        const { response } = match.recorded;
        const etag = response.headers.etag ? `"${match.name}"` : undefined;
        const answer = new Headers();
        if (response.headers['content-type'] !== undefined) answer.set('content-type', response.headers['content-type']);
        if (response.headers['cache-control'] !== undefined) answer.set('cache-control', response.headers['cache-control']);
        if (etag !== undefined) answer.set('etag', etag);

        if (etag !== undefined && headers['if-none-match'] === etag) return new Response(null, { status: 304, headers: answer });
        return new Response(JSON.stringify(response.body), { status: response.status, headers: answer });
    };

    return { fetch: fetch as typeof globalThis.fetch, calls };
}
