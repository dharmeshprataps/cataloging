import { beforeEach, describe, expect, it } from 'vitest';
import { Repo } from '../src/db/repo.js';
import { createTestDb } from '../src/db/migrate.js';
import { Pipeline } from '../src/core/pipeline.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { FakeImageProvider } from './helpers/fake-provider.js';
import { makePng } from './fixtures/png.js';
import type { InboundMessage } from '../src/types.js';

/**
 * Conversation requirements that the end-to-end tests in `pipeline.test.ts`
 * exercise only indirectly.
 *
 * `SPEC-0001` requires each requirement to be proven by a test that asserts it
 * specifically, rather than by a neighbouring test that happens to traverse the
 * same code. That distinction is the whole point of the traceability gate: a
 * requirement covered by accident is unverified.
 */

const CONTACT = 'sim:conversation';

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

function harness() {
  const repo = new Repo(createTestDb());
  const adapter = new FakeAdapter();
  const provider = new FakeImageProvider({ garment: 'a wool coat' });
  const pipeline = new Pipeline({ repo, adapter, provider });

  const org = repo.ensureDefaultOrg();
  const contact = repo.ensureContact(org.id, CONTACT);

  function image(text?: string): InboundMessage {
    const mediaId = nextId('media');
    adapter.media.set(mediaId, { mime: 'image/png', data: makePng(200, 260) });
    return {
      externalContactId: CONTACT,
      displayName: 'Tester',
      externalMessageId: nextId('msg'),
      receivedAt: new Date(),
      attachments: [{ externalId: mediaId }],
      ...(text ? { text } : {}),
    };
  }

  function text(body: string): InboundMessage {
    return {
      externalContactId: CONTACT,
      displayName: 'Tester',
      externalMessageId: nextId('msg'),
      receivedAt: new Date(),
      attachments: [],
      text: body,
    };
  }

  const send = (m: InboundMessage) => pipeline.handleInbound(m);

  /** Gets to `review` with a real output present. */
  async function reachReview(): Promise<void> {
    await send(image());
    await send(text('studio, white background'));
    await send(text('go'));
  }

  return { repo, adapter, provider, pipeline, contact, image, text, send, reachReview };
}

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

const stage = () => h.repo.getActiveSession(h.contact.id)?.stage;

describe('review command vocabulary', () => {
  it('CONV-006 every numbered command produces its documented effect', async () => {
    await h.reachReview();

    // 4 = details: returns the brief without side effects.
    await h.send(h.text('4'));
    expect(h.adapter.lastText()).toMatch(/Garment:/);
    expect(stage()).toBe('review');

    // 3 = variations: produces more shots.
    const beforeVariations = h.provider.callCount;
    await h.send(h.text('3'));
    expect(h.provider.callCount).toBeGreaterThan(beforeVariations);

    // 2 = revise: one more generation, still in review.
    const beforeRevise = h.provider.callCount;
    await h.send(h.text('2, warmer light'));
    expect(h.provider.callCount).toBe(beforeRevise + 1);
    expect(stage()).toBe('review');

    // 1 = approve: terminal.
    await h.send(h.text('1'));
    expect(h.repo.getActiveSession(h.contact.id)).toBeUndefined();
  });

  it('CONV-006 the cancel command terminates the item', async () => {
    await h.reachReview();
    await h.send(h.text('5'));
    expect(h.adapter.said(/Cancelled/)).toBe(true);
    expect(h.repo.getActiveSession(h.contact.id)).toBeUndefined();
  });
});

describe('pleasantries', () => {
  it('CONV-010 acknowledges thanks without spending a generation', async () => {
    await h.reachReview();
    const before = h.provider.callCount;

    for (const thanks of ['thanks', 'thank you', 'nice!', 'cool', '👍']) {
      await h.send(h.text(thanks));
    }

    // Interpreting praise as feedback would silently burn the budget.
    expect(h.provider.callCount).toBe(before);
    expect(h.adapter.said(/Glad you like it/)).toBe(true);
  });

  it('CONV-010 still treats descriptive text as feedback', async () => {
    await h.reachReview();
    const before = h.provider.callCount;
    // Contains no pleasantry keyword, so it must be acted on.
    await h.send(h.text('make the background a rooftop'));
    expect(h.provider.callCount).toBe(before + 1);
  });
});

describe('restart durability', () => {
  it('CONV-020 a new pipeline over the same store resumes the conversation', async () => {
    await h.send(h.image());
    await h.send(h.text('studio, white background'));
    const before = h.repo.getActiveSession(h.contact.id)!;
    expect(before.stage).toBe('confirm_brief');

    // A fresh Pipeline stands in for a process restart or redeploy: all
    // control-flow state must come from storage, never from instance memory.
    const restarted = new Pipeline({
      repo: h.repo,
      adapter: h.adapter,
      provider: h.provider,
    });

    await restarted.handleInbound(h.text('go'));
    expect(h.provider.callCount).toBe(1);

    const after = h.repo.getActiveSession(h.contact.id)!;
    expect(after.stage).toBe('review');
    expect(after.last_output_asset_id).toBeTruthy();
  });
});

describe('brief refinement', () => {
  it('BRIEF-006 a correction keeps the original request in the brief text', async () => {
    const seen: string[] = [];
    const realParse = h.provider.parseBrief.bind(h.provider);
    h.provider.parseBrief = async (input) => {
      seen.push(input.text);
      return realParse(input);
    };

    await h.send(h.image());
    await h.send(h.text('outdoor rooftop, golden hour'));
    // At confirm_brief, free text refines rather than restarts.
    await h.send(h.text('actually make it a studio'));

    expect(seen).toHaveLength(2);
    // Both the original instruction and the correction must reach the parser;
    // dropping the original would silently discard the user's first request.
    expect(seen[1]).toContain('outdoor rooftop');
    expect(seen[1]).toContain('actually make it a studio');
  });

  it('BRIEF-007 the brief carries aspect ratio and image size into the request', async () => {
    h.provider.setBrief({ aspectRatio: '1:1', imageSize: '1K' });

    await h.send(h.image());
    await h.send(h.text('square format please'));
    await h.send(h.text('go'));

    const request = h.provider.lastRequest()!;
    expect(request.aspectRatio).toBe('1:1');
    expect(request.imageSize).toBe('1K');
  });
});

describe('stage transitions', () => {
  it('CONV-005 a confirmed brief moves the item into review with an output', async () => {
    await h.send(h.image());
    await h.send(h.text('studio'));
    // Before confirming, the item must not be in review.
    expect(h.repo.getActiveSession(h.contact.id)!.stage).toBe('confirm_brief');

    await h.send(h.text('go'));

    const session = h.repo.getActiveSession(h.contact.id)!;
    expect(session.stage).toBe('review');
    expect(session.last_output_asset_id).toBeTruthy();
    expect(session.last_interaction_id).toBeTruthy();
  });

  it('UX-005 acknowledges the wait before the slow provider call begins', async () => {
    // Ordering matters: the user must be told work has started before tens of
    // seconds of silence, not after.
    let adapterStateAtProviderStart: string[] = [];
    const adapter = h.adapter;
    const realGenerate = h.provider.generate.bind(h.provider);
    h.provider.generate = async (req) => {
      adapterStateAtProviderStart = adapter.texts();
      return realGenerate(req);
    };

    await h.send(h.image());
    await h.send(h.text('studio'));
    await h.send(h.text('go'));

    expect(adapterStateAtProviderStart.join('\n')).toMatch(/On it|generating/i);
  });

  it('CONV-011 a revision carries the previous output as a reference', async () => {
    await h.reachReview();
    const first = h.provider.lastRequest()!;
    const originalRefCount = first.refs.length;

    await h.send(h.text('2, change the lighting'));

    const revision = h.provider.lastRequest()!;
    // The edit must be conditioned on the prior image, not just on words: that
    // is what preserves the garment between iterations.
    expect(revision.refs.length).toBe(originalRefCount + 1);
    expect(revision.previousInteractionId).toBeTruthy();
    expect(revision.prompt).toMatch(/REVISION/);
  });
});

describe('outbound recording', () => {
  it('WA-020 persists each outbound delivery with its channel id and status', async () => {
    await h.reachReview();

    const sessionId = h.repo.getActiveSession(h.contact.id)!.id;
    const outbound = h.repo.listMessages(sessionId).filter((m) => m.direction === 'outbound');

    // Every reply must be recorded: this is the audit trail for what a customer
    // was actually told, and it carries the channel id used for delivery status.
    expect(outbound.length).toBeGreaterThan(0);
    for (const message of outbound) {
      expect(message.external_id).toBeTruthy();
      expect(message.status).toBe('sent');
    }
    // The delivered image is recorded as an image, not as text.
    expect(outbound.some((m) => m.kind === 'image' && m.asset_id)).toBe(true);
  });
});
