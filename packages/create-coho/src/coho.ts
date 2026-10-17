import { CreateError } from './scaffold.ts';

/** How a project token announces itself. */
export const TOKEN_PREFIX = 'coho_pt_';

/** What a project token says about itself: Coho's `GET /api/v1/token`. */
export interface TokenDescription
{
    readonly account: { readonly id: string; readonly name?: string | null };
    readonly project: { readonly id: string; readonly name: string };
    readonly token: { readonly id: string; readonly label: string; readonly role: string; readonly expiresAt: string };
}

/**
 * Asks Coho at {@link url} which account and project {@link token} is for. A token
 * names its own project, so nothing else is needed to find them: no account or project
 * ids to copy.
 */
export async function describeToken(url: string, token: string, fetch: typeof globalThis.fetch = globalThis.fetch): Promise<TokenDescription>
{
    if (!/^https?:\/\//.test(url)) throw new CreateError(`'${url}' is not a URL, such as https://app.coho.example`);
    if (!token.startsWith(TOKEN_PREFIX))
    {
        throw new CreateError(`A project token starts ${TOKEN_PREFIX}. Create one with: coho token create --role viewer`);
    }

    let response: Response;
    try
    {
        response = await fetch(`${url.replace(/\/+$/, '')}/api/v1/token`, {
            headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        });
    }
    catch (error)
    {
        throw new CreateError(`Coho is not reachable at ${url}: ${(error as Error).message}`);
    }
    if (response.ok) return (await response.json()) as TokenDescription;

    const problem = (await response.json().catch(() => undefined)) as { code?: string; title?: string; detail?: string } | undefined;
    const said = problem?.code === undefined ? `${response.status}` : `${problem.code}: ${(problem.detail ?? problem.title ?? '').replace(/\.$/, '')}`;
    throw new CreateError(`Coho refused the token (${said}). ${HINTS[response.status] ?? ''}`.trim());
}

/** What to check, for the refusals a person can do something about. */
const HINTS: Readonly<Record<number, string>> = {
    401: 'Check that it is a current project token, not revoked or expired. A token created before Coho could look tokens up this way must be replaced: coho token create --role viewer.',
    403: 'The account is suspended or closed.',
    404: 'Check the URL: it is Coho\'s, as `coho status` shows it, not delivery\'s.',
};
