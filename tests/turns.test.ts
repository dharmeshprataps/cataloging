import { describe, expect, it } from 'vitest';
import { TurnBuffer } from '../src/core/turns.js';

describe('TurnBuffer', () => {
  it('BATCH-001 batches items added inside the window into one result', async () => {
    const buffer = new TurnBuffer<number>(30);

    const all = Promise.all([buffer.add('a', 1), buffer.add('a', 2), buffer.add('a', 3)]);
    const results = await all;

    // Every caller in the window observes the same assembled batch — this is
    // what stops three uploaded photos from becoming three generations.
    for (const batch of results) expect(batch).toEqual([1, 2, 3]);
  });

  it('BATCH-003 keeps separate keys independent', async () => {
    const buffer = new TurnBuffer<string>(20);
    const [a, b] = await Promise.all([buffer.add('a', 'x'), buffer.add('b', 'y')]);
    expect(a).toEqual(['x']);
    expect(b).toEqual(['y']);
  });

  it('BATCH-007 opens a fresh window after the previous one closes', async () => {
    const buffer = new TurnBuffer<number>(10);
    const first = await buffer.add('a', 1);
    const second = await buffer.add('a', 2);
    expect(first).toEqual([1]);
    expect(second).toEqual([2]);
  });

  it('BATCH-008 flush releases buffered items immediately', async () => {
    const buffer = new TurnBuffer<number>(10_000);
    const pending = buffer.add('a', 7);
    expect(buffer.size).toBe(1);

    const flushed = buffer.flush('a');
    expect(flushed).toEqual([7]);
    expect(await pending).toEqual([7]);
    expect(buffer.size).toBe(0);
  });

  it('BATCH-010 flush on an unknown key is a no-op', () => {
    const buffer = new TurnBuffer<number>(10);
    expect(buffer.flush('missing')).toEqual([]);
  });

  it('BATCH-009 calls each waiting caller exactly once', async () => {
    const buffer = new TurnBuffer<number>(15);
    let firstCalls = 0;
    let secondCalls = 0;

    const first = buffer.add('a', 1).then((items) => {
      firstCalls += 1;
      return items;
    });
    const second = buffer.add('a', 2).then((items) => {
      secondCalls += 1;
      return items;
    });

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual([1, 2]);
    expect(r2).toEqual([1, 2]);
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);
  });
});
