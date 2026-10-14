import { EventEmitter } from 'node:events';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { blobStore, buildAssetKey } from '../media/store.js';
import type { DeliveryAdapter, OutboundAsset } from './types.js';

/**
 * Event surfaced to the simulator UI so a browser can render the conversation
 * in real time. Kept intentionally flat and JSON-serialisable.
 */
export type SimEvent = {
  sessionKey: string;
  direction: 'inbound' | 'outbound';
  kind: 'text' | 'image';
  text?: string;
  assetId?: string;
  url?: string;
  at: string;
};

type SimEvents = {
  event: [SimEvent];
};

class SimBus extends EventEmitter<SimEvents> {
  publish(event: SimEvent): void {
    this.emit('event', event);
  }
  subscribe(listener: (event: SimEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const simBus = new SimBus();

/**
 * Local channel used by the bundled chat UI. Conversations are keyed by a
 * browser-generated client id, namespaced as `sim:<id>` so it can never collide
 * with a real WhatsApp wa_id.
 */
export class SimulatorAdapter implements DeliveryAdapter {
  readonly name = 'simulator';

  async sendText(to: string, text: string) {
    logger.debug({ to, chars: text.length }, '[simulator] outbound text');
    simBus.publish({
      sessionKey: to,
      direction: 'outbound',
      kind: 'text',
      text,
      at: new Date().toISOString(),
    });
    return { externalId: `sim:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` };
  }

  async sendImage(to: string, asset: OutboundAsset, caption?: string) {
    logger.debug({ to, assetId: asset.id }, '[simulator] outbound image');
    const event: SimEvent = {
      sessionKey: to,
      direction: 'outbound',
      kind: 'image',
      assetId: asset.id,
      url: `/media/${asset.id}`,
      at: new Date().toISOString(),
    };
    if (caption) event.text = caption;
    simBus.publish(event);
    return { externalId: `sim:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` };
  }

  /**
   * The simulator's inbound media is written to the blob store by the upload
   * route, which refers to it as a `/sim/blob/<key>` URL so that the same value
   * can be rendered directly by the browser and resolved here.
   */
  async downloadMedia(externalId: string) {
    const key = blobKeyFromExternalRef(externalId);
    const data = await blobStore.get(key);
    const ext = path.extname(key).toLowerCase();
    const mime =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { mime, data };
  }

  /** Publishes an inbound turn event to the simulator UI. */
  publishInbound(event: Omit<SimEvent, 'direction' | 'at'> & { at?: string }): void {
    simBus.publish({
      ...event,
      direction: 'inbound',
      at: event.at ?? new Date().toISOString(),
    });
  }
}

export const simulatorAdapter = new SimulatorAdapter();

/** URL namespace for simulator-hosted bytes. */
export const BLOB_PREFIX = '/sim/blob/';

/** URLs are handed to the UI and the pipeline alike; invert one back to a key. */
export function blobKeyFromExternalRef(externalId: string): string {
  if (externalId.startsWith(BLOB_PREFIX)) {
    return decodeURIComponent(externalId.slice(BLOB_PREFIX.length));
  }
  return externalId;
}

export function blobUrlFor(key: string): string {
  return `${BLOB_PREFIX}${encodeURIComponent(key)}`;
}

/**
 * Persists bytes the simulator received over HTTP.
 *
 * Used only by the local simulator; the WhatsApp path downloads media from Meta
 * instead. The returned key is what `downloadMedia` later resolves.
 */
export async function storeSimulatorUpload(
  data: Uint8Array,
  ext: string,
): Promise<string> {
  const key = buildAssetKey(ext, 'sim');
  await blobStore.put(key, data);
  return key;
}

/** Resolves the configured delivery adapter, validating its credentials. */
export async function createDeliveryAdapter(): Promise<DeliveryAdapter> {
  switch (config.messaging.channel) {
    case 'simulator':
      return simulatorAdapter;
    case 'console':
      return new (await import('./console.js')).ConsoleAdapter();
    case 'whatsapp': {
      const { WhatsAppAdapter } = await import('./whatsapp.js');
      return new WhatsAppAdapter();
    }
  }
}
