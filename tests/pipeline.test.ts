import { beforeEach, describe, expect, it } from 'vitest';
import { Repo } from '../src/db/repo.js';
import { createTestDb } from '../src/db/migrate.js';
import { KeyedLock, Pipeline } from '../src/core/pipeline.js';
import { TurnBuffer } from '../src/core/turns.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { FakeImageProvider } from './helpers/fake-provider.js';
import { makePng } from './fixtures/png.js';
import type { InboundMessage } from '../src/types.js';

/**
 * End-to-end tests over the real pipeline: real SQLite schema, real blob store,
 * real state machine. Only the two external boundaries (channel + image engine)
 * are faked, which is exactly where the seams are designed to be.
 */

const CONTACT = 'sim:test-user';
const TARGET = 'wa:919999999999';

type Harness = {
  repo: Repo;
  adapter: FakeAdapter;
  provider: FakeImageProvider;
  pipeline: Pipeline;
  imageMessage(externalId?: string, text?: string): InboundMessage;
  textMessage(text: string, externalId?: string): InboundMessage;
  send(message: InboundMessage): Promise<void>;
};

let counter = 0;

function makeHarness(): Harness {
  const repo = new Repo(createTestDb());
  const adapter = new FakeAdapter();
  const provider = new FakeImageProvider({ garment: 'a chartreuse silk wrap dress' });
  const pipeline = new Pipeline({ repo, adapter, provider });

  function registerImage(): string {
    const mediaId = `media-${(counter += 1)}`;
    adapter.media.set(mediaId, { mime: 'image/png', data: makePng(200, 260) });
    return mediaId;
  }

  let messageCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${(messageCounter += 1)}`;

  return {
    repo,
    adapter,
    provider,
    pipeline,
    imageMessage(externalId = nextId('img'), text) {
      const mediaId = registerImage();
      return {
        externalContactId: CONTACT,
        displayName: 'Test User',
        externalMessageId: externalId,
        receivedAt: new Date(),
        attachments: [{ externalId: mediaId, mime: 'image/png' }],
        ...(text ? { text } : {}),
      };
    },
    textMessage(text, externalId = nextId('txt')) {
      return {
        externalContactId: CONTACT,
        displayName: 'Test User',
        externalMessageId: externalId,
        receivedAt: new Date(),
        attachments: [],
        text,
      };
    },
    async send(message) {
      await pipeline.handleInbound(message);
    },
  };
}

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

/** Runs the conversation up to the point where a shot has been generated. */
async function reachReview(hh: Harness): Promise<void> {
  await hh.send(hh.imageMessage());
  await hh.send(hh.textMessage('studio, white background, walking pose'));
  await hh.send(hh.textMessage('go'));
  expect(hh.adapter.said(/Here it is/)).toBe(true);
}

describe('happy path', () => {
  it('CONV-003 UX-001 UX-002 asks for a photo before doing anything else', async () => {
    await h.send(h.textMessage('hello'));
    expect(h.adapter.said(/Send me photos|send me the photo/i)).toBe(true);
  });

  it('CONV-015 walks from garment photo to approved catalog shot', async () => {
    await h.send(h.imageMessage());
    expect(h.adapter.said(/Got your photo/)).toBe(true);

    await h.send(h.textMessage('studio, white background, walking pose'));
    // Confirm-before-generate is the main cost-control and quality lever.
    expect(h.adapter.said(/Here's the brief/)).toBe(true);
    expect(h.provider.callCount).toBe(0);

    await h.send(h.textMessage('go'));
    expect(h.provider.callCount).toBe(1);
    expect(h.adapter.images()).toHaveLength(1);

    await h.send(h.textMessage('1'));
    expect(h.adapter.said(/Saved to your catalog/)).toBe(true);

    const session = h.repo.getActiveSession(
      h.repo.ensureContact(h.repo.ensureDefaultOrg().id, CONTACT).id,
    );
    // Approved sessions are terminal, so no active session should remain.
    expect(session).toBeUndefined();

    const org = h.repo.ensureDefaultOrg();
    const products = h.repo.listProducts(org.id);
    expect(products).toHaveLength(1);
    expect(products[0]!.title).toContain('chartreuse');

    const links = h.repo.listProductAssets(products[0]!.id);
    const hero = links.find((l) => l.role === 'hero');
    expect(hero).toBeDefined();
    expect(hero!.asset.kind).toBe('generated');
  });

  it('BRIEF-005 BRIEF-007 COST-002 sends the brief for confirmation before spending money', async () => {
    await h.send(h.imageMessage());
    await h.send(h.textMessage('outdoor rooftop, golden hour'));
    expect(h.provider.callCount).toBe(0);
    expect(h.adapter.said(/Reply \*go\* to generate/)).toBe(true);
  });
});

describe('review loop', () => {
  it('ITER-001 turns plain feedback into a chained edit rather than a fresh shot', async () => {
    await reachReview(h);
    const firstRequest = h.provider.lastRequest();
    expect(firstRequest?.previousInteractionId).toBeUndefined();

    await h.send(h.textMessage('2, make the lighting warmer'));
    expect(h.provider.callCount).toBe(2);

    const revision = h.provider.lastRequest()!;
    // Chaining is what preserves the garment print between iterations.
    expect(revision.previousInteractionId).toBe('interaction-1');
    expect(revision.prompt).toMatch(/REVISION/);
    expect(revision.prompt).toContain('make the lighting warmer');
    // The previous output must be supplied as a reference for the edit to be targeted.
    expect(revision.refs.length).toBeGreaterThan(1);
    expect(h.adapter.said(/Revised/)).toBe(true);
  });

  it('CONV-009 treats unrecognised review text as revision feedback', async () => {
    await reachReview(h);
    await h.send(h.textMessage('could you make it feel more summery'));
    expect(h.provider.callCount).toBe(2);
    expect(h.provider.lastRequest()!.prompt).toContain('more summery');
  });

  it('CONV-012 produces multiple distinct variations', async () => {
    await reachReview(h);
    await h.send(h.textMessage('3'));
    expect(h.provider.callCount).toBe(1 + 4);
    // Four variations plus the original hero shot.
    expect(h.adapter.images().length).toBe(5);

    const prompts = h.provider.calls.map((c) => c.prompt);
    const variationPrompts = prompts.filter((p) => /ALTERNATES/.test(p));
    expect(variationPrompts.length).toBe(4);
    expect(new Set(variationPrompts).size).toBe(4);
  });

  it('ITER-002 does not chain variations off one another', async () => {
    await reachReview(h);
    await h.send(h.textMessage('3'));
    const after = h.provider.calls.slice(1);
    for (const call of after) {
      expect(call.previousInteractionId).toBeUndefined();
    }
  });

  it('CONV-013 shows the brief on request', async () => {
    await reachReview(h);
    await h.send(h.textMessage('4'));
    expect(h.adapter.lastText()).toMatch(/Garment:/);
  });

  it('CONV-014 cancels on request', async () => {
    await reachReview(h);
    await h.send(h.textMessage('5'));
    expect(h.adapter.said(/Cancelled/)).toBe(true);
  });

  it('CONV-007 accepts approval by word as well as by digit', async () => {
    await reachReview(h);
    await h.send(h.textMessage('looks good'));
    expect(h.adapter.said(/Saved to your catalog/)).toBe(true);
  });
});

describe('failure handling', () => {
  it('GEN-013 GEN-016 returns to review when a revision fails, so the user can retry', async () => {
    await reachReview(h);
    h.provider.nextError = new (await import('../src/imaging/types.js')).ImageProviderError(
      'upstream exploded',
      'provider',
      true,
      503,
    );

    await h.send(h.textMessage('2, shorter sleeves'));
    expect(h.adapter.said(/generation failed|try again/i)).toBe(true);

    // The original shot must survive a failed revision.
    const contact = h.repo.ensureContact(h.repo.ensureDefaultOrg().id, CONTACT);
    const session = h.repo.getActiveSession(contact.id)!;
    expect(session.stage).toBe('review');
    expect(session.last_output_asset_id).toBeTruthy();
  });

  it('CONTENT-005 GEN-009 GEN-014 explains a content-policy refusal and keeps the brief recoverable', async () => {
    await h.send(h.imageMessage());
    await h.send(h.textMessage('studio shot'));
    h.provider.nextError = new (await import('../src/imaging/types.js')).ImageProviderError(
      'safety blocked',
      'content_policy',
      false,
    );

    await h.send(h.textMessage('go'));
    expect(h.adapter.said(/declined that one/i)).toBe(true);

    const contact = h.repo.ensureContact(h.repo.ensureDefaultOrg().id, CONTACT);
    // No output exists yet, so the user must be able to adjust the brief.
    expect(h.repo.getActiveSession(contact.id)!.stage).toBe('confirm_brief');
  });

  it('GEN-012 records a failed generation with its error for later diagnosis', async () => {
    await h.send(h.imageMessage());
    await h.send(h.textMessage('studio shot'));
    h.provider.nextError = new (await import('../src/imaging/types.js')).ImageProviderError(
      'rate limited',
      'provider',
      true,
      429,
    );
    await h.send(h.textMessage('go'));

    const contact = h.repo.ensureContact(h.repo.ensureDefaultOrg().id, CONTACT);
    const session = h.repo.getActiveSession(contact.id)!;
    const generation = h.repo.lastGeneration(session.id)!;
    expect(generation.status).toBe('failed');
    expect(generation.error).toContain('rate limited');
  });

  it('UX-004 MED-006 rejects an unreadable upload with a specific message and generates nothing', async () => {
    const mediaId = 'media-garbage';
    h.adapter.media.set(mediaId, {
      mime: 'image/jpeg',
      data: new TextEncoder().encode('definitely not an image'),
    });

    await h.send({
      externalContactId: CONTACT,
      externalMessageId: 'bad-1',
      receivedAt: new Date(),
      attachments: [{ externalId: mediaId }],
    });

    expect(h.adapter.said(/JPG, PNG, or WebP/)).toBe(true);
    expect(h.provider.callCount).toBe(0);
  });

  it('UX-004 UX-003 survives a media download failure without going silent', async () => {
    await h.send({
      externalContactId: CONTACT,
      externalMessageId: 'missing-1',
      receivedAt: new Date(),
      attachments: [{ externalId: 'does-not-exist' }],
    });
    expect(h.adapter.said(/trouble downloading|try sending it again/i)).toBe(true);
  });

  it('COST-001 enforces the per-session generation cap to bound cost', async () => {
    await reachReview(h);
    // Drive past the cap with repeated variation requests.
    for (let i = 0; i < 6; i += 1) {
      await h.send(h.textMessage('3'));
    }
    expect(h.adapter.said(/generation limit/i)).toBe(true);

    const contact = h.repo.ensureContact(h.repo.ensureDefaultOrg().id, CONTACT);
    const session = h.repo.getActiveSession(contact.id)!;
    expect(session.generation_count).toBeLessThanOrEqual(15);
  });
});

describe('idempotency', () => {
  it('CONV-004 ignores a re-delivered webhook with the same message id', async () => {
    const message = h.imageMessage('duplicate-1');
    await h.send(message);
    const afterFirst = h.adapter.sent.length;

    await h.send(message);
    expect(h.adapter.sent.length).toBe(afterFirst);
  });

  it('SEC-005 does not double-generate when the same "go" is delivered twice', async () => {
    await h.send(h.imageMessage());
    await h.send(h.textMessage('studio shot'));
    const go = h.textMessage('go', 'go-once');
    await h.send(go);
    await h.send(go);
    expect(h.provider.callCount).toBe(1);
  });
});

describe('multi-item sessions', () => {
  it('CONV-016 starts a fresh item when new photos arrive after a review', async () => {
    await reachReview(h);
    await h.send(h.imageMessage());
    expect(h.adapter.said(/Starting a new item/)).toBe(true);

    const contact = h.repo.ensureContact(h.repo.ensureDefaultOrg().id, CONTACT);
    const session = h.repo.getActiveSession(contact.id)!;
    expect(session.stage).toBe('collecting_brief');
    // The new item must not inherit the previous item's approved output.
    expect(session.last_output_asset_id).toBeNull();
  });

  it('CONV-017 captures a SKU mentioned in the brief', async () => {
    await h.send(h.imageMessage());
    await h.send(h.textMessage('sku: DRESS-001, studio, white background'));
    await h.send(h.textMessage('go'));
    await h.send(h.textMessage('1'));

    const org = h.repo.ensureDefaultOrg();
    const products = h.repo.listProducts(org.id);
    expect(products[0]!.sku).toBe('DRESS-001');
  });

  /**
   * Regression: re-photographing a garment that already has a SKU used to throw
   * `UNIQUE constraint failed: products.org_id, products.sku` out of the turn.
   * The user saw only the generic error copy, and because the inbound message
   * was already recorded, Meta's retry of the same wamid was suppressed — the
   * text was lost for good.
   */
  it('CATALOG-001 CATALOG-002 a repeated SKU reuses the product instead of aborting the turn', async () => {
    await h.send(h.imageMessage());
    await h.send(h.textMessage('sku: DRESS-001, studio, white background'));
    await h.send(h.textMessage('go'));
    await h.send(h.textMessage('1'));

    const org = h.repo.ensureDefaultOrg();
    const contact = h.repo.ensureContact(org.id, CONTACT);
    const first = h.repo.listProducts(org.id)[0]!;
    expect(first.sku).toBe('DRESS-001');

    // The same garment, photographed again, with the same SKU.
    await h.send(h.imageMessage());
    await h.send(h.textMessage('sku: DRESS-001, different backdrop'));

    // The turn must not fail, the session must survive, and the item must be
    // linked to the one product that owns this SKU.
    expect(h.adapter.said(/Something went wrong/i)).toBe(false);
    const session = h.repo.getActiveSession(contact.id);
    expect(session).toBeDefined();
    expect(session!.stage).toBe('confirm_brief');
    expect(session!.product_id).toBe(first.id);

    const products = h.repo.listProducts(org.id);
    expect(products).toHaveLength(1);
    expect(products[0]!.sku).toBe('DRESS-001');
  });

  it('CONV-018 allows an explicit reset from any stage, including mid-review', async () => {
    await reachReview(h);
    await h.send(h.textMessage('start over'));

    expect(h.adapter.said(/catalog studio|Send me photos|garment/i)).toBe(true);
    const contact = h.repo.ensureContact(h.repo.ensureDefaultOrg().id, CONTACT);
    // The previous item is banked, not resumed.
    const session = h.repo.getActiveSession(contact.id)!;
    expect(session.stage).toBe('idle');
    expect(session.last_output_asset_id).toBeNull();
  });

  it('CONV-019 does not treat a mid-flow "new" as brief text', async () => {
    await h.send(h.imageMessage());
    await h.send(h.textMessage('new item'));

    const contact = h.repo.ensureContact(h.repo.ensureDefaultOrg().id, CONTACT);
    expect(h.repo.getActiveSession(contact.id)!.stage).toBe('idle');
    expect(h.provider.callCount).toBe(0);
  });
});

describe('batching photos into one turn', () => {
  it('BATCH-002 COST-005 SIM-001 replies once for three photos uploaded together', async () => {
    const buffer = new TurnBuffer<InboundMessage>(25);
    const messages = [h.imageMessage(), h.imageMessage(), h.imageMessage()];

    const batches = await Promise.all(
      messages.map((m, index) => buffer.add(`contact-${index % 1}`, m)),
    );

    // All three land in a single batch, so the pipeline runs them as one turn.
    const batch = batches[0]!;
    expect(batch).toHaveLength(3);

    for (const message of batch) await h.send(message);

    const greeted = h.adapter.texts().filter((t) => /Got/.test(t));
    expect(greeted).toHaveLength(1);

    const contact = h.repo.ensureContact(h.repo.ensureDefaultOrg().id, CONTACT);
    expect(h.repo.getActiveSession(contact.id)!.stage).toBe('collecting_brief');
  });

  it('BATCH-001 handles a whole batch in one call, keeping every photo as a reference', async () => {
    const messages = [h.imageMessage(), h.imageMessage(), h.imageMessage()];
    await h.pipeline.handleBatch(messages);

    const contact = h.repo.ensureContact(h.repo.ensureDefaultOrg().id, CONTACT);
    const session = h.repo.getActiveSession(contact.id)!;

    // One prompt to the user, but all three garments retained as references.
    expect(h.adapter.texts().filter((t) => /Got/.test(t))).toHaveLength(1);
    const refs = JSON.parse(session.refs_json ?? '[]') as string[];
    expect(refs).toHaveLength(3);
  });

  it('BATCH-004 processes the caption only after every photo in the batch is attached', async () => {
    // Text must be acted on last: otherwise a trailing caption would be consumed
    // before the remaining photos were attached to the item.
    await h.pipeline.handleBatch([
      h.imageMessage(),
      h.imageMessage(),
      h.textMessage('studio, white background'),
    ]);

    expect(h.adapter.said(/Here's the brief/)).toBe(true);
    const contact = h.repo.ensureContact(h.repo.ensureDefaultOrg().id, CONTACT);
    const session = h.repo.getActiveSession(contact.id)!;
    expect(session.stage).toBe('confirm_brief');

    const refs = JSON.parse(session.refs_json ?? '[]') as string[];
    expect(refs).toHaveLength(2);
  });

  it('BATCH-005 suppresses duplicates within a single batch', async () => {
    const message = h.imageMessage('same-id');
    await h.pipeline.handleBatch([message, message]);

    const org = h.repo.ensureDefaultOrg();
    const contact = h.repo.ensureContact(org.id, CONTACT);
    const session = h.repo.getActiveSession(contact.id)!;
    const refs = JSON.parse(session.refs_json ?? '[]') as string[];
    // The duplicate is dropped before it can be attached twice.
    expect(refs).toHaveLength(1);
  });

  it('BATCH-006 ignores an empty batch', async () => {
    await h.pipeline.handleBatch([]);
    expect(h.adapter.sent).toHaveLength(0);
  });
});

describe('catalog export', () => {
  it('CATALOG-007 exports approved items as CSV including the hero asset', async () => {
    await reachReview(h);
    await h.send(h.textMessage('1'));

    const { catalogToCsv, listCatalog } = await import('../src/core/catalog.js');
    const org = h.repo.ensureDefaultOrg();
    const entries = listCatalog(h.repo, org.id);
    expect(entries).toHaveLength(1);

    const csv = catalogToCsv(entries);
    expect(csv.split('\n')[0]).toContain('sku,title');
    expect(csv).toContain(entries[0]!.heroAssetId!);
  });
});

describe('whatsapp target isolation', () => {
  it('SIM-009 CFG-002 keeps simulator and whatsapp contacts in separate sessions', async () => {
    const org = h.repo.ensureDefaultOrg();
    const waContact = h.repo.ensureContact(org.id, TARGET, 'Real User');
    const simContact = h.repo.ensureContact(org.id, CONTACT, 'Sim User');

    const waSession = h.repo.ensureActiveSession(waContact.id);
    const simSession = h.repo.ensureActiveSession(simContact.id);
    expect(waSession.id).not.toBe(simSession.id);

    h.repo.updateSession(waSession.id, { stage: 'review' });
    expect(h.repo.getSession(simSession.id)!.stage).toBe('idle');
  });
});

describe('state machine integrity', () => {
  it('CONV-001 enumerates exactly the documented stages', async () => {
    // Asserted against src/types.ts, the single source the router and the
    // database both use. A stage added without a route would be a defect.
    const { STAGES } = await import('../src/types.js');
    expect([...STAGES]).toEqual([
      'idle',
      'collecting_images',
      'collecting_brief',
      'confirm_brief',
      'generating',
      'review',
      'approved',
      'cancelled',
    ]);
  });

  it('CONV-002 does not resume a terminal session', async () => {
    const org = h.repo.ensureDefaultOrg();
    const contact = h.repo.ensureContact(org.id, CONTACT);

    // Drive one item to a terminal state.
    await reachReview(h);
    await h.send(h.textMessage('1'));
    expect(
      h.repo.getActiveSession(contact.id),
      'approved sessions must not remain active',
    ).toBeUndefined();

    // The next inbound message must open a brand-new session.
    await h.send(h.textMessage('hello'));
    const fresh = h.repo.getActiveSession(contact.id)!;
    expect(fresh.stage).toBe('idle');
    expect(fresh.last_output_asset_id).toBeNull();
  });
});

/**
 * Resolves after one microtask-queue turn.
 *
 * The lock deletes its entry from a `.finally()` handler, which runs after the
 * caller's `await` resumes, so asserting on `size` immediately would race.
 */
const afterCleanup = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('per-session serialisation', () => {
  /**
   * Regression: the lock stored `next.catch(...)`, a *new* promise, while the
   * cleanup compared the stored promise against `next`. They were never equal,
   * so no entry was ever deleted and the map grew by one entry for every
   * distinct contact the process ever saw.
   */
  it('CONV-004 releases its chain entry once a turn finishes', async () => {
    const lock = new KeyedLock();
    await lock.run('contact-a', async () => undefined);
    await afterCleanup();

    expect(lock.size).toBe(0);

    // Many distinct contacts must not accumulate.
    for (let i = 0; i < 200; i += 1) {
      await lock.run(`contact-${i}`, async () => undefined);
    }
    await afterCleanup();
    expect(lock.size).toBe(0);
  });

  it('CONV-004 keeps a chain entry while work is still in flight', async () => {
    const lock = new KeyedLock();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const running = lock.run('contact-a', async () => {
      await gate;
    });
    expect(lock.size).toBe(1);

    release();
    await running;
    await afterCleanup();
    expect(lock.size).toBe(0);
  });

  it('CONV-004 serialises overlapping turns for the same contact', async () => {
    const lock = new KeyedLock();
    const order: string[] = [];

    const first = lock.run('contact-a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('first');
    });
    const second = lock.run('contact-a', async () => {
      order.push('second');
    });

    await Promise.all([first, second]);
    // FIFO: the second turn cannot start before the first finishes.
    expect(order).toEqual(['first', 'second']);
  });

  it('CONV-004 does not let a failed turn reject the next one', async () => {
    const lock = new KeyedLock();

    await expect(
      lock.run('contact-a', async () => {
        throw new Error('turn failed');
      }),
    ).rejects.toThrow('turn failed');

    await expect(lock.run('contact-a', async () => 'recovered')).resolves.toBe('recovered');
    await afterCleanup();
    expect(lock.size).toBe(0);
  });
});
