/**
 * buildSticker: CollectedFacts -> Sticker. Pure, deterministic, no network, no clock
 * (computedAt is the time the facts were collected).
 *
 * Headline definitions:
 * - marketCapUsd:    DEX Screener market cap (null when not reported or not a positive number).
 * - independentPct:  % of CIRCULATING supply (total minus infrastructure seen in the top holders)
 *                    held by top holders we traced and found no link for. Supply outside the top
 *                    holders is not counted, so this is a floor. Null when untraceable wallets hold
 *                    more than half of the supply we checked.
 * - independentOfTotalPct: the same wallets' share of TOTAL supply (what the main view, the badge and
 *                    the home list show, so every visible figure has one basis). Same null rule.
 * - insiderPct:      % of circulating supply held by the creator, linked wallets and same-block
 *                    buyers among the top holders. Null under the same evidence rule.
 * - stickerPriceUsd: marketCapUsd x (share of TOTAL supply held by those independent wallets), i.e.
 *                    the current dollar value of the coins held by wallets we checked and found no
 *                    link for. Null when either input is null.
 */
import type { CollectedFacts, Sticker } from "../types";
import { DISCLAIMER } from "../config";
import { analyzeBuild } from "./build";
import { analyzeCrowd, crowdInputFromFacts } from "./crowd";
import { analyzeMarket } from "./market";
import { collectFindings } from "./findings";
import { rateBuild, rateCrowd, rateMarket, rateOverall } from "./ratings";
import { finite, round } from "./format";

/** marketCapUsd x independent share of total supply (0-100). Null when either is unknown. */
export function stickerPrice(marketCapUsd: number | null, independentShareOfTotalPct: number | null): number | null {
  if (marketCapUsd === null || independentShareOfTotalPct === null) return null;
  if (!Number.isFinite(marketCapUsd) || !Number.isFinite(independentShareOfTotalPct)) return null;
  return round(marketCapUsd * (Math.min(100, Math.max(0, independentShareOfTotalPct)) / 100), 2);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function buildSticker(facts: CollectedFacts): Sticker {
  const build = analyzeBuild(facts.coin, facts.factory);
  const crowd = analyzeCrowd(crowdInputFromFacts(facts));
  const market = analyzeMarket(facts.coin.market, {
    graduated: build.section.graduated,
    curveProgressPct: build.section.curveProgressPct,
  });
  const findings = collectFindings(build, crowd, market);

  const sections = { build: rateBuild(build), crowd: rateCrowd(crowd), market: rateMarket(market) };
  const overall = rateOverall(sections, findings);

  const independentShareOfTotal = crowd.independentPct !== null ? crowd.independentHeldPct : null;

  return {
    version: 1,
    mint: facts.coin.mint,
    name: str(facts.coin.name),
    symbol: str(facts.coin.symbol),
    imageUrl: str(facts.coin.imageUrl),
    computedAt: finite(facts.collectedAt) ?? 0,
    headline: {
      marketCapUsd: market.marketCapUsd,
      independentPct: crowd.independentPct,
      independentOfTotalPct: independentShareOfTotal,
      stickerPriceUsd: stickerPrice(market.marketCapUsd, independentShareOfTotal),
      insiderPct: crowd.insiderPct,
    },
    ratings: { ...sections, overall },
    build: build.section,
    crowd: {
      holdersAnalyzed: crowd.holdersAnalyzed,
      topHolders: crowd.topHolders,
      clusters: crowd.clusters,
      creatorPct: crowd.creatorPct,
      bundlePct: crowd.bundlePct,
      clusteredPct: crowd.clusteredPct,
      infrastructurePct: crowd.infrastructurePct,
      top10Pct: crowd.top10Pct,
    },
    market: market.market,
    findings,
    coverage: { ...facts.coverage, notes: [...(facts.coverage?.notes ?? [])] },
    disclaimer: DISCLAIMER,
  };
}
