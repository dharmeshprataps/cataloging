-- ---------------------------------------------------------------------------
-- Schema for the WhatsApp catalog bot.
--
-- Written portably (TEXT/INTEGER, no vendor-specific types) so migrating to
-- Postgres later is a translation, not a rewrite. Booleans are stored as
-- INTEGER 0/1, timestamps as ISO-8601 TEXT.
-- ---------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orgs (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  -- JSON blob of the brand's house style, injected into every prompt so a
  -- catalog looks visually consistent across SKUs.
  style_guide_json  TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- Channel-scoped external id: WhatsApp wa_id, or "sim:<clientId>" locally.
  external_id   TEXT NOT NULL,
  display_name  TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (org_id, external_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  contact_id          TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  stage               TEXT NOT NULL,
  brief_json          TEXT,
  -- JSON array of asset ids for the current turn's garment photos.
  refs_json           TEXT,
  -- Enables sequential, targeted edits instead of costly regeneration.
  last_interaction_id TEXT,
  -- Current best output; the hero candidate, and the image a revision edits.
  last_output_asset_id TEXT,
  -- Product row being assembled across turns (created before approval so the
  -- user can set SKU/title during review).
  product_id          TEXT REFERENCES products(id) ON DELETE SET NULL,
  -- Text of the most recent brief the user was asked to confirm.
  pending_brief_text  TEXT,
  last_inbound_at     TEXT,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  generation_count    INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_contact ON sessions(contact_id);

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,           -- uploaded | generated
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  path        TEXT NOT NULL,
  sha256      TEXT,
  source      TEXT,                    -- whatsapp | simulator
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_sha ON assets(sha256);

CREATE TABLE IF NOT EXISTS products (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  sku           TEXT,
  title         TEXT,
  description   TEXT,
  price_cents   INTEGER,
  currency      TEXT,
  category      TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_org ON products(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_products_org_sku
  ON products(org_id, sku) WHERE sku IS NOT NULL;

CREATE TABLE IF NOT EXISTS product_assets (
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,           -- input | hero | alternate
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, asset_id, role)
);

CREATE TABLE IF NOT EXISTS generations (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  product_id          TEXT REFERENCES products(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  prompt              TEXT NOT NULL,
  prev_interaction_id TEXT,
  interaction_id      TEXT,
  status              TEXT NOT NULL,   -- pending | succeeded | failed
  aspect_ratio        TEXT,
  image_size          TEXT,
  latency_ms          INTEGER,
  cost_usd            REAL,
  error               TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generations_session ON generations(session_id);

CREATE TABLE IF NOT EXISTS generation_assets (
  generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  asset_id      TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,         -- input | output
  PRIMARY KEY (generation_id, asset_id, role)
);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL,         -- inbound | outbound
  kind          TEXT NOT NULL,         -- text | image | interactive | status
  body          TEXT,
  asset_id      TEXT REFERENCES assets(id) ON DELETE SET NULL,
  -- Channel message id. UNIQUE is what makes webhook retries idempotent.
  external_id   TEXT,
  status        TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_external
  ON messages(direction, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
