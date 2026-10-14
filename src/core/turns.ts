import { config } from '../config.js';

/**
 * Batches bursty inbound messages into one logical turn.
 *
 * This is not an optimisation — it is required for correctness on WhatsApp.
 * A user sending three garment photos produces three separate webhook events,
 * and without batching the bot would acknowledge and generate three times.
 */
type PendingEntry<T> = {
  items: T[];
  timer: NodeJS.Timeout;
  resolve: (items: T[]) => void;
};

export class TurnBuffer<T> {
  private readonly pending = new Map<string, PendingEntry<T>>();

  constructor(private readonly windowMs: number = config.pipeline.debounceMs) {}

  /**
   * Adds an item to the open window for `key` and returns the full batch once
   * the window closes. Every caller for the same window receives the same
   * batch, so callers that await can act on the assembled turn.
   */
  add(key: string, item: T): Promise<T[]> {
    const existing = this.pending.get(key);
    if (existing) {
      existing.items.push(item);
      return new Promise<T[]>((resolve) => {
        const priorResolve = existing.resolve;
        existing.resolve = (items) => {
          priorResolve(items);
          resolve(items);
        };
      });
    }

    return new Promise<T[]>((resolve) => {
      const entry: PendingEntry<T> = {
        items: [item],
        resolve,
        timer: setTimeout(() => {
          this.pending.delete(key);
          entry.resolve(entry.items);
        }, this.windowMs),
      };
      // Do not hold the process open on a pending batch.
      entry.timer.unref?.();
      this.pending.set(key, entry);
    });
  }

  /** Immediately closes the window and returns whatever is buffered. */
  flush(key: string): T[] {
    const entry = this.pending.get(key);
    if (!entry) return [];
    clearTimeout(entry.timer);
    this.pending.delete(key);
    entry.resolve(entry.items);
    return entry.items;
  }

  get size(): number {
    return this.pending.size;
  }
}
