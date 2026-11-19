/**
 * STAR RULES. Each rule fits in one sentence (methodology.ts prints them from the same constants).
 *
 * Stars measure how transparent the ownership and launch are. They do not predict price.
 * A rating is null ("not rated") when there is not enough evidence. Negative evidence can still
 * produce a low rating from a partial picture; a high rating always needs the full picture.
 */
import type { Finding, Rating, Stars } from "../types";
import { LIMITS, THRESHOLDS } from "../config";
import type { BuildAnalysis } from "./build";
import type { CrowdAnalysis } from "./crowd";
import type { MarketAnalysis } from "./market";
import { ENGINE_RULES } from "./rules";
import { fmtMinutes, fmtPct, fmtSol, plural } from "./format";

type StarCount = Exclude<Stars, null>;

function toStars(n: number): StarCount {
  return Math.min(5, Math.max(1, Math.round(n))) as StarCount;
}

function starWord(s: StarCount): string {
  return plural(s, "star");
}

/** Crowd tier: insider share of circulating supply (0-100) -> stars. */
export function starsFromInsiderPct(pct: number): StarCount {
  for (const t of ENGINE_RULES.INSIDER_STAR_TIERS) if (pct < t.below) return t.stars;
  return 1;
}

/** Market tier: liquidity as % of market cap -> stars. */
export function starsFromLiquidityPct(pct: number): StarCount {
  for (const t of ENGINE_RULES.LIQUIDITY_STAR_TIERS) if (pct >= t.atLeast) return t.stars;
  return 1;
}

/** Build: start at 5, minus one per launch-factory sign, never below 1. */
export function starsFromSigns(signCount: number): StarCount {
  return toStars(5 - signCount);
}

function signLabels(b: BuildAnalysis): string[] {
  const s = b.section;
  const out: string[] = [];
  if (b.signs.freshDeployer && s.deployerFundedBeforeLaunchMin !== null) {
    out.push(`deployer funded ${fmtMinutes(s.deployerFundedBeforeLaunchMin)} before launch`);
  }
  if (b.signs.factoryFamily) out.push(`${s.familyLaunchCount} launches from the deployer's family`);
  if (b.signs.fastDevSell) {
    out.push(
      `${plural(s.familyFastDevSellCount, "launch", "launches")} with a dev sell within ${THRESHOLDS.FAST_DEV_SELL_MIN} minutes`,
    );
  }
  if (b.signs.sweep) out.push(`${fmtSol(s.sentBackToFunderSol)} sent back to the funder`);
  if (b.signs.authorityActive) out.push("mint or freeze authority still active");
  return out;
}

export function rateBuild(b: BuildAnalysis): Rating {
  if (!b.deployerKnown) return { stars: null, reason: "Not rated: the deployer wallet is unknown." };
  const labels = signLabels(b);
  const stars = starsFromSigns(b.signCount);
  const list = labels.join("; ");
  if (b.traced && b.originKnown) {
    if (b.signCount === 0) {
      return { stars, reason: "No launch-factory signs and no active mint or freeze authority found." };
    }
    return { stars, reason: `${plural(b.signCount, "sign")} found: ${list}.` };
  }
  // Partial trace: we can report signs we saw, but cannot vouch for what we couldn't see.
  if (b.signCount === 0) {
    return {
      stars: null,
      reason: b.traced
        ? "Not rated: we couldn't find where the deployer's SOL came from."
        : "Not rated: we couldn't trace the deployer's history.",
    };
  }
  const capped = Math.min(stars, ENGINE_RULES.PARTIAL_TRACE_MAX_STARS) as StarCount;
  return {
    stars: capped,
    reason: `Partial trace; ${plural(b.signCount, "sign")} found: ${list}` +
      (capped < stars ? ` (capped at ${starWord(capped)}).` : "."),
  };
}

export function rateCrowd(c: CrowdAnalysis): Rating {
  if (c.holdersAnalyzed === 0) return { stars: null, reason: "Not rated: the holder list could not be read." };
  if (c.evidence === "none" || c.circulatingPct === null || c.insiderHeldPct === null) {
    return { stars: null, reason: "Not rated: there were no wallet holders to check." };
  }
  if (c.evidence === "partial") {
    const floor = c.circulatingPct > 0 ? (c.insiderHeldPct / c.circulatingPct) * 100 : 0;
    const stars = starsFromInsiderPct(floor);
    if (stars <= 2) {
      return {
        stars,
        reason: `Insiders hold at least ${fmtPct(Math.round(floor * 100) / 100)} of circulating supply; most other ` +
          "checked holders could not be traced.",
      };
    }
    return {
      stars: null,
      reason: "Not rated: we couldn't trace the wallets holding most of the supply we checked.",
    };
  }
  const insider = c.insiderPct ?? 0;
  let stars = starsFromInsiderPct(insider);
  const notes: string[] = [];
  if (c.concentrated.length > 0 && stars > ENGINE_RULES.CONCENTRATION_MAX_STARS) {
    stars = ENGINE_RULES.CONCENTRATION_MAX_STARS as StarCount;
    notes.push(
      `a wallet holds more than ${fmtPct(THRESHOLDS.WALLET_CONCENTRATION_PCT)} of supply (capped at ${starWord(stars)})`,
    );
  }
  const tail = c.tailOfCirculatingPct;
  if (tail !== null && tail > ENGINE_RULES.TAIL_CAP_PCT && stars > ENGINE_RULES.TAIL_MAX_STARS) {
    stars = ENGINE_RULES.TAIL_MAX_STARS as StarCount;
    notes.push(
      `${fmtPct(tail)} of circulating supply is outside the top ${LIMITS.TOP_HOLDERS} holders and unchecked ` +
        `(capped at ${starWord(stars)})`,
    );
  }
  return {
    stars,
    reason: `Insiders hold ${fmtPct(insider)} of circulating supply` + (notes.length ? `; ${notes.join("; ")}.` : "."),
  };
}

export function rateMarket(m: MarketAnalysis): Rating {
  if (!m.market) return { stars: null, reason: "Not rated: no market data from DEX Screener." };
  if (m.marketCapUsd === null) return { stars: null, reason: "Not rated: market cap not reported." };
  if (m.liquidityToMcapPct === null) {
    return {
      stars: null,
      reason:
        m.graduated === false
          ? "Not rated: still on the bonding curve and no pool liquidity was reported."
          : "Not rated: liquidity not reported.",
    };
  }
  const base = starsFromLiquidityPct(m.liquidityToMcapPct);
  const reason = `Liquidity is ${fmtPct(m.liquidityToMcapPct)} of market cap`;
  if (m.hasVolume === false) {
    const stars = toStars(base - 1);
    return { stars, reason: `${reason}; no trading in the last 24 hours (minus 1 star).` };
  }
  return { stars: base, reason: `${reason}.` };
}

const SECTION_NAMES = { build: "build", crowd: "crowd", market: "market" } as const;

/**
 * Overall: the lowest of the section ratings (market ignored when not rated), capped at
 * DANGER_MAX_STARS by any danger finding; not rated when build or crowd is not rated, unless a
 * danger finding already settles it.
 */
export function rateOverall(
  sections: { build: Rating; crowd: Rating; market: Rating },
  findings: readonly Finding[],
): Rating {
  const dangers = findings.filter((f) => f.severity === "danger");
  const cap = ENGINE_RULES.DANGER_MAX_STARS as StarCount;
  const order = ["build", "crowd", "market"] as const;
  const rated = order
    .map((k) => ({ k, stars: sections[k].stars }))
    .filter((r): r is { k: (typeof order)[number]; stars: StarCount } => r.stars !== null);
  const missing = (["build", "crowd"] as const).filter((k) => sections[k].stars === null);
  const firstDanger = dangers[0];

  if (missing.length > 0) {
    const what = missing.map((k) => SECTION_NAMES[k]).join(" and ");
    if (!firstDanger) {
      return { stars: null, reason: `Not rated: the ${what} section did not have enough evidence.` };
    }
    const stars = Math.min(cap, ...rated.map((r) => r.stars)) as StarCount;
    return {
      stars,
      reason: `${starWord(stars)} at most because of a danger finding (${firstDanger.title}); the ${what} ` +
        `section could not be rated.`,
    };
  }

  let lowest = rated[0];
  for (const r of rated) if (lowest === undefined || r.stars < lowest.stars) lowest = r;
  if (!lowest) return { stars: null, reason: "Not rated: no section could be rated." };
  if (firstDanger && lowest.stars > cap) {
    return { stars: cap, reason: `Capped at ${starWord(cap)} by a danger finding: ${firstDanger.title}.` };
  }
  return {
    stars: lowest.stars,
    reason: `Lowest section rating: ${SECTION_NAMES[lowest.k]} (${starWord(lowest.stars)})` +
      (firstDanger ? `; plus ${plural(dangers.length, "danger finding")}.` : "."),
  };
}
