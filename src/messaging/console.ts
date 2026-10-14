import { logger } from '../logger.js';
import type { DeliveryAdapter, OutboundAsset } from './types.js';

/**
 * Prints deliveries to the log instead of sending them.
 *
 * Its real purpose is to exercise the WhatsApp code path (24h window rules,
 * template fallback, media refs) locally without credentials, so that turning
 * on the real channel is a config change rather than a debugging session.
 */
export class ConsoleAdapter implements DeliveryAdapter {
  readonly name = 'console';
  private readonly sent: Array<{ to: string; text?: string; assetId?: string }> = [];

  async sendText(to: string, text: string) {
    this.sent.push({ to, text });
    logger.info({ to, text }, '[console] outbound text');
    return { externalId: `console:${this.sent.length}` };
  }

  async sendImage(to: string, asset: OutboundAsset, caption?: string) {
    this.sent.push({ to, assetId: asset.id, ...(caption ? { text: caption } : {}) });
    logger.info({ to, assetId: asset.id, bytes: asset.data.length, caption }, '[console] outbound image');
    return { externalId: `console:${this.sent.length}` };
  }

  async downloadMedia(externalId: string): Promise<never> {
    throw new Error(
      `ConsoleAdapter cannot download media (${externalId}). Use MESSAGING_CHANNEL=simulator for local uploads.`,
    );
  }

  /** Test/observability hook. */
  history(): ReadonlyArray<{ to: string; text?: string; assetId?: string }> {
    return this.sent;
  }
}
