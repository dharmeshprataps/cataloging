import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseWebhook, verifySignature } from '../src/messaging/whatsapp.js';

const SECRET = 'test-app-secret';

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifySignature', () => {
  const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));

  it('WA-003 SEC-002 accepts a correctly signed body', () => {
    expect(verifySignature(body, sign(body.toString()), SECRET)).toBe(true);
  });

  it('WA-004 rejects a missing signature header', () => {
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
  });

  it('WA-003 rejects a body that was modified in transit', () => {
    // This is the attack the signature exists to stop.
    const header = sign(body.toString());
    const tampered = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', extra: 1 }));
    expect(verifySignature(tampered, header, SECRET)).toBe(false);
  });

  it('WA-005 rejects a signature produced with a different secret', () => {
    expect(verifySignature(body, sign(body.toString(), 'other-secret'), SECRET)).toBe(false);
  });

  it('WA-006 rejects malformed and empty signature values without throwing', () => {
    expect(verifySignature(body, 'not-hex-at-all', SECRET)).toBe(false);
    expect(verifySignature(body, 'sha256=', SECRET)).toBe(false);
    expect(verifySignature(body, '', SECRET)).toBe(false);
  });

  it('WA-003 accepts a signature with or without the sha256= prefix', () => {
    const raw = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifySignature(body, raw, SECRET)).toBe(true);
    expect(verifySignature(body, `sha256=${raw}`, SECRET)).toBe(true);
  });
});

describe('parseWebhook', () => {
  function wrap(messages: unknown[], statuses?: unknown[]) {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'biz-id',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '123', display_phone_number: '15550001111' },
                contacts: [{ profile: { name: 'Aisha' }, wa_id: '919999999999' }],
                ...(messages.length ? { messages } : {}),
                ...(statuses ? { statuses } : {}),
              },
            },
          ],
        },
      ],
    };
  }

  it('WA-007 normalises a text message', () => {
    const parsed = parseWebhook(
      wrap([
        {
          from: '919999999999',
          id: 'wamid.TEXT',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'red linen dress' },
        },
      ]) as never,
    );

    expect(parsed.messages).toHaveLength(1);
    const message = parsed.messages[0]!;
    expect(message.externalContactId).toBe('919999999999');
    expect(message.externalMessageId).toBe('wamid.TEXT');
    expect(message.text).toBe('red linen dress');
    expect(message.displayName).toBe('Aisha');
    expect(message.receivedAt.getTime()).toBe(1_700_000_000_000);
    expect(message.attachments).toHaveLength(0);
  });

  it('WA-008 normalises an image message and keeps its caption as text', () => {
    const parsed = parseWebhook(
      wrap([
        {
          from: '919999999999',
          id: 'wamid.IMG',
          timestamp: '1700000000',
          type: 'image',
          image: { id: 'MEDIA_ID', mime_type: 'image/jpeg', caption: 'front view' },
        },
      ]) as never,
    );

    const message = parsed.messages[0]!;
    expect(message.text).toBe('front view');
    expect(message.attachments).toEqual([{ externalId: 'MEDIA_ID', mime: 'image/jpeg' }]);
  });

  it('WA-010 normalises a button reply into text plus an id', () => {
    const parsed = parseWebhook(
      wrap([
        {
          from: '919999999999',
          id: 'wamid.BTN',
          type: 'interactive',
          interactive: { button_reply: { id: 'approve', title: 'Approve' } },
        },
      ]) as never,
    );

    expect(parsed.messages[0]!.replyId).toBe('approve');
    expect(parsed.messages[0]!.text).toBe('Approve');
  });

  it('WA-011 ignores message types it cannot act on instead of throwing', () => {
    const parsed = parseWebhook(
      wrap([
        { from: '1', id: 'wamid.AUDIO', type: 'audio', audio: { id: 'x' } },
        { from: '1', id: 'wamid.LOC', type: 'location', location: { lat: 1, lng: 2 } },
      ]) as never,
    );
    expect(parsed.messages).toHaveLength(0);
  });

  it('WA-012 extracts delivery statuses separately from messages', () => {
    const parsed = parseWebhook(
      wrap([], [{ id: 'wamid.OUT', status: 'delivered' }]) as never,
    );
    expect(parsed.messages).toHaveLength(0);
    expect(parsed.statuses).toEqual([
      { externalId: 'wamid.OUT', status: 'delivered', error: undefined },
    ]);
  });

  it('WA-013 surfaces the error message on a failed status', () => {
    const parsed = parseWebhook(
      wrap(
        [],
        [
          {
            id: 'wamid.OUT',
            status: 'failed',
            errors: [{ title: 'Re-engagement', message: 'outside 24h window' }],
          },
        ],
      ) as never,
    );
    expect(parsed.statuses[0]!.error).toBe('outside 24h window');
  });

  it('WA-014 returns empty results for a malformed payload rather than throwing', () => {
    expect(parseWebhook({} as never)).toEqual({ messages: [], statuses: [] });
    expect(parseWebhook({ entry: [] } as never)).toEqual({ messages: [], statuses: [] });
  });
});
