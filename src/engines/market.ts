/**
 * MARKET FACTS: is there a real market behind the price?
 *
 * Inputs come from DEX Screener (via src/chain) plus the pump.fun curve state. The market rating
 * looks at liquidity as a share of market cap and whether anything traded in the last 24 hours.
 * It says nothing about where the price goes next.
 */
import type { MarketFacts } from "../types";
import { finite, positive, nonNegative, round } from "./format";

export interface MarketAnalysis {
  /** Cleaned copy of the market facts (non-finite or negative money values become null). */
  market: MarketFacts | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  /** Liquidity as % of market cap (can exceed 100 for tiny coins). */
  liquidityToMcapPct: number | null;
  volume24hUsd: number | null;
  /** True = some volume in 24h, false = exactly none reported, null = not reported. */
  hasVolume: boolean | null;
  /** From the pump.fun curve: true = graduated, false = still on the curve, null = unknown. */
  graduated: boolean | null;
  curveProgressPct: number | null;
}

/** Copy market facts with every number guarded. Money values must be > 0 (or >= 0 for volume). */
export function sanitizeMarket(m: MarketFacts | null): MarketFacts | null {
  if (!m) return null;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    priceUsd: positive(m.priceUsd),
    marketCapUsd: positive(m.marketCapUsd),
    fdvUsd: positive(m.fdvUsd),
    liquidityUsd: nonNegative(m.liquidityUsd),
    volume24hUsd: nonNegative(m.volume24hUsd),
    priceChange24hPct: finite(m.priceChange24hPct),
    dex: str(m.dex),
    pairAddress: str(m.pairAddress),
    pairUrl: str(m.pairUrl),
    pairCreatedAt: finite(m.pairCreatedAt),
  };
}

export function analyzeMarket(
  rawMarket: MarketFacts | null,
  curve: { graduated: boolean | null; curveProgressPct: number | null },
): MarketAnalysis {
  const market = sanitizeMarket(rawMarket);
  const marketCapUsd = market?.marketCapUsd ?? null;
  const liquidityUsd = market?.liquidityUsd ?? null;
  const volume24hUsd = market?.volume24hUsd ?? null;
  return {
    market,
    marketCapUsd,
    liquidityUsd,
    liquidityToMcapPct:
      marketCapUsd !== null && liquidityUsd !== null ? round((liquidityUsd / marketCapUsd) * 100, 2) : null,
    volume24hUsd,
    hasVolume: volume24hUsd === null ? null : volume24hUsd > 0,
    graduated: curve.graduated,
    curveProgressPct: curve.curveProgressPct,
  };
}
