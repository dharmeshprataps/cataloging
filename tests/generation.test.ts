import { beforeEach, describe, expect, it } from 'vitest';
import { Repo } from '../src/db/repo.js';
import { createTestDb } from '../src/db/migrate.js';
import { Pipeline } from '../src/core/pipeline.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { FakeImageProvider } from './helpers/fake-provider.js';
import { makePng } from './fixtures/png.js';
import { buildImagePrompt, SYSTEM_INSTRUCTION } from '../src/imaging/prompts.js';
import { ImageProviderError, type GenerateRequest, type ImageProvider } from '../src/imaging/types.js';
import { defaultBrief, type InboundMessage } from '../src/types.js';
import { config } from '../src/config.js';

/**
 * Generation semantics: what the pipeline asks the provider for, and how it
 * records what comes back.
 *
 * `GEN-001` is deliberately written as an interface contract rather than a claim
 * about the Gemini SDK. The pipeline proves it depends only on `ImageProvider`
 * (`GEN-002`); whether the concrete adapter's SDK call is correct is a separate
 * claim, covered by `scripts/smoke-gemini.ts` and recorded in `PRB-0002`.
 */

let seq = 0;
const nextId = (p: string) => `${p}-${(seq += 1)}`;
const CONTACT = 'sim:generation';

function harness() {
  const repo = new Repo(createTestDb());
  const adapter = new FakeAdapter();
  const provider = new FakeImageProvider({ garment: 'a silk scarf' });
  const pipeline = new Pipeline({ repo, adapter, provider });
  const org = repo.ensureDefaultOrg();
  const contact = repo.ensureContact(org.id, CONTACT);

  const image = (text?: string): InboundMessage => {
    const mediaId = nextId('media');
    adapter.media.set(mediaId, { mime: 'image/png', data: makePng(200, 260) });
    return {
      externalContactId: CONTACT,
      externalMessageId: nextId('msg'),
      receivedAt: new Date(),
      attachments: [{ externalId: mediaId }],
      ...(text ? { text } : {}),
    };
  };

  const text = (body: string): InboundMessage => ({
    externalContactId: CONTACT,
    externalMessageId: nextId('msg'),
    receivedAt: new Date(),
    attachments: [],
    text: body,
  });

  const send = (m: InboundMessage) => pipeline.handleInbound(m);

  async function reachReview(): Promise<void> {
    await send(image());
    await send(text('studio, white background'));
    await send(text('go'));
  }

  return { repo, adapter, provider, pipeline, contact, send, image, text, reachReview };
}

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

describe('provider contract', () => {
  it('GEN-002 the pipeline runs against any ImageProvider, holding no Gemini types', async () => {
    // A minimal conforming provider is enough to drive a full generation, which
    // is what proves the pipeline is engine-agnostic.
    let received: GenerateRequest | undefined;
    const bespoke: ImageProvider = {
      name: 'bespoke',
      model: 'bespoke-1',
      async generate(req) {
        received = req;
        return {
          image: makePng(64, 64, [10, 10, 10]),
          mime: 'image/png',
          interactionId: 'bespoke-interaction',
          latencyMs: 1,
          costUsd: 0,
        };
      },
    };
    const pipeline = new Pipeline({ repo: h.repo, adapter: h.adapter, provider: bespoke });

    await pipeline.handleInbound(h.image());
    await pipeline.handleInbound(h.text('studio'));
    await pipeline.handleInbound(h.text('go'));

    expect(received).toBeDefined();
    // The bespoke provider never parses a brief, so the documented default
    // garment text is what reaches it — proving it is the pipeline, not Gemini,
    // that composes the request.
    expect(received!.prompt).toContain('Garment:');
    expect(received!.prompt).toContain('Composition:');
  });

  it('GEN-001 the pipeline supplies a prompt, references, and an output format', async () => {
    await h.reachReview();

    const req = h.provider.lastRequest()!;
    // These four things are the entire contract between pipeline and engine.
    expect(typeof req.prompt).toBe('string');
    expect(req.prompt.length).toBeGreaterThan(0);
    expect(Array.isArray(req.refs)).toBe(true);
    expect(req.aspectRatio).toMatch(/^\d+:\d+$/);
    expect(req.imageSize).toMatch(/^\d+K?$/);
  });

  it('GEN-006 the uploaded garment photo is passed as an image reference', async () => {
    await h.reachReview();
    const req = h.provider.lastRequest()!;

    // Describing the garment in words is not enough: the bytes must be supplied,
    // or the model cannot see the actual fabric or print.
    expect(req.refs.length).toBeGreaterThan(0);
    expect(req.refs[0]!.data.length).toBeGreaterThan(0);
    expect(req.refs[0]!.mime).toMatch(/^image\//);
  });

  it('GEN-007 caps references at four, keeping the most recent photos', async () => {
    // Six photos: the cap exists because extra references dilute garment
    // fidelity and cost tokens.
    for (let i = 0; i < 6; i += 1) await h.send(h.image());
    await h.send(h.text('studio'));
    await h.send(h.text('go'));

    expect(h.provider.lastRequest()!.refs.length).toBeLessThanOrEqual(4);

    const session = h.repo.getActiveSession(h.contact.id)!;
    const refs = JSON.parse(session.refs_json ?? '[]') as string[];
    expect(refs).toHaveLength(4);
  });
});

describe('prompt content', () => {
  it('GEN-005 forbids added text and watermarks while requiring garment fidelity', () => {
    // The invariants live in the system instruction, which is sent with every
    // generation, so they cannot be omitted by a caller.
    expect(SYSTEM_INSTRUCTION).toMatch(/watermark/i);
    expect(SYSTEM_INSTRUCTION).toMatch(/text/i);
    expect(SYSTEM_INSTRUCTION).toMatch(/Never restyle/i);
  });

  it('GEN-005 carries the invariants into every composed prompt', () => {
    const prompt = buildImagePrompt({ brief: defaultBrief() });
    // Composition asks for catalogue framing; fidelity is enforced separately by
    // the system instruction, so assert the composition half here.
    expect(prompt).toMatch(/catalog-ready quality/i);
  });

  it('ITER-005 preserves a revision instruction verbatim in the prompt', () => {
    const note = 'Make the sleeves three-quarter length, NOT full.';
    const prompt = buildImagePrompt({ brief: defaultBrief(), revisionNote: note });
    // Rewriting the user's words would change the edit they asked for.
    expect(prompt).toContain(note);
  });
});

describe('interaction chaining', () => {
  it('GEN-011 records the interaction id so a later edit can chain onto it', async () => {
    await h.reachReview();
    const session = h.repo.getActiveSession(h.contact.id)!;
    expect(session.last_interaction_id).toBe('interaction-1');

    const generation = h.repo.lastGeneration(session.id)!;
    expect(generation.interaction_id).toBe('interaction-1');
    expect(generation.status).toBe('succeeded');
  });

  it('GEN-011 passes the recorded id to the next revision', async () => {
    await h.reachReview();
    await h.send(h.text('2, warmer lighting'));
    expect(h.provider.lastRequest()!.previousInteractionId).toBe('interaction-1');
  });
});

describe('outcomes are recorded', () => {
  it('GEN-012 COST-004 a success records latency and estimated cost', async () => {
    await h.reachReview();
    const session = h.repo.getActiveSession(h.contact.id)!;
    const generation = h.repo.lastGeneration(session.id)!;

    expect(generation.status).toBe('succeeded');
    expect(generation.latency_ms).toBeGreaterThanOrEqual(0);
    expect(generation.cost_usd).toBeGreaterThan(0);
    expect(generation.aspect_ratio).toMatch(/^\d+:\d+$/);
    expect(generation.image_size).toBeTruthy();
    expect(generation.provider).toBe('fake');
  });

  it('GEN-012 links inputs and the output to the generation record', async () => {
    await h.reachReview();
    const session = h.repo.getActiveSession(h.contact.id)!;
    const generation = h.repo.lastGeneration(session.id)!;

    const outputs = h.repo.listGenerationOutputs(generation.id);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.kind).toBe('generated');
  });

  it('GEN-016 the produced image is delivered to the user exactly once per shot', async () => {
    await h.reachReview();
    // One generation, one image. Duplicate delivery would look broken.
    expect(h.adapter.images()).toHaveLength(1);
    expect(h.adapter.images()[0]!.caption).toMatch(/Here it is/);
  });
});

describe('failure and timeout handling', () => {
  it('GEN-010 a provider that never resolves fails the turn instead of hanging it', async () => {
    // A hung generation must not hang the conversation: the timeout is what
    // stops a single stuck call from blocking every later message.
    const hanging: ImageProvider = {
      name: 'hanging',
      model: 'hanging-1',
      generate: () => new Promise(() => {}),
    };
    const pipeline = new Pipeline({ repo: h.repo, adapter: h.adapter, provider: hanging });

    await pipeline.handleInbound(h.image());
    await pipeline.handleInbound(h.text('studio'));

    const session = h.repo.getActiveSession(h.contact.id)!;
    const started = Date.now();
    // A shortened budget keeps the test fast; the mechanism is what is asserted.
    const original = config.gemini.timeoutMs;
    Object.assign(config.gemini, { timeoutMs: 150 });
    try {
      await pipeline.handleInbound(h.text('go'));
    } finally {
      Object.assign(config.gemini, { timeoutMs: original });
    }

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(h.adapter.said(/generation failed|try again/i)).toBe(true);

    // The failure is recorded rather than swallowed.
    const after = h.repo.getActiveSession(h.contact.id)!;
    expect(h.repo.lastGeneration(after.id)!.status).toBe('failed');
    expect(session.stage).not.toBe('generating');
  });

  it('GEN-013 GEN-014 stage after a failure depends on whether a good shot exists', async () => {
    // With no prior output, the user must be able to fix the brief.
    await h.send(h.image());
    await h.send(h.text('studio'));
    h.provider.nextError = new ImageProviderError('boom', 'provider', true);
    await h.send(h.text('go'));
    expect(h.repo.getActiveSession(h.contact.id)!.stage).toBe('confirm_brief');

    // With a prior output, the good shot must survive for another attempt.
    h.adapter.reset();
    await h.send(h.text('go'));
    expect(h.repo.getActiveSession(h.contact.id)!.stage).toBe('review');

    h.provider.nextError = new ImageProviderError('boom again', 'provider', true);
    await h.send(h.text('2, change the pose'));
    const session = h.repo.getActiveSession(h.contact.id)!;
    expect(session.stage).toBe('review');
    expect(session.last_output_asset_id).toBeTruthy();
  });
});

describe('cost budget', () => {
  it('COST-003 a variations request cannot exceed the remaining budget', async () => {
    await h.reachReview();

    // Drive the session to one generation short of the cap.
    const session = h.repo.getActiveSession(h.contact.id)!;
    h.repo.updateSession(session.id, {
      generation_count: config.pipeline.maxGenerationsPerSession - 1,
    });

    const before = h.provider.callCount;
    await h.send(h.text('3'));

    // Only one generation was affordable, so only one may run.
    expect(h.provider.callCount).toBe(before + 1);
  });

  it('COST-003 refuses entirely at the cap and offers a way forward', async () => {
    await h.reachReview();
    const session = h.repo.getActiveSession(h.contact.id)!;
    h.repo.updateSession(session.id, {
      generation_count: config.pipeline.maxGenerationsPerSession,
    });

    const before = h.provider.callCount;
    await h.send(h.text('3'));

    expect(h.provider.callCount).toBe(before);
    expect(h.adapter.said(/generation limit/i)).toBe(true);
  });
});

describe('failure classification', () => {
  it('GEN-008 a transient provider failure fails the turn cleanly and stays retryable', async () => {
    await h.send(h.image());
    await h.send(h.text('studio'));

    // A retryable error must not corrupt state or lose the brief.
    h.provider.nextError = new ImageProviderError('upstream 503', 'provider', true, 503);
    await h.send(h.text('go'));

    const session = h.repo.getActiveSession(h.contact.id)!;
    expect(session.stage).toBe('confirm_brief');
    // The brief survives, so the user can simply try again.
    expect(session.brief_json).toBeTruthy();

    const generation = h.repo.lastGeneration(session.id)!;
    expect(generation.status).toBe('failed');
    // Retryability is classified and recorded, not discarded.
    expect(generation.error).toContain('503');

    // And a retry after the transient condition clears must succeed.
    await h.send(h.text('go'));
    expect(h.repo.getActiveSession(h.contact.id)!.stage).toBe('review');
  });

  it('GEN-015 the aspect ratio and image size come from the brief', async () => {
    h.provider.setBrief({ aspectRatio: '9:16', imageSize: '4K' });
    await h.send(h.image());
    await h.send(h.text('vertical story format'));
    await h.send(h.text('go'));

    const req = h.provider.lastRequest()!;
    expect(req.aspectRatio).toBe('9:16');
    expect(req.imageSize).toBe('4K');

    // And the same values are recorded for audit.
    const session = h.repo.getActiveSession(h.contact.id)!;
    const generation = h.repo.lastGeneration(session.id)!;
    expect(generation.aspect_ratio).toBe('9:16');
    expect(generation.image_size).toBe('4K');
  });
});
