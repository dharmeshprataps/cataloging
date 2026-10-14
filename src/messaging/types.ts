/**
 * The channel boundary.
 *
 * Everything above this interface is channel-agnostic. `whatsapp.ts` is the
 * only module that knows about Meta; `simulator.ts` implements the same
 * interface so the entire product can be built and tested with no Meta account.
 */

export type OutboundAsset = {
  id: string;
  mime: string;
  data: Uint8Array;
};

export type SentMessage = {
  /** Channel message id, when the channel returns one. */
  externalId?: string;
};

export type DeliveryAdapter = {
  readonly name: string;

  /** Deliver a plain text message. */
  sendText(to: string, text: string): Promise<SentMessage>;

  /** Deliver an image, optionally with a caption. */
  sendImage(to: string, asset: OutboundAsset, caption?: string): Promise<SentMessage>;

  /**
   * Fetch inbound media bytes by the channel's reference. WhatsApp requires two
   * authenticated hops (metadata then bytes); the simulator reads local files.
   */
  downloadMedia(externalId: string): Promise<{ mime: string; data: Uint8Array }>;

  /** Best-effort read receipt. Must never throw. */
  markRead?(externalMessageId: string): Promise<void>;
};
