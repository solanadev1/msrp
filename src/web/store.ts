/**
 * Where printed stickers are kept.
 *
 *   1. A small in-memory list per Worker instance (fastest, forgotten when the instance stops).
 *   2. Then ONE persistent layer:
 *      - D1 (env.DB) when the owner has attached a database: the `stickers` table.
 *      - Otherwise the free Cloudflare cache (caches.default) under made-up internal URLs.
 *        The cache can drop entries at any time, so this is "best effort" memory.
 *
 * `get()` returns the newest copy we have, fresh or stale. The caller decides what "fresh"
 * means (stale stickers are still fine for badges, share images and the sitemap).
 * Nothing here throws: a storage hiccup only means "not found" or "not saved".
 * Failed computations are never stored (only finished Sticker objects reach `put`).
 */
import { CACHE } from "../config";
import type { Env, RecentSticker, Sticker } from "../types";
import { describeError } from "./errors";
import { isValidMint } from "./validate";

/** Stickers kept in memory per Worker instance (each is roughly 10-30 KB). */
export const MEMORY_STICKERS = 200;
/** How long the free cache is asked to keep a sticker (it may drop it sooner). */
export const CACHE_API_KEEP_SEC = 7 * 24 * 60 * 60;
/** Entries kept in the free cache's "recently checked" list (no database mode). */
export const CACHE_API_RECENT = 200;
/** Re-read the "recently checked" list from storage at most this often per instance. */
export const RECENT_MEMO_MS = 30_000;
/** Stickers larger than this are kept in memory only (D1 rows are capped at 2 MB). */
export const MAX_STORED_JSON_CHARS = 1_000_000;
/** Internal, never-resolving host used as the key space in the free cache. */
const CACHE_KEY_BASE = "https://msrp-cache.invalid/v1";

export type StorageKind = "d1" | "cache-only";

export interface StickerCache {
  /** Newest saved sticker for this mint (fresh or stale), or null. Never throws. */
  get(env: Env, mint: string): Promise<Sticker | null>;
  /** Save a finished sticker in memory and in persistent storage. Never throws. */
  put(env: Env, sticker: Sticker): Promise<void>;
  /** Most recently printed stickers, newest first. Never throws. */
  recent(env: Env, limit: number): Promise<RecentSticker[]>;
  /** Which persistent storage this environment uses. */
  storage(env: Env): StorageKind;
}

/** The part of the Cache API we use (caches.default in Workers; a fake in tests). */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** The part of D1 we use. */
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(sql: string): D1StatementLike;
}

export interface StickerCacheOptions {
  now: () => number;
  /** The free cache, or null when unavailable (tests, local tools). */
  cache?: () => CacheLike | null;
  memorySize?: number;
  /** Error log without secrets. */
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

/** The Cloudflare free cache, when this runtime has one. */
export function defaultCache(): CacheLike | null {
  const c = (globalThis as unknown as { caches?: { default?: CacheLike } }).caches;
  return c && c.default ? c.default : null;
}

export function dbOf(env: Env): D1Like | null {
  const db = env.DB as unknown;
  return db && typeof (db as D1Like).prepare === "function" ? (db as D1Like) : null;
}

/** Row for "recently checked" lists. */
export function toRecent(s: Sticker): RecentSticker {
  return {
    mint: s.mint,
    name: s.name ?? null,
    symbol: s.symbol ?? null,
    imageUrl: s.imageUrl ?? null,
    overallStars: s.ratings?.overall?.stars ?? null,
    independentPct: finiteOrNull(s.headline?.independentPct),
    computedAt: s.computedAt,
  };
}

/** Minimal shape check for anything read back from storage. */
export function looksLikeSticker(value: unknown, mint?: string): value is Sticker {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<Sticker>;
  return (
    s.version === 1 &&
    typeof s.mint === "string" &&
    (mint === undefined || s.mint === mint) &&
    typeof s.computedAt === "number" &&
    Number.isFinite(s.computedAt) &&
    !!s.ratings &&
    typeof s.ratings === "object" &&
    !!s.headline &&
    typeof s.headline === "object"
  );
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function starsOrNull(v: unknown): RecentSticker["overallStars"] {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5 ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Turn a database / cache row back into a RecentSticker (rows are untrusted). */
export function recentFromRow(row: Record<string, unknown>): RecentSticker | null {
  const mint = row.mint;
  const computedAt = Number(row.computed_at ?? row.computedAt);
  if (!isValidMint(mint) || !Number.isFinite(computedAt)) return null;
  return {
    mint,
    name: strOrNull(row.name),
    symbol: strOrNull(row.symbol),
    imageUrl: strOrNull(row.image_url ?? row.imageUrl),
    overallStars: starsOrNull(row.overall_stars === null ? null : Number(row.overall_stars ?? row.overallStars)),
    independentPct: finiteOrNull(row.independent_pct === null ? null : Number(row.independent_pct ?? row.independentPct)),
    computedAt,
  };
}

function newestFirst(a: RecentSticker, b: RecentSticker): number {
  return b.computedAt - a.computedAt;
}

function mergeRecent(lists: RecentSticker[][], limit: number): RecentSticker[] {
  const byMint = new Map<string, RecentSticker>();
  for (const list of lists) {
    for (const r of list) {
      const have = byMint.get(r.mint);
      if (!have || r.computedAt > have.computedAt) byMint.set(r.mint, r);
    }
  }
  return [...byMint.values()].sort(newestFirst).slice(0, Math.max(0, limit));
}

/**
 * The database tables, exactly as in migrations/0001_init.sql (a test keeps them identical).
 * All statements are "IF NOT EXISTS": additive and safe to run any number of times.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  "CREATE TABLE IF NOT EXISTS stickers (\n" +
    "  mint TEXT PRIMARY KEY NOT NULL,\n" +
    "  json TEXT NOT NULL,\n" +
    "  computed_at INTEGER NOT NULL,\n" +
    "  overall_stars INTEGER,\n" +
    "  independent_pct REAL,\n" +
    "  name TEXT,\n" +
    "  symbol TEXT,\n" +
    "  image_url TEXT\n" +
    ")",
  "CREATE INDEX IF NOT EXISTS stickers_computed_at ON stickers (computed_at DESC)",
  "CREATE TABLE IF NOT EXISTS usage (\n" +
    "  day TEXT NOT NULL,\n" +
    "  metric TEXT NOT NULL,\n" +
    "  count INTEGER NOT NULL DEFAULT 0,\n" +
    "  PRIMARY KEY (day, metric)\n" +
    ")",
];

const schemaReady = new WeakSet<object>();

/** Create the tables if they are missing. Runs at most once per database per Worker instance. */
export async function ensureSchema(db: D1Like): Promise<void> {
  if (schemaReady.has(db)) return;
  for (const sql of SCHEMA_STATEMENTS) await db.prepare(sql).run();
  schemaReady.add(db);
}

/**
 * Run a database step; if the tables don't exist yet (the owner attached a database but
 * never ran the migration), create them and try once more.
 */
export async function withSchema<T>(db: D1Like, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (!/no such table/i.test(error instanceof Error ? error.message : String(error))) throw error;
    schemaReady.delete(db);
    await ensureSchema(db);
    return step();
  }
}

const SQL_GET = "SELECT json FROM stickers WHERE mint = ?1";
const SQL_PUT =
  "INSERT INTO stickers (mint, json, computed_at, overall_stars, independent_pct, name, symbol, image_url) " +
  "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) " +
  "ON CONFLICT(mint) DO UPDATE SET json = excluded.json, computed_at = excluded.computed_at, " +
  "overall_stars = excluded.overall_stars, independent_pct = excluded.independent_pct, " +
  "name = excluded.name, symbol = excluded.symbol, image_url = excluded.image_url " +
  "WHERE excluded.computed_at >= stickers.computed_at";
const SQL_RECENT =
  "SELECT mint, name, symbol, image_url, overall_stars, independent_pct, computed_at " +
  "FROM stickers ORDER BY computed_at DESC LIMIT ?1";

export function createStickerCache(options: StickerCacheOptions): StickerCache {
  const memorySize = Math.max(1, options.memorySize ?? MEMORY_STICKERS);
  const getCache = options.cache ?? defaultCache;
  const log = options.log ?? ((message, detail) => console.error(message, detail ?? ""));
  const memory = new Map<string, Sticker>();
  let recentMemo: { at: number; storage: StorageKind; rows: RecentSticker[]; limit: number } | null = null;

  const ttlMs = CACHE.STICKER_TTL_SEC * 1000;
  const isFresh = (s: Sticker) => options.now() - s.computedAt < ttlMs;

  function remember(s: Sticker): void {
    const have = memory.get(s.mint);
    if (have && have.computedAt > s.computedAt) return;
    memory.delete(s.mint);
    memory.set(s.mint, s);
    while (memory.size > memorySize) {
      const oldest = memory.keys().next();
      if (oldest.done) break;
      memory.delete(oldest.value);
    }
  }

  function fromMemory(mint: string): Sticker | null {
    const s = memory.get(mint);
    if (!s) return null;
    // Move to the end: most recently used.
    memory.delete(mint);
    memory.set(mint, s);
    return s;
  }

  function cacheKey(path: string): Request {
    return new Request(`${CACHE_KEY_BASE}/${path}`);
  }

  async function readCacheJson(cache: CacheLike, path: string): Promise<unknown> {
    const hit = await cache.match(cacheKey(path));
    if (!hit) return null;
    return JSON.parse(await hit.text()) as unknown;
  }

  async function writeCacheJson(cache: CacheLike, path: string, value: unknown): Promise<void> {
    await cache.put(
      cacheKey(path),
      new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json", "cache-control": `public, max-age=${CACHE_API_KEEP_SEC}` },
      }),
    );
  }

  async function persistentGet(env: Env, mint: string): Promise<Sticker | null> {
    const db = dbOf(env);
    if (db) {
      const row = await withSchema(db, () => db.prepare(SQL_GET).bind(mint).first<{ json?: unknown }>());
      if (!row || typeof row.json !== "string") return null;
      const parsed = JSON.parse(row.json) as unknown;
      return looksLikeSticker(parsed, mint) ? parsed : null;
    }
    const cache = getCache();
    if (!cache) return null;
    const parsed = await readCacheJson(cache, `sticker/${encodeURIComponent(mint)}`);
    return looksLikeSticker(parsed, mint) ? parsed : null;
  }

  async function persistentPut(env: Env, s: Sticker, json: string): Promise<void> {
    const db = dbOf(env);
    if (db) {
      const r = toRecent(s);
      await withSchema(db, () =>
        db
          .prepare(SQL_PUT)
          .bind(s.mint, json, Math.round(s.computedAt), r.overallStars, r.independentPct, r.name, r.symbol, r.imageUrl)
          .run(),
      );
      return;
    }
    const cache = getCache();
    if (!cache) return;
    await cache.put(
      cacheKey(`sticker/${encodeURIComponent(s.mint)}`),
      new Response(json, {
        headers: { "content-type": "application/json", "cache-control": `public, max-age=${CACHE_API_KEEP_SEC}` },
      }),
    );
    // Keep a small "recently checked" list next to it (best effort: two instances can race).
    const index = await readCacheJson(cache, "recent").catch(() => null);
    const rows = Array.isArray(index)
      ? index.map((x) => (x && typeof x === "object" ? recentFromRow(x as Record<string, unknown>) : null)).filter((x) => x !== null)
      : [];
    await writeCacheJson(cache, "recent", mergeRecent([[toRecent(s)], rows], CACHE_API_RECENT));
  }

  async function persistentRecent(env: Env, limit: number): Promise<RecentSticker[]> {
    const db = dbOf(env);
    if (db) {
      const result = await withSchema(db, () => db.prepare(SQL_RECENT).bind(limit).all<Record<string, unknown>>());
      return (result.results ?? []).map(recentFromRow).filter((x) => x !== null);
    }
    const cache = getCache();
    if (!cache) return [];
    const index = await readCacheJson(cache, "recent");
    if (!Array.isArray(index)) return [];
    return index
      .map((x) => (x && typeof x === "object" ? recentFromRow(x as Record<string, unknown>) : null))
      .filter((x) => x !== null);
  }

  function storage(env: Env): StorageKind {
    return dbOf(env) ? "d1" : "cache-only";
  }

  return {
    storage,

    async get(env, mint) {
      const local = fromMemory(mint);
      if (local && isFresh(local)) return local;
      let stored: Sticker | null = null;
      try {
        stored = await persistentGet(env, mint);
      } catch (error) {
        log("msrp: reading a saved sticker failed", { storage: storage(env), error: describeError(error) });
      }
      if (stored && (!local || stored.computedAt > local.computedAt)) {
        remember(stored);
        return stored;
      }
      return local;
    },

    async put(env, sticker) {
      if (!looksLikeSticker(sticker)) return;
      remember(sticker);
      recentMemo = null;
      let json: string;
      try {
        json = JSON.stringify(sticker);
      } catch (error) {
        log("msrp: a sticker could not be saved", { error: describeError(error) });
        return;
      }
      if (json.length > MAX_STORED_JSON_CHARS) {
        log("msrp: sticker too large to save, kept in memory only", { chars: json.length });
        return;
      }
      try {
        await persistentPut(env, sticker, json);
      } catch (error) {
        log("msrp: saving a sticker failed", { storage: storage(env), error: describeError(error) });
      }
    },

    async recent(env, limit) {
      const want = Math.max(0, Math.floor(limit));
      if (want === 0) return [];
      const kind = storage(env);
      const now = options.now();
      if (recentMemo && recentMemo.storage === kind && recentMemo.limit >= want && now - recentMemo.at < RECENT_MEMO_MS) {
        return recentMemo.rows.slice(0, want);
      }
      const local = [...memory.values()].map(toRecent);
      let stored: RecentSticker[] = [];
      try {
        stored = await persistentRecent(env, want);
      } catch (error) {
        log("msrp: reading recent stickers failed", { storage: kind, error: describeError(error) });
        return mergeRecent([local], want);
      }
      const rows = mergeRecent([stored, local], want);
      recentMemo = { at: now, storage: kind, rows, limit: want };
      return rows;
    },
  };
}
