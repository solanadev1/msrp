-- MSRP storage (Cloudflare D1). Additive and safe to run more than once.
-- The Worker also creates these tables by itself the first time it finds them missing
-- (same statements, see SCHEMA_STATEMENTS in src/web/store.ts), so this file and that list
-- must stay identical. A test checks that.

-- One row per coin: the latest printed sticker.
CREATE TABLE IF NOT EXISTS stickers (
  mint TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  overall_stars INTEGER,
  independent_pct REAL,
  name TEXT,
  symbol TEXT,
  image_url TEXT
);

CREATE INDEX IF NOT EXISTS stickers_computed_at ON stickers (computed_at DESC);

-- Daily counters (UTC day), e.g. how many new stickers were printed site-wide.
CREATE TABLE IF NOT EXISTS usage (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric)
);
