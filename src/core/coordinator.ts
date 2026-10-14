import { config } from '../config.js';
import { logger } from '../logger.js';
import type { InboundMessage } from '../types.js';
import { TurnBuffer } from './turns.js';

/**
 * Batches bursty inbound messages and emits exactly one assembled event per
 * user turn.
 *
 * This exists for UX correctness: a person sending three garment photos
 * produces three separate events, and rendering them as three separate
 * conversations (or processing them as three turns) would both look broken and
 * triple the generation cost.
 */
export type AssembledTurn = {
  contactId: string;
  messages: InboundMessage[];
};

export class TurnCoordinator {
  private readonly buffer: TurnBuffer<InboundMessage>;
  private readonly handlers = new Set<(turn: AssembledTurn) => void>();

  constructor(
    private readonly windowMs: number = config.pipeline.debounceMs,
    /** Runs the assembled turn. Injected so this stays pipeline-agnostic. */
    private readonly processBatch?: (messages: InboundMessage[]) => Promise<void>,
  ) {
    this.buffer = new TurnBuffer<InboundMessage>(windowMs);
  }

  onTurn(handler: (turn: AssembledTurn) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Adds a message to the open window. Resolves once the whole turn has been
   * processed, so callers that await it observe the completed turn.
   *
   * The HTTP layers deliberately do not await this: a turn can take a minute,
   * and the channels already receive progress over their own transports.
   */
  submit(message: InboundMessage): Promise<void> {
    const key = message.externalContactId;
    const batch = this.buffer.add(key, message);
    return batch.then((messages) => this.emit(key, messages));
  }

  /** Emits immediately, bypassing the debounce (used by tests). */
  flush(key: string): void {
    const messages = this.buffer.flush(key);
    if (messages.length > 0) void this.emit(key, messages);
  }

  get pendingWindows(): number {
    return this.buffer.size;
  }

  private async emit(key: string, messages: InboundMessage[]): Promise<void> {
    const turn: AssembledTurn = { contactId: key, messages };
    for (const handler of this.handlers) {
      try {
        handler(turn);
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : err },
          'turn handler threw',
        );
      }
    }

    if (this.processBatch) {
      await this.processBatch(messages);
    }
  }
}
