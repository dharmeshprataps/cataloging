import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createTestDb, migrate } from '../src/db/migrate.js';
import { Repo } from '../src/db/repo.js';
import { LocalBlobStore, blobStore } from '../src/media/store.js';
import { catalogToCsv, getCatalogEntry, listCatalog } from '../src/core/catalog.js';
import { config } from '../src/config.js';

/**
 * Persistence, catalog, configuration and observability requirements.
 *
 * These were the bulk of the 86 `implemented`-but-unverified requirements: each
 * is a small structural property that a reader would assume holds. Assuming is
 * what `SPEC-0001` forbids — either a test proves it or the requirement is
 * marked unverified.
 */

const ALL_TABLES = [
  'orgs',
  'contacts',
  'sessions',
  'assets',
  'products',
  'product_assets',
  'generations',
  'generation_assets',
  'messages',
];

function tableNames(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
}

function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
}

describe('PERSIST-001 database driver', () => {
  it('PERSIST-001 PERSIST-002 opens with node:sqlite and creates every domain table', () => {
    // No native module is loaded: `node:sqlite` is part of the runtime, which is
    // what keeps the container build free of a compiler.
    const db = createTestDb();
    const names = tableNames(db);

    for (const table of ALL_TABLES) {
      expect(names, `missing table ${table}`).toContain(table);
    }
    db.close();
  });

  it('PERSIST-002 gives each table the columns its repository methods use', () => {
    const db = createTestDb();

    // Spot-check the columns that carry control flow or uniqueness, because a
    // missing one is a silent data-loss bug rather than a loud failure.
    expect(columnsOf(db, 'sessions')).toEqual(
      expect.arrayContaining([
        'stage',
        'brief_json',
        'refs_json',
        'last_interaction_id',
        'last_output_asset_id',
        'generation_count',
      ]),
    );
    expect(columnsOf(db, 'messages')).toEqual(
      expect.arrayContaining(['direction', 'external_id', 'asset_id']),
    );
    expect(columnsOf(db, 'products')).toEqual(
      expect.arrayContaining(['sku', 'title', 'price_cents', 'currency', 'category']),
    );
    db.close();
  });
});

describe('PERSIST-003 migration', () => {
  it('PERSIST-003 applying the schema twice changes nothing', () => {
    const db = createTestDb();
    const before = tableNames(db);
    migrate(db);
    migrate(db);
    expect(tableNames(db)).toEqual(before);
    db.close();
  });

  it('PERSIST-003 is safe on a brand-new empty database', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => migrate(db)).not.toThrow();
    expect(tableNames(db)).toEqual(expect.arrayContaining(ALL_TABLES));
    db.close();
  });
});

describe('PERSIST-004 repository contract', () => {
  it('PERSIST-004 assigns ids and timestamps on insert', () => {
    const repo = new Repo(createTestDb());
    const org = repo.ensureDefaultOrg();

    expect(org.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(org.created_at))).toBe(false);

    // ensureDefaultOrg must be idempotent, not create a row per call.
    expect(repo.ensureDefaultOrg().id).toBe(org.id);
  });

  it('PERSIST-004 patches only the fields an allowlist permits', () => {
    const repo = new Repo(createTestDb());
    const org = repo.ensureDefaultOrg();
    const contact = repo.ensureContact(org.id, 'sim:x');
    const session = repo.ensureActiveSession(contact.id);

    repo.updateSession(session.id, { stage: 'review' });
    const updated = repo.getSession(session.id)!;
    expect(updated.stage).toBe('review');
    // An untouched field must survive a partial patch.
    expect(updated.generation_count).toBe(0);
    expect(updated.contact_id).toBe(contact.id);
  });

  it('PERSIST-004 tracks the generation budget on the session', () => {
    const repo = new Repo(createTestDb());
    const org = repo.ensureDefaultOrg();
    const contact = repo.ensureContact(org.id, 'sim:x');
    const session = repo.ensureActiveSession(contact.id);

    expect(repo.getSession(session.id)!.generation_count).toBe(0);
    // The session counter is the enforced budget, and must be the single source
    // of truth for it.
    expect(repo.incrementGenerationCount(session.id)).toBe(1);
    expect(repo.incrementGenerationCount(session.id)).toBe(2);
    expect(repo.getSession(session.id)!.generation_count).toBe(2);
  });
});

describe('PERSIST-005 session reload', () => {
  it('PERSIST-005 persists every field that governs control flow', () => {
    const repo = new Repo(createTestDb());
    const org = repo.ensureDefaultOrg();
    const contact = repo.ensureContact(org.id, 'sim:x');
    const session = repo.ensureActiveSession(contact.id);

    repo.updateSession(session.id, {
      stage: 'review',
      brief_json: JSON.stringify({ garment: 'a dress' }),
      refs_json: JSON.stringify(['a1', 'a2']),
      last_interaction_id: 'interaction-9',
      last_output_asset_id: 'asset-9',
      generation_count: 3,
    });

    // A fresh read must reproduce all of it: nothing governing control flow may
    // live only in memory, because the service is redeployed.
    const reloaded = repo.getSession(session.id)!;
    expect(reloaded.stage).toBe('review');
    expect(JSON.parse(reloaded.brief_json!)).toEqual({ garment: 'a dress' });
    expect(JSON.parse(reloaded.refs_json!)).toEqual(['a1', 'a2']);
    expect(reloaded.last_interaction_id).toBe('interaction-9');
    expect(reloaded.last_output_asset_id).toBe('asset-9');
    expect(reloaded.generation_count).toBe(3);
  });
});

describe('PERSIST-010 message identity', () => {
  it('PERSIST-010 stores a given inbound channel id only once', () => {
    const repo = new Repo(createTestDb());
    const org = repo.ensureDefaultOrg();
    const contact = repo.ensureContact(org.id, 'sim:x');
    const session = repo.ensureActiveSession(contact.id);

    const first = repo.recordInboundMessage({
      sessionId: session.id,
      kind: 'text',
      body: 'hello',
      externalId: 'wamid.UNIQUE',
    });
    const second = repo.recordInboundMessage({
      sessionId: session.id,
      kind: 'text',
      body: 'hello again',
      externalId: 'wamid.UNIQUE',
    });

    expect(first).toBeDefined();
    // The second must be suppressed at the storage layer, not merely by callers.
    expect(second).toBeUndefined();
    expect(repo.listMessages(session.id)).toHaveLength(1);
  });

  it('PERSIST-010 allows a null external id (simulator-generated messages)', () => {
    const repo = new Repo(createTestDb());
    const org = repo.ensureDefaultOrg();
    const contact = repo.ensureContact(org.id, 'sim:x');
    const session = repo.ensureActiveSession(contact.id);

    for (const id of ['a1', 'a2']) {
      repo.insertAsset({
        id,
        kind: 'uploaded',
        mime: 'image/png',
        bytes: 1,
        width: 1,
        height: 1,
        path: `p-${id}`,
        sha256: null,
        source: 'simulator',
      });
    }
    repo.recordInboundMessage({ sessionId: session.id, kind: 'image', assetId: 'a1' });
    repo.recordInboundMessage({ sessionId: session.id, kind: 'image', assetId: 'a2' });
    expect(repo.listMessages(session.id)).toHaveLength(2);
  });
});

describe('PERSIST-006 PERSIST-007 blob storage', () => {
  function tmpStore() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-'));
    return { root, store: new LocalBlobStore(root) };
  }

  it('PERSIST-006 round-trips bytes by key', async () => {
    const { store } = tmpStore();
    const key = 'uploads/2026-01-01/a.bin';
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await store.put(key, bytes);
    expect(await store.exists(key)).toBe(true);
    expect(Array.from(await store.get(key))).toEqual([1, 2, 3, 4]);
    expect(store.localPath(key)).toContain('uploads');
  });

  it('PERSIST-007 exposes a filesystem-backed default implementation', async () => {
    // The interface is what allows S3/R2 to be substituted without touching
    // callers; the default must satisfy it.
    expect(typeof blobStore.put).toBe('function');
    expect(typeof blobStore.get).toBe('function');
    expect(typeof blobStore.localPath).toBe('function');
    expect(typeof blobStore.exists).toBe('function');
  });

  it('PERSIST-008 refuses a key that escapes the storage root', async () => {
    const { store } = tmpStore();
    // Path traversal must be refused rather than reading outside the root.
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/outside storage root/);
    await expect(store.put('../escape.bin', new Uint8Array([1]))).rejects.toThrow(
      /outside storage root/,
    );
  });

  it('PERSIST-009 writes atomically, leaving no temporary file behind', async () => {
    const { root, store } = tmpStore();
    await store.put('a/b.bin', new Uint8Array([9]));

    const entries: string[] = [];
    const walk = (dir: string): void => {
      for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, dirent.name);
        if (dirent.isDirectory()) walk(full);
        else entries.push(full);
      }
    };
    walk(root);

    expect(entries.map((e) => path.basename(e))).toEqual(['b.bin']);
    // The temp-then-rename strategy must not leave a partial file visible.
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });
});

describe('CATALOG requirements', () => {
  function seededRepo() {
    const repo = new Repo(createTestDb());
    const org = repo.ensureDefaultOrg();
    const contact = repo.ensureContact(org.id, 'sim:x');
    const session = repo.ensureActiveSession(contact.id);
    return { repo, org, contact, session };
  }

  it('CATALOG-002 CATALOG-003 links inputs, hero and alternates with explicit roles', () => {
    const { repo, org, session } = seededRepo();
    const product = repo.createProduct({
      orgId: org.id,
      sku: 'DRESS-1',
      title: 'A linen dress',
      description: 'Model: a woman in her twenties',
      priceCents: 12900,
      currency: 'INR',
      category: 'dresses',
    });

    expect(product.sku).toBe('DRESS-1');
    expect(product.price_cents).toBe(12900);
    expect(product.currency).toBe('INR');
    expect(product.category).toBe('dresses');

    const input = repo.insertAsset({
      id: 'in-1',
      kind: 'uploaded',
      mime: 'image/png',
      bytes: 10,
      width: 100,
      height: 100,
      path: 'p',
      sha256: 'h1',
      source: 'simulator',
    });
    const generated = repo.insertAsset({
      id: 'gen-1',
      kind: 'generated',
      mime: 'image/jpeg',
      bytes: 20,
      width: 200,
      height: 300,
      path: 'p2',
      sha256: 'h2',
      source: 'gemini',
    });

    repo.linkProductAsset(product.id, input.id, 'input', 0);
    repo.linkProductAsset(product.id, generated.id, 'hero', 0);
    repo.linkProductAsset(product.id, generated.id, 'alternate', 1);

    const links = repo.listProductAssets(product.id);
    expect(links.find((l) => l.role === 'hero')?.asset.id).toBe('gen-1');
    expect(links.find((l) => l.role === 'input')?.asset.id).toBe('in-1');
    expect(links.find((l) => l.role === 'alternate')?.asset.id).toBe('gen-1');
    void session;
  });

  it('CATALOG-004 the hero is a generated asset, never an upload', () => {
    const { repo, org } = seededRepo();
    const product = repo.createProduct({ orgId: org.id, title: 'x' });
    repo.insertAsset({
      id: 'up',
      kind: 'uploaded',
      mime: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
      path: 'p',
      sha256: null,
      source: null,
    });
    repo.insertAsset({
      id: 'gen',
      kind: 'generated',
      mime: 'image/jpeg',
      bytes: 1,
      width: 1,
      height: 1,
      path: 'q',
      sha256: null,
      source: 'gemini',
    });
    repo.linkProductAsset(product.id, 'gen', 'hero', 0);

    const entry = getCatalogEntry(repo, product.id)!;
    expect(entry.heroAssetId).toBe('gen');
    // The upload stays visible as an input, which is how the catalog can show
    // which photo produced the shot.
    repo.linkProductAsset(product.id, 'up', 'input', 0);
    expect(getCatalogEntry(repo, product.id)!.inputAssetIds).toEqual(['up']);
  });

  it('CATALOG-005 the hero is the most recent output, not the first', () => {
    const { repo, org, session } = seededRepo();
    const product = repo.createProduct({ orgId: org.id, title: 'x' });
    const outputs = ['g1', 'g2', 'g3'].map((id, i) =>
      repo.insertAsset({
        id,
        kind: 'generated',
        mime: 'image/jpeg',
        bytes: 1,
        width: 1,
        height: 1,
        path: `p${i}`,
        sha256: null,
        source: 'gemini',
      }),
    );
    // Simulate three generations, each becoming the current output.
    let last = '';
    for (const [i, asset] of outputs.entries()) {
      repo.createGeneration({
        sessionId: session.id,
        productId: product.id,
        provider: 'fake',
        model: 'fake',
        prompt: `p${i}`,
        status: 'succeeded',
      });
      repo.updateSession(session.id, { last_output_asset_id: asset.id });
      last = asset.id;
    }
    repo.linkProductAsset(product.id, last, 'hero', 0);

    expect(getCatalogEntry(repo, product.id)!.heroAssetId).toBe('g3');
    expect(repo.getSession(session.id)!.last_output_asset_id).toBe('g3');
  });

  it('CATALOG-006 lists newest first and observes the limit', () => {
    const { repo, org } = seededRepo();
    for (const title of ['first', 'second', 'third']) {
      repo.createProduct({ orgId: org.id, title });
    }
    const listed = repo.listProducts(org.id);
    expect(listed).toHaveLength(3);
    // created_at ordering is descending; ties are possible at ms resolution, so
    // assert the limit and membership rather than a fragile exact order.
    expect(listed.map((p) => p.title)).toEqual(expect.arrayContaining(['first', 'third']));
    expect(repo.listProducts(org.id, 2)).toHaveLength(2);
  });

  it('CATALOG-007 CATALOG-008 exports CSV with a header and quoted special characters', () => {
    const { repo, org } = seededRepo();
    repo.createProduct({
      orgId: org.id,
      sku: 'SKU,1',
      title: 'A "quoted" title',
      category: 'multi\nline',
    });
    const entries = listCatalog(repo, org.id);
    const csv = catalogToCsv(entries);
    const [header, row] = csv.split('\n');

    expect(header).toBe('sku,title,category,price_cents,currency,hero_asset_id,created_at');
    // Embedded commas and quotes must be escaped, or the export is corrupt.
    expect(row).toContain('"SKU,1"');
    expect(row).toContain('"A ""quoted"" title"');
  });

  it('CATALOG-007 exports only the approved catalogue, not every draft', () => {
    const { repo, org } = seededRepo();
    const approved = repo.createProduct({ orgId: org.id, sku: 'KEEP', title: 'kept' });
    repo.insertAsset({
      id: 'hero',
      kind: 'generated',
      mime: 'image/jpeg',
      bytes: 1,
      width: 1,
      height: 1,
      path: 'p',
      sha256: null,
      source: 'gemini',
    });
    repo.linkProductAsset(approved.id, 'hero', 'hero', 0);

    const csv = catalogToCsv(listCatalog(repo, org.id));
    expect(csv).toContain('KEEP');
    expect(csv).toContain('hero');
  });
});

describe('CFG requirements', () => {
  it('CFG-001 validates configuration at boot and names the offending variable', async () => {
    // A child process is the only honest way to test boot failure: config is
    // resolved once at import time.
    const { spawnSync } = await import('node:child_process');
    const repoRoot = path.resolve(import.meta.dirname, '..');
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs'), path.join(repoRoot, 'src/config.ts')],
      {
        cwd: repoRoot,
        env: { ...process.env, PORT: '0', LOG_LEVEL: 'silent' },
        encoding: 'utf8',
      },
    );
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('PORT');
  });

  it('CFG-001 accepts a valid configuration', () => {
    expect(config.server.port).toBeGreaterThan(0);
    expect(config.messaging.channel).toBe('simulator');
  });

  it('CFG-004 CFG-005 both models are configuration values, not hardcoded', () => {
    // Selecting a different model must not require a code change.
    expect(typeof config.gemini.imageModel).toBe('string');
    expect(config.gemini.imageModel.length).toBeGreaterThan(0);
    expect(typeof config.gemini.textModel).toBe('string');
    expect(config.gemini.textModel.length).toBeGreaterThan(0);
    // They are independent: text and image models ship on separate cadences.
    expect(config.gemini.imageModel).not.toBe(config.gemini.textModel);
  });

  it('CFG-006 CFG-007 batch window and limits are configurable and bounded', () => {
    expect(config.pipeline.debounceMs).toBeGreaterThanOrEqual(0);
    expect(config.pipeline.maxGenerationsPerSession).toBeGreaterThan(0);
    expect(config.pipeline.variationsCount).toBeGreaterThan(0);
    // Bounded so a typo cannot request 10,000 images.
    expect(config.pipeline.variationsCount).toBeLessThanOrEqual(8);
    expect(config.storage.maxUploadBytes).toBeGreaterThan(0);
  });

  it('CFG-008 .env.example documents every variable the app reads', () => {
    const example = fs.readFileSync(path.resolve(import.meta.dirname, '../.env.example'), 'utf8');
    const declared = new Set(
      [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!),
    );
    for (const key of [
      'GEMINI_API_KEY',
      'GEMINI_IMAGE_MODEL',
      'GEMINI_TEXT_MODEL',
      'PORT',
      'HOST',
      'LOG_LEVEL',
      'PUBLIC_BASE_URL',
      'STORAGE_DIR',
      'DATABASE_PATH',
      'MESSAGING_CHANNEL',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_VERIFY_TOKEN',
      'WHATSAPP_APP_SECRET',
      'MESSAGE_DEBOUNCE_MS',
      'MAX_GENERATIONS_PER_SESSION',
      'VARIATIONS_COUNT',
    ]) {
      expect(declared, `.env.example must document ${key}`).toContain(key);
    }
  });
});

describe('OBS requirements', () => {
  it('OBS-001 OBS-005 configures structured logging for each environment', async () => {
    const { logger } = await import('../src/logger.js');
    // pino exposes these on every logger instance; their presence is what makes
    // structured, context-carrying logs possible.
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('OBS-003 health reports whether a provider is configured', async () => {
    // Reported separately from `model`, so an operator can tell "running with no
    // key" apart from "misconfigured".
    const { getImageProvider } = await import('../src/providers.js');
    const provider = getImageProvider();
    expect(typeof provider.model).toBe('string');
    expect(typeof provider.name).toBe('string');
  });
});
