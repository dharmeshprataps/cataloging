import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AssetKind,
  GenerationStatus,
  MessageDirection,
  ProductAssetRole,
  Stage,
} from '../types.js';

/** ---------------------------------------------------------------------------
 * Row shapes (as stored)
 * ------------------------------------------------------------------------- */

export type OrgRow = {
  id: string;
  name: string;
  style_guide_json: string | null;
  created_at: string;
};

export type ContactRow = {
  id: string;
  org_id: string;
  external_id: string;
  display_name: string | null;
  created_at: string;
};

export type SessionRow = {
  id: string;
  contact_id: string;
  stage: Stage;
  brief_json: string | null;
  refs_json: string | null;
  last_interaction_id: string | null;
  last_output_asset_id: string | null;
  product_id: string | null;
  pending_brief_text: string | null;
  last_inbound_at: string | null;
  attempt_count: number;
  generation_count: number;
  created_at: string;
  updated_at: string;
};

export type AssetRow = {
  id: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  path: string;
  sha256: string | null;
  source: string | null;
  created_at: string;
};

export type ProductRow = {
  id: string;
  org_id: string;
  sku: string | null;
  title: string | null;
  description: string | null;
  price_cents: number | null;
  currency: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
};

export type GenerationRow = {
  id: string;
  session_id: string;
  product_id: string | null;
  provider: string;
  model: string;
  prompt: string;
  prev_interaction_id: string | null;
  interaction_id: string | null;
  status: GenerationStatus;
  aspect_ratio: string | null;
  image_size: string | null;
  latency_ms: number | null;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
};

export type MessageRow = {
  id: string;
  session_id: string;
  direction: MessageDirection;
  kind: string;
  body: string | null;
  asset_id: string | null;
  external_id: string | null;
  status: string | null;
  error: string | null;
  created_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

/** ---------------------------------------------------------------------------
 * Repository
 *
 * Thin, explicit data access over node:sqlite. Deliberately not an ORM: the
 * query surface is small and keeping raw SQL means the Postgres migration path
 * stays obvious.
 * ------------------------------------------------------------------------- */

export class Repo {
  constructor(private readonly db: DatabaseSync) {}

  private one<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  private all<T>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  private run(sql: string, ...params: unknown[]): void {
    this.db.prepare(sql).run(...(params as never[]));
  }

  /** -------------------------------------------------------------------- orgs */

  createOrg(name: string, styleGuide?: unknown): OrgRow {
    const row: OrgRow = {
      id: randomUUID(),
      name,
      style_guide_json: styleGuide ? JSON.stringify(styleGuide) : null,
      created_at: nowIso(),
    };
    this.run(
      `INSERT INTO orgs (id, name, style_guide_json, created_at) VALUES (?, ?, ?, ?)`,
      row.id,
      row.name,
      row.style_guide_json,
      row.created_at,
    );
    return row;
  }

  getOrg(id: string): OrgRow | undefined {
    return this.one<OrgRow>(`SELECT * FROM orgs WHERE id = ?`, id);
  }

  getFirstOrg(): OrgRow | undefined {
    return this.one<OrgRow>(`SELECT * FROM orgs ORDER BY created_at LIMIT 1`);
  }

  /** Returns the single default org, creating it on first use. */
  ensureDefaultOrg(name = 'Default Brand'): OrgRow {
    return this.getFirstOrg() ?? this.createOrg(name);
  }

  /** ----------------------------------------------------------------- contacts */

  /**
   * Channel-scoped contact resolution. `externalId` is a WhatsApp wa_id or,
   * in the simulator, `sim:<clientId>`.
   */
  ensureContact(orgId: string, externalId: string, displayName?: string): ContactRow {
    const existing = this.one<ContactRow>(
      `SELECT * FROM contacts WHERE org_id = ? AND external_id = ?`,
      orgId,
      externalId,
    );
    if (existing) {
      if (displayName && existing.display_name !== displayName) {
        this.run(`UPDATE contacts SET display_name = ? WHERE id = ?`, displayName, existing.id);
        existing.display_name = displayName;
      }
      return existing;
    }
    const row: ContactRow = {
      id: randomUUID(),
      org_id: orgId,
      external_id: externalId,
      display_name: displayName ?? null,
      created_at: nowIso(),
    };
    this.run(
      `INSERT INTO contacts (id, org_id, external_id, display_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      row.id,
      row.org_id,
      row.external_id,
      row.display_name,
      row.created_at,
    );
    return row;
  }

  getContactById(id: string): ContactRow | undefined {
    return this.one<ContactRow>(`SELECT * FROM contacts WHERE id = ?`, id);
  }

  /** -------------------------------------------------------------- sessions */

  /**
   * The active session for a contact: the most recent one that has not reached
   * a terminal stage. Terminal sessions are kept for history, not resumed.
   */
  getActiveSession(contactId: string): SessionRow | undefined {
    return this.one<SessionRow>(
      `SELECT * FROM sessions
        WHERE contact_id = ? AND stage NOT IN ('approved', 'cancelled')
        ORDER BY updated_at DESC LIMIT 1`,
      contactId,
    );
  }

  /** Returns the active session, creating one if none exists or it terminated. */
  ensureActiveSession(contactId: string): SessionRow {
    const existing = this.getActiveSession(contactId);
    if (existing) return existing;
    const ts = nowIso();
    const row: SessionRow = {
      id: randomUUID(),
      contact_id: contactId,
      stage: 'idle',
      brief_json: null,
      refs_json: null,
      last_interaction_id: null,
      last_output_asset_id: null,
      product_id: null,
      pending_brief_text: null,
      last_inbound_at: null,
      attempt_count: 0,
      generation_count: 0,
      created_at: ts,
      updated_at: ts,
    };
    this.run(
      `INSERT INTO sessions (id, contact_id, stage, brief_json, refs_json,
                             last_interaction_id, last_output_asset_id, product_id,
                             pending_brief_text, last_inbound_at, attempt_count,
                             generation_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.contact_id,
      row.stage,
      row.brief_json,
      row.refs_json,
      row.last_interaction_id,
      row.last_output_asset_id,
      row.product_id,
      row.pending_brief_text,
      row.last_inbound_at,
      row.attempt_count,
      row.generation_count,
      row.created_at,
      row.updated_at,
    );
    return row;
  }

  getSession(id: string): SessionRow | undefined {
    return this.one<SessionRow>(`SELECT * FROM sessions WHERE id = ?`, id);
  }

  updateSession(
    id: string,
    patch: Partial<
      Pick<
        SessionRow,
        | 'stage'
        | 'brief_json'
        | 'refs_json'
        | 'last_interaction_id'
        | 'last_output_asset_id'
        | 'product_id'
        | 'pending_brief_text'
        | 'last_inbound_at'
        | 'attempt_count'
        | 'generation_count'
      >
    >,
  ): void {
    const fields = Object.keys(patch) as (keyof typeof patch)[];
    if (fields.length === 0) return;
    const sets = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => patch[f] ?? null);
    this.run(
      `UPDATE sessions SET ${sets}, updated_at = ? WHERE id = ?`,
      ...values,
      nowIso(),
      id,
    );
  }

  setStage(id: string, stage: Stage): void {
    this.updateSession(id, { stage });
  }

  incrementGenerationCount(id: string): number {
    this.run(
      `UPDATE sessions SET generation_count = generation_count + 1, updated_at = ?
        WHERE id = ?`,
      nowIso(),
      id,
    );
    return this.getSession(id)?.generation_count ?? 0;
  }

  /** ---------------------------------------------------------------- assets */

  insertAsset(row: Omit<AssetRow, 'created_at'> & { created_at?: string }): AssetRow {
    const full: AssetRow = { ...row, created_at: row.created_at ?? nowIso() };
    this.run(
      `INSERT INTO assets (id, kind, mime, bytes, width, height, path, sha256, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      full.id,
      full.kind,
      full.mime,
      full.bytes,
      full.width,
      full.height,
      full.path,
      full.sha256,
      full.source,
      full.created_at,
    );
    return full;
  }

  getAsset(id: string): AssetRow | undefined {
    return this.one<AssetRow>(`SELECT * FROM assets WHERE id = ?`, id);
  }

  findAssetBySha(sha256: string): AssetRow | undefined {
    return this.one<AssetRow>(
      `SELECT * FROM assets WHERE sha256 = ? ORDER BY created_at LIMIT 1`,
      sha256,
    );
  }

  /** -------------------------------------------------------------- products */

  createProduct(input: {
    orgId: string;
    sku?: string | null;
    title?: string | null;
    description?: string | null;
    priceCents?: number | null;
    currency?: string | null;
    category?: string | null;
  }): ProductRow {
    const ts = nowIso();
    const row: ProductRow = {
      id: randomUUID(),
      org_id: input.orgId,
      sku: input.sku ?? null,
      title: input.title ?? null,
      description: input.description ?? null,
      price_cents: input.priceCents ?? null,
      currency: input.currency ?? null,
      category: input.category ?? null,
      created_at: ts,
      updated_at: ts,
    };
    this.run(
      `INSERT INTO products (id, org_id, sku, title, description, price_cents,
                             currency, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.org_id,
      row.sku,
      row.title,
      row.description,
      row.price_cents,
      row.currency,
      row.category,
      row.created_at,
      row.updated_at,
    );
    return row;
  }

  updateProduct(
    id: string,
    patch: Partial<Pick<ProductRow, 'sku' | 'title' | 'description' | 'price_cents' | 'currency' | 'category'>>,
  ): void {
    const fields = Object.keys(patch) as (keyof typeof patch)[];
    if (fields.length === 0) return;
    const sets = fields.map((f) => `${f} = ?`).join(', ');
    this.run(
      `UPDATE products SET ${sets}, updated_at = ? WHERE id = ?`,
      ...fields.map((f) => patch[f] ?? null),
      nowIso(),
      id,
    );
  }

  getProduct(id: string): ProductRow | undefined {
    return this.one<ProductRow>(`SELECT * FROM products WHERE id = ?`, id);
  }

  getProductBySku(orgId: string, sku: string): ProductRow | undefined {
    return this.one<ProductRow>(
      `SELECT * FROM products WHERE org_id = ? AND sku = ?`,
      orgId,
      sku,
    );
  }

  listProducts(orgId: string, limit = 100): ProductRow[] {
    return this.all<ProductRow>(
      `SELECT * FROM products WHERE org_id = ? ORDER BY created_at DESC LIMIT ?`,
      orgId,
      limit,
    );
  }

  linkProductAsset(
    productId: string,
    assetId: string,
    role: ProductAssetRole,
    position = 0,
  ): void {
    this.run(
      `INSERT OR IGNORE INTO product_assets (product_id, asset_id, role, position)
       VALUES (?, ?, ?, ?)`,
      productId,
      assetId,
      role,
      position,
    );
  }

  listProductAssets(productId: string): Array<{ asset: AssetRow; role: ProductAssetRole; position: number }> {
    const rows = this.all<{ role: ProductAssetRole; position: number } & AssetRow>(
      `SELECT a.*, pa.role AS role, pa.position AS position
         FROM product_assets pa
         JOIN assets a ON a.id = pa.asset_id
        WHERE pa.product_id = ?
        ORDER BY pa.role, pa.position`,
      productId,
    );
    return rows.map((r) => ({
      asset: {
        id: r.id,
        kind: r.kind,
        mime: r.mime,
        bytes: r.bytes,
        width: r.width,
        height: r.height,
        path: r.path,
        sha256: r.sha256,
        source: r.source,
        created_at: r.created_at,
      },
      role: r.role,
      position: r.position,
    }));
  }

  /** ----------------------------------------------------------- generations */

  createGeneration(input: {
    sessionId: string;
    productId?: string | null;
    provider: string;
    model: string;
    prompt: string;
    prevInteractionId?: string | null;
    status: GenerationStatus;
    aspectRatio?: string | null;
    imageSize?: string | null;
  }): GenerationRow {
    const row: GenerationRow = {
      id: randomUUID(),
      session_id: input.sessionId,
      product_id: input.productId ?? null,
      provider: input.provider,
      model: input.model,
      prompt: input.prompt,
      prev_interaction_id: input.prevInteractionId ?? null,
      interaction_id: null,
      status: input.status,
      aspect_ratio: input.aspectRatio ?? null,
      image_size: input.imageSize ?? null,
      latency_ms: null,
      cost_usd: null,
      error: null,
      created_at: nowIso(),
    };
    this.run(
      `INSERT INTO generations (id, session_id, product_id, provider, model, prompt,
                                prev_interaction_id, interaction_id, status,
                                aspect_ratio, image_size, latency_ms, cost_usd,
                                error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.session_id,
      row.product_id,
      row.provider,
      row.model,
      row.prompt,
      row.prev_interaction_id,
      row.interaction_id,
      row.status,
      row.aspect_ratio,
      row.image_size,
      row.latency_ms,
      row.cost_usd,
      row.error,
      row.created_at,
    );
    return row;
  }

  completeGeneration(
    id: string,
    patch: {
      status: GenerationStatus;
      interactionId?: string | null;
      latencyMs?: number | null;
      costUsd?: number | null;
      error?: string | null;
    },
  ): void {
    this.run(
      `UPDATE generations
          SET status = ?, interaction_id = ?, latency_ms = ?, cost_usd = ?, error = ?
        WHERE id = ?`,
      patch.status,
      patch.interactionId ?? null,
      patch.latencyMs ?? null,
      patch.costUsd ?? null,
      patch.error ?? null,
      id,
    );
  }

  linkGenerationAsset(generationId: string, assetId: string, role: 'input' | 'output'): void {
    this.run(
      `INSERT OR IGNORE INTO generation_assets (generation_id, asset_id, role)
       VALUES (?, ?, ?)`,
      generationId,
      assetId,
      role,
    );
  }

  listGenerationOutputs(generationId: string): AssetRow[] {
    return this.all<AssetRow>(
      `SELECT a.* FROM generation_assets ga
        JOIN assets a ON a.id = ga.asset_id
       WHERE ga.generation_id = ? AND ga.role = 'output'`,
      generationId,
    );
  }

  /** Most recent generation for the session, newest first. */
  lastGeneration(sessionId: string): GenerationRow | undefined {
    return this.one<GenerationRow>(
      `SELECT * FROM generations WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
      sessionId,
    );
  }

  /** -------------------------------------------------------------- messages */

  /**
   * Records an inbound channel message. Returns undefined when the channel
   * message id was already stored, which is how duplicate webhook deliveries
   * are suppressed (Meta retries aggressively).
   */
  recordInboundMessage(input: {
    sessionId: string;
    kind: string;
    body?: string | null;
    assetId?: string | null;
    externalId?: string | null;
  }): MessageRow | undefined {
    if (input.externalId) {
      const existing = this.one<MessageRow>(
        `SELECT * FROM messages WHERE direction = 'inbound' AND external_id = ?`,
        input.externalId,
      );
      if (existing) return undefined;
    }
    return this.insertMessage({
      sessionId: input.sessionId,
      direction: 'inbound',
      kind: input.kind,
      body: input.body ?? null,
      assetId: input.assetId ?? null,
      externalId: input.externalId ?? null,
      status: 'received',
    });
  }

  insertMessage(input: {
    sessionId: string;
    direction: MessageDirection;
    kind: string;
    body?: string | null;
    assetId?: string | null;
    externalId?: string | null;
    status?: string | null;
    error?: string | null;
  }): MessageRow {
    const row: MessageRow = {
      id: randomUUID(),
      session_id: input.sessionId,
      direction: input.direction,
      kind: input.kind,
      body: input.body ?? null,
      asset_id: input.assetId ?? null,
      external_id: input.externalId ?? null,
      status: input.status ?? null,
      error: input.error ?? null,
      created_at: nowIso(),
    };
    try {
      this.run(
        `INSERT INTO messages (id, session_id, direction, kind, body, asset_id,
                               external_id, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.session_id,
        row.direction,
        row.kind,
        row.body,
        row.asset_id,
        row.external_id,
        row.status,
        row.error,
        row.created_at,
      );
    } catch (err) {
      // Unique violation on (direction, external_id): the channel re-delivered.
      if (input.externalId && String(err).includes('UNIQUE')) {
        const existing = this.one<MessageRow>(
          `SELECT * FROM messages WHERE direction = ? AND external_id = ?`,
          input.direction,
          input.externalId,
        );
        if (existing) return existing;
      }
      throw err;
    }
    return row;
  }

  updateMessageStatus(externalId: string, status: string, error?: string): void {
    this.run(
      `UPDATE messages SET status = ?, error = ? WHERE external_id = ? AND direction = 'outbound'`,
      status,
      error ?? null,
      externalId,
    );
  }

  listMessages(sessionId: string, limit = 100): MessageRow[] {
    return this.all<MessageRow>(
      `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
      sessionId,
      limit,
    );
  }
}
