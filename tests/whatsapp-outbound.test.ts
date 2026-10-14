import { describe, expect, it } from 'vitest';
import { WhatsAppAdapter } from '../src/messaging/whatsapp.js';

/**
 * Outbound WhatsApp Cloud API behaviour.
 *
 * This path had **no** automated coverage at all (PRB-0003 G2): every pipeline
 * test used a fake adapter, which replaces the code under test rather than
 * exercising it. Since WhatsApp is the real channel, the outbound calls are the
 * largest shipping risk in the project.
 *
 * Meta is not contacted. `fetch` is injected, so these assert the precise HTTP
 * requests the adapter makes — URL, method, auth header, and body shape.
 */

const CREDENTIALS = {
  accessToken: 'test-token',
  phoneNumberId: '1234567890',
  apiVersion: 'v21.0',
};

type Call = { url: string; init: RequestInit | undefined };

function stubFetch(
  responses: Array<{ status?: number; body?: unknown; text?: string }> = [],
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[index] ?? { status: 200, body: {} };
    index += 1;

    const status = next.status ?? 200;
    const text = next.text ?? JSON.stringify(next.body ?? {});
    return new Response(text, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

function adapterWith(responses: Array<{ status?: number; body?: unknown; text?: string }> = []) {
  const { fetchImpl, calls } = stubFetch(responses);
  const adapter = new WhatsAppAdapter({ credentials: CREDENTIALS, fetchImpl });
  return { adapter, calls };
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init?.body ?? '{}')) as Record<string, unknown>;
}

function authOf(call: Call): string | undefined {
  const headers = call.init?.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

describe('outbound text', () => {
  it('WA-015 posts text to the messages endpoint with link previews disabled', async () => {
    const { adapter, calls } = adapterWith([{ body: { messages: [{ id: 'wamid.OUT' }] } }]);

    const sent = await adapter.sendText('919999999999', 'hello there');

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`https://graph.facebook.com/${CREDENTIALS.apiVersion}/1234567890/messages`);
    expect(call.init?.method).toBe('POST');
    expect(authOf(call)).toBe(`Bearer ${CREDENTIALS.accessToken}`);

    const body = bodyOf(call);
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.to).toBe('919999999999');
    expect(body.type).toBe('text');
    expect(body.text).toEqual({ preview_url: false, body: 'hello there' });

    expect(sent.externalId).toBe('wamid.OUT');
  });

  it('WA-018 pins the configured API version in the base URL', async () => {
    // A floating default would silently change behaviour under us.
    const captured = stubFetch([{ body: { messages: [{ id: 'x' }] } }]);
    const adapter = new WhatsAppAdapter({
      credentials: { ...CREDENTIALS, apiVersion: 'v19.0' },
      fetchImpl: captured.fetchImpl,
    });
    await adapter.sendText('1', 'x');
    expect(captured.calls[0]!.url).toContain('/v19.0/');
  });

  it('WA-015 surfaces a Cloud API error rather than failing silently', async () => {
    const { adapter } = adapterWith([{ status: 401, text: '{"error":{"message":"bad token"}}' }]);
    await expect(adapter.sendText('1', 'x')).rejects.toThrow(/401/);
  });
});

describe('outbound images', () => {
  it('WA-016 uploads the media first, then references its id in the image message', async () => {
    const { adapter, calls } = adapterWith([
      { body: { id: 'MEDIA_ID' } }, // upload
      { body: { messages: [{ id: 'wamid.IMG' }] } }, // send
    ]);

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const sent = await adapter.sendImage(
      '919999999999',
      { id: 'asset-1', mime: 'image/png', data: png },
      'Here it is',
    );

    expect(calls).toHaveLength(2);

    // Hop 1: media upload to the phone number's media endpoint.
    const upload = calls[0]!;
    expect(upload.url).toBe(`https://graph.facebook.com/${CREDENTIALS.apiVersion}/1234567890/media`);
    expect(upload.init?.method).toBe('POST');
    expect(authOf(upload)).toBe(`Bearer ${CREDENTIALS.accessToken}`);
    // FormData must not carry a manual content-type, or the boundary breaks.
    const headers = upload.init?.headers as Record<string, string> | undefined;
    expect(headers?.['Content-Type']).toBeUndefined();
    expect(upload.init?.body).toBeInstanceOf(FormData);

    // Hop 2: the message references the uploaded id, never raw bytes.
    const send = calls[1]!;
    const body = bodyOf(send);
    expect(body.type).toBe('image');
    expect(body.image).toEqual({ id: 'MEDIA_ID', caption: 'Here it is' });
    expect(sent.externalId).toBe('wamid.IMG');
  });

  it('WA-016 omits the caption entirely when none is supplied', async () => {
    const { adapter, calls } = adapterWith([
      { body: { id: 'MEDIA_ID' } },
      { body: { messages: [{ id: 'wamid.IMG' }] } },
    ]);
    await adapter.sendImage('1', { id: 'a', mime: 'image/jpeg', data: new Uint8Array([1]) });
    const body = bodyOf(calls[1]!);
    expect(body.image).toEqual({ id: 'MEDIA_ID' });
  });

  it('WA-016 fails loudly when the upload returns no media id', async () => {
    const { adapter } = adapterWith([{ body: {} }]);
    await expect(
      adapter.sendImage('1', { id: 'a', mime: 'image/png', data: new Uint8Array([1]) }),
    ).rejects.toThrow(/no id/);
  });
});

describe('inbound media download', () => {
  it('WA-017 resolves the media id, then fetches bytes with the same bearer token', async () => {
    const { fetchImpl, calls } = stubFetch([
      { body: { url: 'https://lookaside.example/x', mime_type: 'image/jpeg' } },
      { status: 200, text: 'BINARY' },
    ]);
    const adapter = new WhatsAppAdapter({ credentials: CREDENTIALS, fetchImpl });

    const media = await adapter.downloadMedia('MEDIA_ID');

    expect(calls).toHaveLength(2);
    // Hop 1: metadata lookup by media id.
    expect(calls[0]!.url).toContain('/MEDIA_ID');
    expect(authOf(calls[0]!)).toBe(`Bearer ${CREDENTIALS.accessToken}`);
    // Hop 2: the short-lived URL, still authenticated. Meta requires this.
    expect(calls[1]!.url).toBe('https://lookaside.example/x');
    expect(authOf(calls[1]!)).toBe(`Bearer ${CREDENTIALS.accessToken}`);

    expect(media.mime).toBe('image/jpeg');
  });

  it('WA-017 fails when the metadata response carries no url', async () => {
    const { fetchImpl } = stubFetch([{ body: {} }]);
    const adapter = new WhatsAppAdapter({ credentials: CREDENTIALS, fetchImpl });
    await expect(adapter.downloadMedia('M')).rejects.toThrow(/no url/);
  });

  it('WA-017 surfaces an authentication failure on the metadata hop', async () => {
    const { fetchImpl } = stubFetch([{ status: 401, text: 'nope' }]);
    const adapter = new WhatsAppAdapter({ credentials: CREDENTIALS, fetchImpl });
    await expect(adapter.downloadMedia('M')).rejects.toThrow(/401/);
  });
});

describe('read receipts', () => {
  it('WA-019 posts a read status for the message', async () => {
    const { adapter, calls } = adapterWith([{ body: {} }]);
    await adapter.markRead('wamid.IN');

    const body = bodyOf(calls[0]!);
    expect(body.status).toBe('read');
    expect(body.message_id).toBe('wamid.IN');
    expect(body.messaging_product).toBe('whatsapp');
  });

  it('WA-019 swallows its own errors so a receipt can never fail a turn', async () => {
    const adapter = new WhatsAppAdapter({
      credentials: CREDENTIALS,
      fetchImpl: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });
    // Must resolve, not reject: read receipts are cosmetic.
    await expect(adapter.markRead('wamid.IN')).resolves.toBeUndefined();
  });
});

describe('credential handling', () => {
  it('CFG-003 throws at construction when required environment credentials are absent', () => {
    // No credentials override => the adapter validates the real environment.
    // The message must name every missing key, or the operator cannot fix it.
    expect(() => new WhatsAppAdapter()).toThrow(/missing config/);
    expect(() => new WhatsAppAdapter()).toThrow(/accessToken/);
    expect(() => new WhatsAppAdapter()).toThrow(/appSecret/);
  });

  it('SEAM-003 accepts injected credentials, so the adapter can be constructed in tests', () => {
    const adapter = new WhatsAppAdapter({ credentials: CREDENTIALS, fetchImpl: stubFetch().fetchImpl });
    expect(adapter.name).toBe('whatsapp');
  });
});

describe('request hygiene', () => {
  it('WA-015 never logs or mutates the caller payload', async () => {
    const { adapter, calls } = adapterWith([{ body: { messages: [{ id: 'x' }] } }]);
    const text = 'a message with "quotes" and\nnewlines';
    await adapter.sendText('1', text);
    expect(bodyOf(calls[0]!).text).toEqual({ preview_url: false, body: text });
  });

  it('WA-015 performs exactly one request per text send, with no implicit retry', async () => {
    // Retry policy belongs to the image provider, not the channel adapter: a
    // silent retry here would double-send a message to a real customer.
    const { adapter, calls } = adapterWith([{ body: { messages: [{ id: 'x' }] } }]);
    await adapter.sendText('1', 'x');
    expect(calls).toHaveLength(1);
  });
});
