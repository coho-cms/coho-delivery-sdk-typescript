// Node's crypto, for this module alone: the rest of the package runs in a browser too,
// which is why it is its own entry point, `@coho-cms/delivery/webhooks`.
/// <reference types="node" />
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The project an event happened in. */
export interface WebhookProject
{
    readonly id: string;
    readonly name: string;
}

/** Who made the change an event reports. */
export interface WebhookActor
{
    /**
     * `person`, `token` (a project token), or `system` (a sweep, a builder, or Coho's
     * support). Open, so a kind the server adds later still parses.
     */
    readonly kind: 'person' | 'token' | 'system' | (string & {});

    readonly id: string;

    /** A token's label. A person is named by id alone, never by an email address. */
    readonly label?: string;
}

/**
 * One webhook event, as Coho sent it (coho-data doc 70 §2.1). `id` is the `webhook-id` header too,
 * the same on every attempt and redelivery, so drop an event already handled.
 */
export interface WebhookEvent
{
    readonly id: string;

    /** Such as `environment.promoted`, `tag.ready`, or `entries.changed`. */
    readonly type: string;

    /** ISO 8601, in UTC. */
    readonly created_at: string;

    readonly project: WebhookProject;
    readonly actor: WebhookActor;

    /**
     * The event's own values: identifiers and counts only, never content. Read the
     * content itself through delivery, which always gives its current state.
     */
    readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Request headers: a Fetch `Headers`, or an object of them such as Node's and Express's
 * `req.headers`. Names are matched whatever their case.
 */
export type WebhookHeaders = Headers | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface VerifyOptions
{
    /** The receiver's time. Defaults to the clock; pass one for tests. */
    readonly now?: Date;

    /** How far `webhook-timestamp` may be from `now`, either way. Defaults to 300 seconds. */
    readonly toleranceSeconds?: number;
}

/**
 * Why a request was refused: `headers` when `webhook-id`, `webhook-timestamp`, or
 * `webhook-signature` is missing; `timestamp` when it was signed too long before or
 * after now; `signature` when no signature matches any secret.
 */
export type WebhookRefusal = 'signature' | 'timestamp' | 'headers';

/** A webhook request that did not come from Coho, or not recently. Answer it `400`. */
export class CohoWebhookError extends Error
{
    readonly reason: WebhookRefusal;

    constructor(reason: WebhookRefusal, message: string)
    {
        super(message);
        this.name = 'CohoWebhookError';
        this.reason = reason;
    }
}

const HEADERS = ['webhook-id', 'webhook-timestamp', 'webhook-signature'] as const;
const SECRET = /^whsec_([A-Za-z0-9+/]+={0,2})$/;

/**
 * Checks that a webhook request is Coho's, signed as Standard Webhooks signs, and
 * answers its event.
 *
 * Pass the body exactly as it was received, as a string or bytes. A body parsed and
 * serialized again is not the body that was signed, and is refused. `secret` is the
 * endpoint's, `whsec_…`; while one is being rotated, pass both, and a request signed
 * with either is accepted.
 *
 * @throws {CohoWebhookError} when the request is refused, with its `reason`.
 * @throws {TypeError} when a secret is not a webhook secret, which is a mistake in the
 * receiver, not in the request.
 */
export function verifyWebhook(
    body: string | Uint8Array,
    headers: WebhookHeaders,
    secret: string | readonly string[],
    options: VerifyOptions = {},
): WebhookEvent
{
    const keys = (typeof secret === 'string' ? [secret] : secret).map(secretKey);
    if (keys.length === 0) throw new TypeError('Coho: verifyWebhook needs a secret');

    const [id, timestamp, signatures] = HEADERS.map((name) => header(headers, name));
    if (id === undefined || timestamp === undefined || signatures === undefined)
    {
        const missing = HEADERS.filter((name) => header(headers, name) === undefined);
        throw new CohoWebhookError('headers', `Coho: the webhook request has no ${missing.join(' or ')} header`);
    }

    const signedAt = /^\d+$/.test(timestamp) ? Number(timestamp) : NaN;
    const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
    const tolerance = options.toleranceSeconds ?? 300;
    if (!(Math.abs(now - signedAt) <= tolerance))
    {
        throw new CohoWebhookError('timestamp', `Coho: the webhook request was signed at ${timestamp}, more than ${tolerance} seconds from now (${now})`);
    }

    const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    const offered = signatures.split(' ')
        .filter((signature) => signature.startsWith('v1,'))
        .map((signature) => Buffer.from(signature.slice('v1,'.length), 'utf8'));
    const verified = keys.some((key) =>
    {
        const expected = Buffer.from(createHmac('sha256', key).update(`${id}.${timestamp}.`, 'utf8').update(bytes).digest('base64'), 'utf8');
        return offered.some((signature) => signature.length === expected.length && timingSafeEqual(signature, expected));
    });
    if (!verified)
    {
        throw new CohoWebhookError('signature', 'Coho: no signature on the webhook request matches its secret');
    }

    return JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body)) as WebhookEvent;
}

/** The HMAC key a `whsec_` secret holds, in base64. */
function secretKey(secret: string): Buffer
{
    const key = SECRET.exec(secret)?.[1];
    if (key === undefined) throw new TypeError('Coho: a webhook secret is whsec_ and its key in base64');
    return Buffer.from(key, 'base64');
}

/** A header's value, whatever the case of its name, or undefined when it is missing or empty. */
function header(headers: WebhookHeaders, name: string): string | undefined
{
    // Duck-typed rather than `instanceof Headers`, so a polyfill's headers are read too.
    const value = isFetchHeaders(headers)
        ? headers.get(name)
        : Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
    const joined = typeof value === 'string' || value == null ? value : value.join(' ');
    return joined == null || joined === '' ? undefined : joined;
}

function isFetchHeaders(headers: WebhookHeaders): headers is Headers
{
    return typeof (headers as Partial<Headers>).get === 'function';
}
