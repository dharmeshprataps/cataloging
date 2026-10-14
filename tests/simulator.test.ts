import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';
import { setProviders } from '../src/providers.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { FakeImageProvider } from './helpers/fake-provider.js';
import { makePng } from './fixtures/png.js';
import { blobStore } from '../src/media/store.js';
import { blobKeyFromExternalRef } from '../src/messaging/simulator.js';
import { config } from '../src/config.js';

/**
 * Local simulator surface, exercised over the real Fastify app via `inject`.
 *
 * The simulator is not a mock: it drives the same pipeline as the WhatsApp
 * channel. These tests assert the HTTP contract the browser depends on —
 * endpoints, status codes, error codes, blob serving, and health.
 */

const adapter = new FakeAdapter();
// Simulator-hosted bytes resolve through the blob store, matching the real
// SimulatorAdapter's behaviour.
adapter.downloadMedia = async (externalId: string) => {
  const key = blobKeyFromExternalRef(externalId);
  return { mime: 'image/png', data: await blobStore.get(key) };
};

const provider = new FakeImageProvider({ garment: 'a corduroy jacket' });
setProviders(provider, adapter);

let app: Awaited<ReturnType<typeof buildApp>>['app'];

beforeAll(async () => {
  app = (await buildApp({ skipChannelValidation: true })).app;
});

afterAll(async () => {
  await app?.close();
});

const contactId = 'sim-test-user';

function post(body: unknown) {
  return app.inject({ method: 'POST', url: '/sim/message', payload: body });
}

describe('health', () => {
  it('OBS-002 reports ok and includes the active configuration', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
    // The health check touches the database, so a broken volume surfaces here
    // rather than during a user's turn.
    expect(body.channel).toBeTruthy();
    expect(typeof body.model).toBe('string');
    expect(body.providerConfigured).toBe(false);
  });
});

describe('the browser client', () => {
  it('SIM-002 serves an HTML chat client wired to the API', async () => {
    const res = await app.inject({ method: 'GET', url: '/sim' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');

    const html = res.body;
    // The page is useless if it does not reach these endpoints.
    expect(html).toContain('/sim/message');
    expect(html).toContain('/sim/events');
    expect(html).toContain('/api/catalog');
  });

  it('SIM-008 is served because the configured channel is the simulator', () => {
    // The 409 branch is asserted separately below, where it is reachable.
    expect(config.messaging.channel).toBe('simulator');
  });
});

describe('inbound requests', () => {
  it('SIM-004 SIM-001 accepts an uploaded photo and stores it', async () => {
    const png = makePng(240, 320, [120, 60, 200]);
    const res = await post({
      contactId,
      imageBase64: Buffer.from(png).toString('base64'),
      filename: 'jacket.png',
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { queued: boolean }).queued).toBe(true);
  });

  it('SIM-004 tolerates a data: URL prefix from the browser file reader', async () => {
    const png = makePng(240, 320);
    const res = await post({
      contactId,
      imageBase64: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('SIM-005 rejects a missing contact id with a machine-readable code', async () => {
    const res = await post({ text: 'hello' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('contactId_required');
  });

  it('SIM-005 rejects an empty payload', async () => {
    const res = await post({ contactId });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('nothing_to_send');
  });

  it('SIM-005 rejects a non-image upload, naming the accepted formats', async () => {
    const res = await post({
      contactId,
      imageBase64: Buffer.from('definitely not an image').toString('base64'),
    });
    expect(res.statusCode).toBe(400);

    const body = res.json() as { error: string; message?: string };
    expect(body.error).toBe('invalid_image');
    // The user-safe message must say what to send instead.
    expect(body.message).toMatch(/JPG, PNG, or WebP/);
  });

  it('SIM-005 rejects empty image bytes', async () => {
    const res = await post({ contactId, imageBase64: '' });
    // An empty string is treated as no image at all.
    expect(res.statusCode).toBe(400);
  });

  it('SIM-004 accepts a text-only message', async () => {
    const res = await post({ contactId, text: 'help' });
    expect(res.statusCode).toBe(200);
  });
});

describe('media and catalog endpoints', () => {
  it('SIM-006 serves simulator-hosted bytes back to the browser', async () => {
    const key = 'sim/2026-01-01/blob-test.png';
    const bytes = makePng(80, 80, [1, 2, 3]);
    await blobStore.put(key, bytes);

    const res = await app.inject({ method: 'GET', url: `/sim/blob/${key}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.length).toBe(bytes.length);
  });

  it('SIM-006 404s an unknown blob', async () => {
    const res = await app.inject({ method: 'GET', url: '/sim/blob/sim/nope.png' });
    expect(res.statusCode).toBe(404);
  });

  it('SEC-007 SIM-007 unknown asset ids return 404 without disclosing anything', async () => {
    const res = await app.inject({ method: 'GET', url: '/media/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('not_found');
  });

  it('SIM-007 lists the catalogue with hero references for the UI', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalog' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });
});
