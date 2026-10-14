import type { DeliveryAdapter, OutboundAsset, SentMessage } from '../../src/messaging/types.js';

export type RecordedMessage =
  | { kind: 'text'; to: string; text: string }
  | { kind: 'image'; to: string; assetId: string; caption?: string };

/**
 * In-memory channel. Deliberately records everything so tests can assert on the
 * exact conversational output rather than on internal state.
 */
export class FakeAdapter implements DeliveryAdapter {
  readonly name = 'fake';
  readonly sent: RecordedMessage[] = [];
  /** externalId -> bytes, standing in for the channel's media store. */
  readonly media = new Map<string, { mime: string; data: Uint8Array }>();
  markReadCalls: string[] = [];

  async sendText(to: string, text: string): Promise<SentMessage> {
    this.sent.push({ kind: 'text', to, text });
    return { externalId: `fake-text-${this.sent.length}` };
  }

  async sendImage(to: string, asset: OutboundAsset, caption?: string): Promise<SentMessage> {
    this.sent.push({
      kind: 'image',
      to,
      assetId: asset.id,
      ...(caption ? { caption } : {}),
    });
    return { externalId: `fake-image-${this.sent.length}` };
  }

  async downloadMedia(externalId: string) {
    const entry = this.media.get(externalId);
    if (!entry) throw new Error(`FakeAdapter has no media for ${externalId}`);
    return entry;
  }

  async markRead(externalMessageId: string): Promise<void> {
    this.markReadCalls.push(externalMessageId);
  }

  /** --- assertion helpers ------------------------------------------------- */

  /**
   * All outbound text, including image captions.
   *
   * Captions are part of what the user reads, so assertions must see them — a
   * bot that sends an image with no words at all would otherwise look correct.
   */
  texts(): string[] {
    return this.sent
      .map((m) => (m.kind === 'text' ? m.text : (m.caption ?? '')))
      .filter((t): t is string => t.length > 0);
  }

  lastText(): string {
    const texts = this.texts();
    return texts[texts.length - 1] ?? '';
  }

  images(): Array<Extract<RecordedMessage, { kind: 'image' }>> {
    return this.sent.filter(
      (m): m is Extract<RecordedMessage, { kind: 'image' }> => m.kind === 'image',
    );
  }

  /** True when any outbound text matches the supplied pattern. */
  said(pattern: RegExp): boolean {
    return this.texts().some((t) => pattern.test(t));
  }

  reset(): void {
    this.sent.length = 0;
    this.markReadCalls = [];
  }
}
