import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { InboundMessage } from '../types.js';
import type { DeliveryAdapter, OutboundAsset } from './types.js';

/**
 * Meta WhatsApp Cloud API adapter.
 *
 * This is the only module aware of Meta's payload shapes, media indirection,
 * and signature scheme. Everything upstream deals in `InboundMessage` and
 * `DeliveryAdapter`.
 */

const REQUIRED_ENV = ['accessToken', 'phoneNumberId', 'verifyToken', 'appSecret'] as const;

function ensureConfigured(): void {
  const wa = config.messaging.whatsapp;
  const missing = REQUIRED_ENV.filter((key) => !wa[key]);
  if (missing.length > 0) {
    throw new Error(
      `WhatsApp adapter is missing config: ${missing.join(', ')}. See docs/meta-setup.md.`,
    );
  }
}

/** ---------------------------------------------------------------------------
 * Signature verification
 *
 * Meta signs the raw request body with the app secret. Comparing against the
 * parsed body instead of the raw bytes is a common and dangerous mistake, so
 * the server captures the raw buffer for this route.
 * ------------------------------------------------------------------------- */

export function verifySignature(
  rawBody: Buffer | Uint8Array,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header) return false;
  const expected = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  const received = header.startsWith('sha256=') ? header.slice('sha256='.length) : header;

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  // timingSafeEqual throws on length mismatch, and length itself is not secret.
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** ---------------------------------------------------------------------------
 * Inbound payload parsing
 * ------------------------------------------------------------------------- */

type WaMediaPayload = {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
};

type WaMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WaMediaPayload;
  document?: WaMediaPayload;
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
};

type WaWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: WaMessage[];
        statuses?: Array<{
          id?: string;
          status?: string;
          errors?: Array<{ title?: string; message?: string }>;
        }>;
      };
    }>;
  }>;
};

export type ParsedWebhook = {
  messages: InboundMessage[];
  statuses: Array<{ externalId: string; status: string; error?: string }>;
};

/**
 * Normalises a webhook body into channel-neutral inbound messages.
 * Unsupported message types are dropped rather than crashing the handler,
 * since Meta will retry anything that returns a non-2xx.
 */
export function parseWebhook(body: WaWebhookBody): ParsedWebhook {
  const messages: InboundMessage[] = [];
  const statuses: ParsedWebhook['statuses'] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const status of value.statuses ?? []) {
        if (status.id && status.status) {
          statuses.push({
            externalId: status.id,
            status: status.status,
            ...(status.errors?.[0]?.message ? { error: status.errors[0].message } : {}),
          });
        }
      }

      const name = value.contacts?.[0]?.profile?.name;

      for (const raw of value.messages ?? []) {
        if (!raw.from || !raw.id) continue;

        const base = {
          externalContactId: raw.from,
          externalMessageId: raw.id,
          receivedAt: raw.timestamp
            ? new Date(Number(raw.timestamp) * 1000)
            : new Date(),
          attachments: [] as InboundMessage['attachments'],
          ...(name ? { displayName: name } : {}),
        };

        switch (raw.type) {
          case 'text': {
            const text = raw.text?.body;
            if (text) messages.push({ ...base, text });
            break;
          }
          case 'image':
          case 'document': {
            const media = raw.type === 'image' ? raw.image : raw.document;
            if (!media?.id) break;
            const caption = media.caption;
            messages.push({
              ...base,
              ...(caption ? { text: caption } : {}),
              attachments: [
                {
                  externalId: media.id,
                  ...(media.mime_type ? { mime: media.mime_type } : {}),
                },
              ],
            });
            break;
          }
          case 'interactive': {
            const reply = raw.interactive?.button_reply ?? raw.interactive?.list_reply;
            if (!reply) break;
            messages.push({
              ...base,
              // Map button taps onto the same vocabulary as typed commands.
              text: reply.title ?? reply.id ?? '',
              ...(reply.id ? { replyId: reply.id } : {}),
            });
            break;
          }
          default:
            logger.debug({ type: raw.type }, 'ignoring unsupported WhatsApp message type');
        }
      }
    }
  }

  return { messages, statuses };
}

/** ---------------------------------------------------------------------------
 * Adapter
 * ------------------------------------------------------------------------- */

export type WhatsAppCredentials = {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
};

export type WhatsAppAdapterDeps = {
  /**
   * Credential override. Present so the outbound path can be tested without
   * environment credentials and without a live Meta account — that path is
   * otherwise unexercised, which is the largest shipping risk in the project
   * (PRB-0003 G2).
   */
  credentials?: WhatsAppCredentials;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

export class WhatsAppAdapter implements DeliveryAdapter {
  readonly name = 'whatsapp';
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly phoneNumberId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: WhatsAppAdapterDeps = {}) {
    if (!deps.credentials) ensureConfigured();
    const wa = deps.credentials ?? {
      accessToken: config.messaging.whatsapp.accessToken!,
      phoneNumberId: config.messaging.whatsapp.phoneNumberId!,
      apiVersion: config.messaging.whatsapp.apiVersion,
    };
    this.token = wa.accessToken;
    this.phoneNumberId = wa.phoneNumberId;
    // Always pin the version so a Meta default change cannot silently alter behaviour.
    this.baseUrl = `https://graph.facebook.com/${wa.apiVersion}`;
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`WhatsApp API ${res.status} on ${path}: ${text.slice(0, 400)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return {};
    }
  }

  private extractMessageId(payload: unknown): string | undefined {
    const p = payload as { messages?: Array<{ id?: string }> };
    return p.messages?.[0]?.id;
  }

  async sendText(to: string, text: string) {
    const result = await this.post(`${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      // WhatsApp renders previews as clutter in a transactional flow.
      text: { preview_url: false, body: text },
    });
    const externalId = this.extractMessageId(result);
    return externalId ? { externalId } : {};
  }

  async sendImage(to: string, asset: OutboundAsset, caption?: string) {
    const mediaId = await this.uploadMedia(asset);
    const result = await this.post(`${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: { id: mediaId, ...(caption ? { caption } : {}) },
    });
    const externalId = this.extractMessageId(result);
    return externalId ? { externalId } : {};
  }

  /**
   * Media must be uploaded to Meta before it can be referenced in a message.
   * Returns the reusable media id.
   */
  private async uploadMedia(asset: OutboundAsset): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', asset.mime);
    form.append(
      'file',
      new Blob([new Uint8Array(asset.data)], { type: asset.mime }),
      `${asset.id}${asset.mime === 'image/png' ? '.png' : '.jpg'}`,
    );

    const res = await this.fetchImpl(`${this.baseUrl}/${this.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`WhatsApp media upload ${res.status}: ${text.slice(0, 400)}`);
    }
    const parsed = JSON.parse(text) as { id?: string };
    if (!parsed.id) throw new Error(`WhatsApp media upload returned no id: ${text.slice(0, 200)}`);
    return parsed.id;
  }

  /**
   * Inbound media is a two-hop dance: the media id resolves to a short-lived
   * URL, which then needs the same bearer token to fetch the bytes. The URL
   * expires, so bytes are persisted immediately by the caller.
   */
  async downloadMedia(externalId: string) {
    const metaRes = await this.fetchImpl(`${this.baseUrl}/${externalId}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!metaRes.ok) {
      const body = await metaRes.text();
      throw new Error(`WhatsApp media metadata ${metaRes.status}: ${body.slice(0, 300)}`);
    }
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) throw new Error('WhatsApp media metadata contained no url');

    const fileRes = await this.fetchImpl(meta.url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!fileRes.ok) {
      throw new Error(`WhatsApp media download ${fileRes.status}`);
    }
    const buffer = new Uint8Array(await fileRes.arrayBuffer());
    return {
      mime: meta.mime_type ?? fileRes.headers.get('content-type') ?? 'image/jpeg',
      data: buffer,
    };
  }

  async markRead(externalMessageId: string) {
    try {
      await this.post(`${this.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: externalMessageId,
      });
    } catch (err) {
      // Read receipts are cosmetic; never fail a turn over one.
      logger.debug(
        { err: err instanceof Error ? err.message : err },
        'markRead failed (ignored)',
      );
    }
  }
}
