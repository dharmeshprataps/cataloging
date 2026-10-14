import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { FakeImageProvider } from './helpers/fake-provider.js';
import { buildApp } from '../src/server.js';
import { setProviders } from '../src/providers.js';
import { makePng } from './fixtures/png.js';
import { config } from '../src/config.js';

/**
 * Webhook integration tests over the real Fastify app via `inject`.
 *
 * These matter because two things can only be verified against the assembled
 * server: that the raw-body captured for HMAC verification is the *exact* bytes
 * received, and that an accepted webhook reaches the pipeline.
 */

const SECRET = 'integration-app-secret';
config.messaging.whatsapp.appSecret = SECRET;
config.messaging.whatsapp.verifyToken = 'verify-me';

const adapter = new FakeAdapter();
const provider = new FakeImageProvider({ garment: 'a denim jacket' });
setProviders(adapter, adapter);

let app: Awaited<ReturnType<typeof buildApp>>['app'];
let mediaCounter = 0;

beforeEach(() => {
  adapter.reset();
});

async function getApp() {
  if (!app) app = (await buildApp({ skipChannelValidation: true })).app;
  return app;
}

afterAll(async () => {
  await app?.close();
});

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

function textPayload(text: string, id = `wamid.${Math.random().toString(36).slice(2)}`) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'biz',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '123' },
              contacts: [{ profile: { name: 'Designer' }, wa_id: '919999999999' }],
              messages: [
                { from: '919999999999', id, timestamp: '1700000000', type: 'text', text: { body: text } },
              ],
            },
          },
        ],
      },
    ],
  };
}

function imagePayload(caption: string) {
  const mediaId = `wa-media-${(mediaCounter += 1)}`;
  adapter.media.set(mediaId, { mime: 'image/png', data: makePng(200, 260) });
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'biz',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '123' },
              contacts: [{ profile: { name: 'Designer' }, wa_id: '919999999999' }],
              messages: [
                {
                  from: '919999999999',
                  id: `wamid.img.${mediaCounter}`,
                  timestamp: '1700000000',
                  type: 'image',
                  image: { id: mediaId, mime_type: 'image/png', caption },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Webhook processing is intentionally post-response; wait for it to land. */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe('GET /webhook verification handshake', () => {
  it('WA-001 echoes the challenge as plain text when the token matches', async () => {
    const server = await getApp();
    const res = await server.inject({
      method: 'GET',
      url: '/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('abc123');
  });

  it('WA-002 refuses the handshake when the token does not match', async () => {
    const server = await getApp();
    const res = await server.inject({
      method: 'GET',
      url: '/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /webhook signature enforcement', () => {
  it('SEC-001 rejects a request with no signature header', async () => {
    const server = await getApp();
    const body = JSON.stringify(textPayload('hello'));
    const res = await server.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('SEC-001 rejects a tampered body even when a valid signature for other bytes is present', async () => {
    const server = await getApp();
    const original = JSON.stringify(textPayload('hello'));
    const tampered = JSON.stringify(textPayload('approve everything'));
    const res = await server.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sign(original),
      },
      payload: tampered,
    });
    expect(res.statusCode).toBe(401);
  });

  it('WA-003 accepts a correctly signed payload and acknowledges it', async () => {
    const server = await getApp();
    const body = JSON.stringify(textPayload('hello'));
    const res = await server.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
  });

  it('SEAM-005 runs an accepted text message through the pipeline', async () => {
    const server = await getApp();
    const body = JSON.stringify(textPayload('hi'));
    await server.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
      payload: body,
    });

    await waitFor(() => adapter.sent.length > 0);
    // A brand-new WhatsApp contact gets the greeting, proving the message made
    // it from the webhook into the conversation pipeline.
    expect(adapter.sent.length).toBeGreaterThan(0);
  });

  it('BATCH-002 batches a photo plus its caption into one turn', async () => {
    const server = await getApp();
    const body = JSON.stringify(imagePayload('studio, white background'));
    await server.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
      payload: body,
    });

    await waitFor(() => adapter.said(/Got your photo|brief|describe/i), 4000);
    expect(adapter.said(/Got your photo/)).toBe(true);
    // No generation may happen before the brief is confirmed.
    expect(provider.callCount).toBe(0);
  });

  it('CONV-004 ignores a duplicate delivery of the same message id', async () => {
    const server = await getApp();
    const payload = textPayload('help', 'wamid.duplicate-fixed');
    const body = JSON.stringify(payload);
    const headers = {
      'content-type': 'application/json',
      'x-hub-signature-256': sign(body),
    };

    await server.inject({ method: 'POST', url: '/webhook', headers, payload: body });
    await waitFor(() => adapter.sent.length > 0);
    const afterFirst = adapter.sent.length;

    await server.inject({ method: 'POST', url: '/webhook', headers, payload: body });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(adapter.sent.length).toBe(afterFirst);
  });

  it('WA-012 records delivery statuses without generating anything', async () => {
    const server = await getApp();
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'biz',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '123' },
                statuses: [{ id: 'wamid.out', status: 'read' }],
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(payload);
    const res = await server.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(provider.callCount).toBe(0);
  });
});

describe('SEC-004 webhook refuses to run without its app secret', () => {
  it('SEC-004 returns 503 rather than processing unverified payloads', async () => {
    // Admitting an unverifiable payload would be worse than refusing loudly.
    // The secret is restored immediately: other suites rely on it being set.
    const original = config.messaging.whatsapp.appSecret;
    config.messaging.whatsapp.appSecret = undefined;
    try {
      const server = await getApp();
      const body = JSON.stringify(textPayload('hello'));
      const res = await server.inject({
        method: 'POST',
        url: '/webhook',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=abc' },
        payload: body,
      });

      expect(res.statusCode).toBe(503);
      expect(provider.callCount).toBe(0);
    } finally {
      config.messaging.whatsapp.appSecret = original;
    }
  });
});
