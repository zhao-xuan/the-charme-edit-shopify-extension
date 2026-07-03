-- Charmé catalog schema (Cloudflare D1)
-- Metadata for merchant-managed products & charms. Images live in KV (binding
-- IMAGES) keyed by `img:<imageKey>`; rows store the imageKey, not the bytes.

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'phone',  -- 'phone' | 'tote'
  base_price  REAL NOT NULL DEFAULT 26,
  width_mm    REAL NOT NULL,
  height_mm   REAL NOT NULL,
  image_key   TEXT,                            -- KV key for the body photo
  colour_label TEXT DEFAULT 'Default',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS charms (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  collection  TEXT DEFAULT 'Custom',
  category    TEXT NOT NULL DEFAULT 'gold',    -- gold | silver | colourful | unique
  tier        TEXT NOT NULL DEFAULT 'midi',    -- grande | midi | mini
  type        INTEGER NOT NULL DEFAULT 2,      -- 1 fixed | 2 size | 3 scatter
  price       REAL NOT NULL DEFAULT 2,
  width_mm    REAL NOT NULL,
  height_mm   REAL NOT NULL,
  px_w        INTEGER,
  px_h        INTEGER,
  image_key   TEXT NOT NULL,                   -- KV key for the cut-out PNG
  hidden      INTEGER NOT NULL DEFAULT 0,
  source      TEXT DEFAULT 'custom',           -- 'extracted' | 'custom'
  dup_of      TEXT,                            -- best gold-catalogue match id (advisory)
  dup_score   REAL,
  bundle      INTEGER NOT NULL DEFAULT 0,      -- 1 = flat price, customer may pick several
  bundle_max  INTEGER,                         -- max picks for the flat price (when bundle = 1)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Migration for databases created before the bundle columns existed (run once;
-- safe to ignore "duplicate column" errors on databases that already have them):
--   ALTER TABLE charms ADD COLUMN bundle INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE charms ADD COLUMN bundle_max INTEGER;

-- Price / hide overrides for the BUNDLED base catalogue (keyed by its built-in id).
CREATE TABLE IF NOT EXISTS overrides (
  scope   TEXT NOT NULL,   -- 'product' | 'charm'
  ref_id  TEXT NOT NULL,   -- bundled product/charm id
  price   REAL,
  hidden  INTEGER,
  PRIMARY KEY (scope, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_charms_category ON charms (category);
CREATE INDEX IF NOT EXISTS idx_charms_source ON charms (source);

-- Digitised design PRESETS. Each row is one storefront "custom phone case"
-- design, keyed by its Shopify product handle. `layout` is the full seedable
-- customizer arrangement as JSON — { productId, caseColourId, gelColourId,
-- charms:[{charmId,src,name,category,type,price,cxMm,cyMm,wMm,hMm,rot}] } — so
-- opening the widget from that design's product page auto-loads it for further
-- editing. The charm `src` values point at bundled catalogue art (served via the
-- Pages CDN), so no image bytes are stored here.
CREATE TABLE IF NOT EXISTS presets (
  handle      TEXT PRIMARY KEY,                -- Shopify product handle of the design
  title       TEXT,
  product_id  TEXT NOT NULL DEFAULT 'iphone-16-pro-max',
  case_colour TEXT NOT NULL DEFAULT 'white',   -- white | black
  gel_colour  TEXT NOT NULL DEFAULT 'glitter', -- glitter | white | black
  layout      TEXT NOT NULL,                   -- full layout JSON (see above)
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_presets_active ON presets (active);
