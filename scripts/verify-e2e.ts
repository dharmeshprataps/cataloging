/**
 * Verification script: boots the REAL server over HTTP with only the two
 * external boundaries faked (channel + image engine), then drives a complete
 * catalog flow through the simulator API.
 *
 * This proves the wiring that unit tests cannot: HTTP routing, raw-body
 * signature verification, media upload, persistence, and SSE delivery.
 *
 * Run: ./run.sh pnpm verify:e2e
 *
 * Self-contained: it pins its own debounce/isolation before any config module
 * loads, so it does not depend on the caller's environment or touch ./data.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Must happen before `config` is imported, since config reads env at load time.
const runDir = mkdtempSync(path.join(tmpdir(), 'wa-catalog-e2e-'));
process.env.MESSAGE_DEBOUNCE_MS ??= '10';
process.env.LOG_LEVEL ??= 'error';
process.env.MESSAGING_CHANNEL ??= 'simulator';
process.env.STORAGE_DIR ??= path.join(runDir, 'uploads');
process.env.DATABASE_PATH ??= path.join(runDir, 'e2e.db');

const { FakeAdapter } = await import('../tests/helpers/fake-adapter.js');
const { FakeImageProvider } = await import('../tests/helpers/fake-provider.js');
const { makePng } = await import('../tests/fixtures/png.js');
const { blobStore } = await import('../src/media/store.js');
const { blobKeyFromExternalRef } = await import('../src/messaging/simulator.js');
const { setProviders } = await import('../src/providers.js');
const { buildApp } = await import('../src/server.js');

const failures: string[] = [];

function check(label: string, condition: boolean, detail = ''): void {
  const ok = condition ? 'PASS' : 'FAIL';
  if (!condition) failures.push(label);
  console.log(`  [${ok}] ${label}${detail ? ` — ${detail}` : ''}`);
}

const adapter = new FakeAdapter();
// The simulator serves inbound bytes from the blob store (same as the real
// SimulatorAdapter); resolve `/sim/blob/<key>` URLs the same way.
adapter.downloadMedia = async (externalId: string) => {
  const key = blobKeyFromExternalRef(externalId);
  return { mime: 'image/png', data: await blobStore.get(key) };
};

const provider = new FakeImageProvider({ garment: 'a chartreuse silk wrap dress' });
setProviders(provider, adapter);

const { app, repo } = await buildApp({ skipChannelValidation: true });
const address = await app.listen({ port: 0, host: '127.0.0.1' });
const base = address.replace('127.0.0.1', 'localhost');
const contactId = 'e2e-user';

// The script must be repeatable: it asserts on the *change* in catalog size
// rather than an absolute count, so running it twice against the same database
// still passes. (An absolute count would only be valid on a virgin database.)
const org = repo.ensureDefaultOrg();
const productsBefore = repo.listProducts(org.id).length;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, init);
}

async function sendText(text: string): Promise<Response> {
  return api('/sim/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId, text }),
  });
}

async function sendImage(): Promise<Response> {
  const png = makePng(240, 320, [180, 90, 120]);
  return api('/sim/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contactId,
      imageBase64: Buffer.from(png).toString('base64'),
      filename: 'dress.png',
    }),
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

console.log('\n== 1. health ==');
{
  const res = await api('/healthz');
  const body = (await res.json()) as Record<string, unknown>;
  check('GET /healthz returns 200', res.status === 200, `status=${res.status}`);
  check('reports the configured channel', body.channel === 'simulator', String(body.channel));
  check('reports the active image model', typeof body.model === 'string', String(body.model));
}

console.log('\n== 2. simulator UI ==');
{
  const res = await api('/sim');
  const html = await res.text();
  check('GET /sim returns 200 HTML', res.status === 200, `status=${res.status}`);
  check('page wires up the SSE stream', html.includes('/sim/events'));
  check('page posts to the message endpoint', html.includes('/sim/message'));
}

console.log('\n== 3. event streaming ==');
{
  // Needs a real socket: the SSE route owns the connection until the
  // client disconnects, so `inject` (which waits for the response to end) cannot
  // exercise it. AbortController lets us read the first chunk and hang up.
  const controller = new AbortController();
  try {
    const res = await fetch(`${base}/sim/events?session=sim:${contactId}`, {
      signal: controller.signal,
    });
    check(
      'SSE stream opens with the event-stream content type',
      res.headers.get('content-type')?.includes('text/event-stream') === true,
      String(res.headers.get('content-type')),
    );
    const reader = res.body?.getReader();
    const first = reader ? await reader.read() : undefined;
    const chunk = first?.value ? new TextDecoder().decode(first.value) : '';
    check('SSE stream emits an initial retry hint', chunk.includes('retry:'), chunk.trim());
  } catch (err) {
    check('SSE stream opens', false, err instanceof Error ? err.message : String(err));
  } finally {
    controller.abort();
  }
}

console.log('\n== 3b. media route ==');
{
  const res = await api('/media/does-not-exist');
  check('unknown asset id yields 404', res.status === 404, `status=${res.status}`);
}

console.log('\n== 4. inbound validation ==');
{
  const noContact = await api('/sim/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'hi' }),
  });
  check('missing contactId is rejected', noContact.status === 400, `status=${noContact.status}`);

  const empty = await api('/sim/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId }),
  });
  check('empty payload is rejected', empty.status === 400, `status=${empty.status}`);

  const garbage = await api('/sim/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contactId,
      imageBase64: Buffer.from('not an image').toString('base64'),
    }),
  });
  const garbageBody = (await garbage.json()) as { error?: string };
  check(
    'non-image upload is rejected with a reason',
    garbage.status === 400 && garbageBody.error === 'invalid_image',
    garbageBody.error,
  );
}

console.log('\n== 5. webhook signature ==');
{
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const res = await api('/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=deadbeef' },
    body: payload,
  });
  check(
    'unsigned/mis-signed webhook is rejected (app secret unset => 503, set => 401)',
    res.status === 401 || res.status === 503,
    `status=${res.status}`,
  );

  const verify = await api('/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=123');
  check('bad verify token is refused', verify.status === 403 || verify.status === 503, `status=${verify.status}`);
}

console.log('\n== 6. full conversation flow ==');
{
  const upload = await sendImage();
  check('garment photo upload accepted', upload.status === 200, `status=${upload.status}`);

  await sendText('studio, white background, walking pose');
  await sleep(600);

  const texts = () => adapter.texts().join('\n');
  check('bot acknowledges the photo', /Got your photo/.test(texts()));
  check('bot asks for the brief', /describe the shot/i.test(texts()));

  await sendText('go');
  await sleep(600);

  check('brief was confirmed before generating', /Here's the brief/.test(texts()));
  check('exactly one generation ran', provider.callCount === 1, `calls=${provider.callCount}`);
  check('generated image was delivered', adapter.images().length === 1, `images=${adapter.images().length}`);
  check('review options were offered', /Approve — save to catalog/.test(texts()));

  const firstAssetId = adapter.images()[0]?.assetId ?? '';
  const mediaRes = await api(`/media/${firstAssetId}`);
  check('generated image is served over /media', mediaRes.status === 200, `status=${mediaRes.status}`);

  await sendText('2, make the lighting warmer');
  await sleep(600);
  check('revision produced a second generation', provider.callCount === 2, `calls=${provider.callCount}`);
  check(
    'revision was chained to the previous interaction',
    provider.lastRequest()?.previousInteractionId === 'interaction-1',
    String(provider.lastRequest()?.previousInteractionId),
  );

  await sendText('3');
  await sleep(900);
  check('variations produced more shots', provider.callCount >= 6, `calls=${provider.callCount}`);

  await sendText('1');
  await sleep(400);
  check('approval was acknowledged', /Saved to your catalog/.test(texts()));

  const products = repo.listProducts(org.id);
  check(
    'approval created exactly one new catalog product',
    products.length === productsBefore + 1,
    `before=${productsBefore} after=${products.length}`,
  );
  const product = products[0]!;
  const links = repo.listProductAssets(product.id);
  check('a hero image is linked', links.some((l) => l.role === 'hero'));
  check(
    'hero asset is a generated image',
    links.find((l) => l.role === 'hero')?.asset.kind === 'generated',
  );
}

console.log('\n== 7. idempotency over HTTP ==');
{
  const before = provider.callCount;
  const res = await sendText('1');
  await sleep(300);
  check('extra traffic after approval does not generate', provider.callCount === before);
  check('repeated message accepted without error', res.status === 200, `status=${res.status}`);
}

console.log('\n== 8. catalog API ==');
{
  const res = await api('/api/catalog');
  const body = (await res.json()) as { items: Array<{ heroAssetId: string | null; title: string | null }> };
  check(
    'catalog API reflects the new item count',
    body.items.length === productsBefore + 1,
    `items=${body.items.length}`,
  );
  check('catalog item exposes its hero image', Boolean(body.items[0]?.heroAssetId));
}

await app.close();

console.log(
  failures.length === 0
    ? '\n✅ All end-to-end checks passed.\n'
    : `\n❌ ${failures.length} check(s) failed:\n${failures.map((f) => `   - ${f}`).join('\n')}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
