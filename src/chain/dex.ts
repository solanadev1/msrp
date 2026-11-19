/**
 * DEX Screener: market facts (price, market cap, liquidity, volume) plus name, ticker and image.
 * Picks the Solana pair of this coin with the most liquidity. Every number is validated:
 * anything not a finite, non-negative number becomes null (unknown), never 0.
 */
import type { FetchLike, MarketFacts } from "../types";

export const DEX_SCREENER_BASE = "https://api.dexscreener.com";

export interface DexTokenInfo {
  market: MarketFacts;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
}

export type DexResult =
  | { status: "ok"; info: DexTokenInfo }
  | { status: "not-listed"; info: null }
  | { status: "error"; info: null; reason: string };

export const dexTokenUrl = (mint: string) => `${DEX_SCREENER_BASE}/tokens/v1/solana/${encodeURIComponent(mint)}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A finite number >= 0 (numbers or numeric strings), else null. */
function nonNegative(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/** Percent change: finite and >= -100 (a price can't fall more than 100%). */
function pctChange(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= -100 ? n : null;
}

/**
 * Invisible characters that can make one name look like another or flip text direction on the page
 * (zero-width spaces, direction overrides, soft hyphens). The zero-width joiner U+200D stays: emoji use it.
 */
function isInvisible(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0xad ||
    code === 0x180e ||
    code === 0x200b ||
    code === 0x200c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/** A coin name or ticker as plain visible text (at most `max` characters), else null. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  let t = "";
  for (const ch of v) if (!isInvisible(ch.codePointAt(0) ?? 0)) t += ch;
  t = t.trim();
  return t.length > 0 ? [...t].slice(0, max).join("") : null;
}

function httpsUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Pure: choose the best pair for `mint` from a DEX Screener response (array of pairs or {pairs}). */
export function parseDexPairs(json: unknown, mint: string): DexTokenInfo | null {
  const pairs: unknown[] = Array.isArray(json) ? json : isObj(json) && Array.isArray(json.pairs) ? json.pairs : [];
  let best: Record<string, unknown> | null = null;
  let bestLiquidity = -1;
  for (const p of pairs) {
    if (!isObj(p) || p.chainId !== "solana") continue;
    const base = p.baseToken;
    if (!isObj(base) || base.address !== mint) continue;
    const liq = isObj(p.liquidity) ? nonNegative(p.liquidity.usd) : null;
    const rank = liq ?? 0;
    if (best === null || rank > bestLiquidity) {
      best = p;
      bestLiquidity = rank;
    }
  }
  if (!best) return null;
  const base = best.baseToken as Record<string, unknown>;
  const info = isObj(best.info) ? best.info : {};
  const created = nonNegative(best.pairCreatedAt);
  const market: MarketFacts = {
    priceUsd: nonNegative(best.priceUsd),
    marketCapUsd: nonNegative(best.marketCap),
    fdvUsd: nonNegative(best.fdv),
    liquidityUsd: isObj(best.liquidity) ? nonNegative(best.liquidity.usd) : null,
    volume24hUsd: isObj(best.volume) ? nonNegative(best.volume.h24) : null,
    priceChange24hPct: isObj(best.priceChange) ? pctChange(best.priceChange.h24) : null,
    dex: cleanText(best.dexId, 40),
    pairAddress: cleanText(best.pairAddress, 64),
    pairUrl: httpsUrl(best.url),
    pairCreatedAt: created !== null && created > 0 ? Math.round(created) : null,
  };
  return {
    market,
    name: cleanText(base.name, 80),
    symbol: cleanText(base.symbol, 24),
    imageUrl: httpsUrl(info.imageUrl),
  };
}

/** Look a coin up on DEX Screener. Never throws. */
export async function fetchDexToken(mint: string, fetchFn: FetchLike, timeoutMs = 8000): Promise<DexResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(dexTokenUrl(mint), { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) return { status: "error", info: null, reason: `DEX Screener answered HTTP ${response.status}` };
    const json = (await response.json()) as unknown;
    const info = parseDexPairs(json, mint);
    return info ? { status: "ok", info } : { status: "not-listed", info: null };
  } catch {
    return { status: "error", info: null, reason: controller.signal.aborted ? "DEX Screener timed out" : "DEX Screener could not be reached" };
  } finally {
    clearTimeout(timer);
  }
}
