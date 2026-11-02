import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CohoWebhookError, verifyWebhook } from '../src/webhooks.ts';
import type { WebhookRefusal } from '../src/webhooks.ts';

/** One case of the spec's signatures: a request, the secret and time a receiver checks it with, and the verdict. */
interface Case
{
    readonly name: string;
    readonly secret: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;

    /** Unix seconds. */
    readonly now: number;

    readonly valid: boolean;
    readonly reason: WebhookRefusal | null;
}

const signatures = JSON.parse(readFileSync(new URL('../../../spec/webhooks/signatures.json', import.meta.url), 'utf8')) as { toleranceSeconds: number; cases: Case[] };
const at = (seconds: number) => new Date(seconds * 1000);
const named = (name: string): Case => signatures.cases.find((c) => c.name === name)!;

/* THE SPEC'S CASES */
/* THE SPEC'S CASES */
/* THE SPEC'S CASES */

for (const c of signatures.cases)
{
    test(`${c.name}: ${c.valid ? 'accepted' : `refused for its ${c.reason}`}`, () =>
    {
        const verify = () => verifyWebhook(c.body, c.headers, c.secret, { now: at(c.now), toleranceSeconds: signatures.toleranceSeconds });
        if (c.valid)
        {
            assert.deepEqual(verify(), JSON.parse(c.body));
        }
        else
        {
            assert.throws(verify, (error) => error instanceof CohoWebhookError && error.reason === c.reason);
        }
    });

    test(`${c.name}: the same as bytes`, () =>
    {
        const verify = () => verifyWebhook(Buffer.from(c.body, 'utf8'), c.headers, c.secret, { now: at(c.now) });
        if (c.valid) assert.deepEqual(verify(), JSON.parse(c.body));
        else assert.throws(verify, (error) => error instanceof CohoWebhookError && error.reason === c.reason);
    });
}

/* THE EVENT */
/* THE EVENT */
/* THE EVENT */

test('an accepted request answers its event, typed', () =>
{
    const c = named('coho-event');
    const event = verifyWebhook(c.body, c.headers, c.secret, { now: at(c.now) });
    assert.equal(event.id, c.headers['webhook-id']);
    assert.equal(event.type, 'environment.promoted');
    assert.equal(event.created_at, '2026-11-02T14:03:11.204Z');
    assert.deepEqual(event.project, { id: '4f6c0b9e-2a51-4d7e-9f0a-6b1c2d3e4f50', name: 'Café Zürich — site' });
    assert.equal(event.actor.kind, 'person');
    assert.equal(event.data['environment'], 'prod');
});

/* SECRETS */
/* SECRETS */
/* SECRETS */

test('a list of secrets accepts a request signed with any one of them', () =>
{
    const c = named('coho-event');
    const previous = named('wrong-secret').secret;
    const options = { now: at(c.now) };
    assert.equal(verifyWebhook(c.body, c.headers, [previous, c.secret], options).id, c.headers['webhook-id']);
    assert.equal(verifyWebhook(c.body, c.headers, [c.secret, previous], options).id, c.headers['webhook-id']);
    assert.throws(() => verifyWebhook(c.body, c.headers, [previous], options), (error) => error instanceof CohoWebhookError && error.reason === 'signature');
});

test('a secret that is not a webhook secret is the receiver\'s mistake, not a refusal', () =>
{
    const c = named('coho-event');
    assert.throws(() => verifyWebhook(c.body, c.headers, c.secret.slice('whsec_'.length), { now: at(c.now) }), TypeError);
    assert.throws(() => verifyWebhook(c.body, c.headers, [], { now: at(c.now) }), TypeError);
});

/* HEADERS */
/* HEADERS */
/* HEADERS */

test('header names are matched whatever their case, in an object or a Fetch Headers', () =>
{
    const c = named('coho-event');
    const shouted = Object.fromEntries(Object.entries(c.headers).map(([name, value]) => [name.toUpperCase(), value]));
    const titled = { 'Webhook-Id': c.headers['webhook-id'], 'Webhook-Timestamp': c.headers['webhook-timestamp'], 'Webhook-Signature': c.headers['webhook-signature'] };
    for (const headers of [shouted, titled, new Headers(shouted)])
    {
        assert.equal(verifyWebhook(c.body, headers, c.secret, { now: at(c.now) }).id, c.headers['webhook-id']);
    }
});

test('an empty header is a missing one, and the refusal names it', () =>
{
    const c = named('coho-event');
    assert.throws(
        () => verifyWebhook(c.body, { ...c.headers, 'webhook-id': '' }, c.secret, { now: at(c.now) }),
        (error) => error instanceof CohoWebhookError && error.reason === 'headers' && /webhook-id/.test(error.message),
    );
});

test('a timestamp that is not a number is refused for its timestamp', () =>
{
    const c = named('coho-event');
    assert.throws(
        () => verifyWebhook(c.body, { ...c.headers, 'webhook-timestamp': '1793628191.0' }, c.secret, { now: at(c.now) }),
        (error) => error instanceof CohoWebhookError && error.reason === 'timestamp',
    );
});

test('the tolerance can be narrowed', () =>
{
    const c = named('coho-event');
    assert.throws(
        () => verifyWebhook(c.body, c.headers, c.secret, { now: at(c.now), toleranceSeconds: 10 }),
        (error) => error instanceof CohoWebhookError && error.reason === 'timestamp',
    );
});
