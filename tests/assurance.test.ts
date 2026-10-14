import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Repo } from '../src/db/repo.js';
import { createTestDb } from '../src/db/migrate.js';
import { Pipeline } from '../src/core/pipeline.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { FakeImageProvider } from './helpers/fake-provider.js';
import { makePng } from './fixtures/png.js';
import { logger } from '../src/logger.js';
import { getImageProvider } from '../src/providers.js';
import type { DeliveryAdapter } from '../src/messaging/types.js';
import type { InboundMessage } from '../src/types.js';

/**
 * Security, seam, observability and catalogue requirements that need the
 * assembled pipeline or the repository rather than a pure unit under test.
 */

const CONTACT = 'sim:assurance';
const repoRoot = path.resolve(import.meta.dirname, '..');

let seq = 0;

function harness() {
  const repo = new Repo(createTestDb());
  const adapter = new FakeAdapter();
  const provider = new FakeImageProvider({ garment: 'a trench coat' });
  const pipeline = new Pipeline({ repo, adapter, provider });
  const org = repo.ensureDefaultOrg();
  const contact = repo.ensureContact(org.id, CONTACT);

  const image = (): InboundMessage => {
    const mediaId = `media-${(seq += 1)}`;
    adapter.media.set(mediaId, { mime: 'image/png', data: makePng(200, 260) });
    return {
      externalContactId: CONTACT,
      externalMessageId: `msg-${seq}`,
      receivedAt: new Date(),
      attachments: [{ externalId: mediaId }],
    };
  };
  const text = (body: string): InboundMessage => ({
    externalContactId: CONTACT,
    externalMessageId: `msg-${(seq += 1)}`,
    receivedAt: new Date(),
    attachments: [],
    text: body,
  });

  const send = (m: InboundMessage) => pipeline.handleInbound(m);

  async function approveAnItem(): Promise<void> {
    await send(image());
    await send(text('studio, white background'));
    await send(text('go'));
    await send(text('1'));
  }

  return { repo, adapter, provider, pipeline, contact, send, image, text, approveAnItem };
}

describe('CATALOG approval', () => {
  it('CATALOG-001 approving creates exactly one product for the item', async () => {
    const h = harness();
    const org = h.repo.ensureDefaultOrg();
    expect(h.repo.listProducts(org.id)).toHaveLength(0);

    await h.approveAnItem();

    const products = h.repo.listProducts(org.id);
    expect(products).toHaveLength(1);
    expect(products[0]!.title).toContain('trench coat');
  });
});

describe('observability of a generation', () => {
  it('OBS-004 records latency, cost and the remaining budget', async () => {
    const h = harness();
    // Capture the structured log line rather than asserting on the database
    // alone: an operator reads logs, and the remaining budget exists only there.
    const spy = vi.spyOn(logger, 'info');
    try {
      await h.send(h.image());
      await h.send(h.text('studio'));
      await h.send(h.text('go'));

      const succeeded = spy.mock.calls.find(
        ([, message]) => message === 'generation succeeded',
      );
      expect(succeeded, 'a generation must log its success with metrics').toBeDefined();

      const fields = succeeded![0] as Record<string, unknown>;
      expect(typeof fields.latencyMs).toBe('number');
      expect(typeof fields.costUsd).toBe('number');
      // The remaining budget is what lets an operator see spend approaching the cap.
      expect(typeof fields.remaining).toBe('number');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('architecture seams', () => {
  it('SEAM-001 a bespoke channel adapter drives the pipeline without core changes', async () => {
    // Three methods are the entire channel contract. If the core leaked a
    // WhatsApp concept, this object could not satisfy it.
    const recorded: string[] = [];
    const bespoke: DeliveryAdapter = {
      name: 'bespoke',
      async sendText(_to, text) {
        recorded.push(text);
        return {};
      },
      async sendImage(_to, _asset) {
        recorded.push('image');
        return {};
      },
      async downloadMedia() {
        return { mime: 'image/png', data: makePng(200, 200) };
      },
    };

    const repo = new Repo(createTestDb());
    const pipeline = new Pipeline({ repo, adapter: bespoke, provider: new FakeImageProvider() });

    await pipeline.handleInbound({
      externalContactId: 'bespoke:1',
      externalMessageId: 'm1',
      receivedAt: new Date(),
      attachments: [{ externalId: 'whatever' }],
    });
    await pipeline.handleInbound({
      externalContactId: 'bespoke:1',
      externalMessageId: 'm2',
      receivedAt: new Date(),
      attachments: [],
      text: 'studio',
    });

    expect(recorded.join(' ')).toMatch(/describe the shot|Got/);
  });

  it('SEAM-002 the image engine is an interface, not a Gemini type', async () => {
    // Proven by construction in tests/generation.test.ts (a bespoke provider
    // drives a full generation) and by the producer below being substitutable.
    const provider = getImageProvider();
    expect(provider).toHaveProperty('name');
    expect(provider).toHaveProperty('model');
    expect(typeof provider.generate).toBe('function');
  });

  it('SEAM-004 a missing API key degrades safely instead of crashing', async () => {
    // With no key configured the factory must still produce a usable object, so
    // the service boots and the conversation still runs up to generation.
    const provider = getImageProvider();
    expect(provider).toBeDefined();
    expect(provider.name).toBe('stub');

    // The failure is explicit and actionable rather than a confusing upstream
    // error — and it must be a rejected promise, not a synchronous throw, since
    // generate() is async.
    await expect(provider.generate({} as never)).rejects.toThrow(/GEMINI_API_KEY/);
  });
});

describe('security posture', () => {
  it('SEC-003 no committed file contains a credential-shaped string', () => {
    // A secret in git history cannot be un-leaked; this is the cheap guard.
    const patterns = [
      /AIza[0-9A-Za-z_-]{35}/, // Google API key
      /sk-[A-Za-z0-9]{20,}/, // OpenAI-style key
      /EAA[A-Za-z0-9]{50,}/, // Meta access token
      /ghp_[A-Za-z0-9]{36}/, // GitHub PAT
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];

    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'dist', 'data'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(repoRoot);

    const offenders: string[] = [];
    for (const file of files) {
      // Skip binary-ish files and this test itself, whose patterns are literals.
      if (file.endsWith('.test.ts')) continue;
      let text: string;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const pattern of patterns) {
        if (pattern.test(text)) offenders.push(`${path.relative(repoRoot, file)} matches ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('SEC-003 the real .env is ignored so a live key can never be committed', () => {
    const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
    // The service writes runtime data and build output; both must be ignored.
    expect(gitignore).toMatch(/^\/data$/m);
    expect(gitignore).toMatch(/^\/dist$/m);
  });

  it('SEC-003 .env.example carries empty placeholders, never real values', () => {
    const example = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    // Every secret-shaped key must be blank in the committed example.
    for (const key of [
      'GEMINI_API_KEY',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_VERIFY_TOKEN',
      'WHATSAPP_APP_SECRET',
    ]) {
      const match = new RegExp(`^${key}=(.*)$`, 'm').exec(example);
      expect(match, `${key} must appear in .env.example`).not.toBeNull();
      expect(match![1]!.trim()).toBe('');
    }
  });
});

describe('documented limitations are visible, not silent', () => {
  /**
   * SEC-006 is a `deferred` requirement: `/media/:assetId` and `/api/catalog`
   * have no authentication and are intended for the local simulator only. The
   * safeguard is that this is stated where an operator will see it before
   * exposing the service — not that the code enforces it.
   */
  it('SEC-006 the README warns that these endpoints must not be exposed publicly', () => {
    const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
    expect(readme).toMatch(/no authentication/i);
    expect(readme).toMatch(/must \*\*not\*\* be exposed|not.*exposed publicly/i);
  });

  it('SEC-006 the default channel is the simulator, not an internet-facing one', () => {
    // Deployment defaults matter: an operator must opt in to the public channel.
    const example = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    expect(example).toMatch(/^MESSAGING_CHANNEL=simulator$/m);
  });
});
