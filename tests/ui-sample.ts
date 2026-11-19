/**
 * Hand-made stickers for UI tests and screenshots (independent of the engines).
 * All addresses are made up.
 */
import type { MethodologyRule, RecentSticker, Sticker } from "../src/types";
import { DISCLAIMER } from "../src/config";

const pad = (s: string, n = 44) => s + "1".repeat(Math.max(0, n - s.length));
export const MINT = pad("7xKpUiSamp1eMint", 40) + "pump";
const DEPLOYER = pad("7xKpDep1oyerUi") ;
const FUNDER = pad("FuNdUiMaster");
const T0 = Date.UTC(2026, 10, 19, 1, 40);

export function uiSticker(): Sticker {
  return {
    version: 1,
    mint: MINT,
    name: "Window Dog",
    symbol: "WDOG",
    imageUrl: null,
    computedAt: T0,
    headline: { marketCapUsd: 1_840_000, independentPct: 39.4, stickerPriceUsd: 710_000, insiderPct: 48.2 },
    ratings: {
      build: { stars: 1, reason: "Deployer funded 3 minutes before launch; 41 launches from its family." },
      crowd: { stars: 2, reason: "Insiders hold 48.2% of circulating supply." },
      market: { stars: 3, reason: "Liquidity is 6.1% of market cap." },
      overall: { stars: 1, reason: "Lowest section rating: build (1 star)." },
    },
    build: {
      launchpad: "pump.fun",
      deployer: DEPLOYER,
      funder: FUNDER,
      deployerFundedBeforeLaunchMin: 3,
      devBuySol: 0.06,
      deployerLaunchCount: 6,
      familySize: 4,
      familyLaunchCount: 41,
      familyFastDevSellCount: 37,
      sentBackToFunderSol: 11.4,
      family: [
        { wallet: FUNDER, role: "funder", launches: 0, launchesWithFastDevSell: 0, sentBackSol: 0 },
        { wallet: DEPLOYER, role: "deployer", launches: 6, launchesWithFastDevSell: 5, sentBackSol: 2.1 },
        { wallet: pad("3hQzSib1ing"), role: "sibling", launches: 9, launchesWithFastDevSell: 9, sentBackSol: 4.4 },
        { wallet: pad("9pRwSib1ing"), role: "sibling", launches: 0, launchesWithFastDevSell: 0, sentBackSol: 0 },
      ],
      mintAuthority: null,
      freezeAuthority: null,
      createdAt: T0 - 3 * 3600_000,
      curveProgressPct: null,
      graduated: true,
    },
    crowd: {
      holdersAnalyzed: 5,
      topHolders: [
        { owner: pad("Poo1Vau1t"), pctSupply: 22, kind: "pool", clusterId: null, funder: null, label: "infrastructure" },
        { owner: pad("BundA"), pctSupply: 20, kind: "wallet", clusterId: "c1", funder: FUNDER, label: "insider" },
        { owner: DEPLOYER, pctSupply: 17.6, kind: "creator", clusterId: "c1", funder: FUNDER, label: "insider" },
        { owner: pad("Indep1"), pctSupply: 30.7, kind: "wallet", clusterId: null, funder: null, label: "independent" },
        { owner: pad("Untraced1"), pctSupply: 2, kind: "wallet", clusterId: null, funder: null, label: "unknown" },
      ],
      clusters: [{ id: "c1", funder: FUNDER, wallets: [pad("BundA"), DEPLOYER], pctSupply: 37.6, reasons: ["shared-funder", "same-block-buy"] }],
      creatorPct: 17.6,
      bundlePct: 20,
      clusteredPct: 37.6,
      infrastructurePct: 22,
      top10Pct: 70.3,
    },
    market: {
      priceUsd: 0.00184,
      marketCapUsd: 1_840_000,
      fdvUsd: 1_840_000,
      liquidityUsd: 112_000,
      volume24hUsd: 930_000,
      priceChange24hPct: 4.2,
      dex: "pumpswap",
      pairAddress: pad("Poo1Vau1t"),
      pairUrl: "https://dexscreener.com/solana/examplepair",
      pairCreatedAt: T0 - 2 * 3600_000,
    },
    findings: [
      {
        id: "build.factory-pattern",
        engine: "build",
        severity: "danger",
        title: "4 linked wallets launched 41 coins",
        detail: "The deployer and 3 other wallets funded by the same wallet launched 41 coins.",
        evidence: [FUNDER, DEPLOYER, pad("3hQzSib1ing"), pad("Sig", 88)],
      },
      {
        id: "crowd.cluster.c1",
        engine: "crowd",
        severity: "warning",
        title: "The creator and 1 linked wallet hold 37.6%",
        detail: "Linked by: first SOL from the same wallet; bought in the creation block.",
        evidence: [pad("BundA"), DEPLOYER],
      },
      { id: "build.mint-authority", engine: "build", severity: "good", title: "Mint authority renounced", detail: "No one can create more of this coin.", evidence: [] },
      { id: "crowd.untraced", engine: "crowd", severity: "unknown", title: "Couldn't trace 1 of 4 holders", detail: "Too much history.", evidence: [pad("Untraced1")] },
    ],
    coverage: { rpcRequests: 28, dexRequests: 1, notes: ["Couldn't trace 1 of 4 holders (too much history)."], complete: true, elapsedMs: 7_300 },
    disclaimer: DISCLAIMER,
  };
}

/** Every optional fact missing. */
export function unknownSticker(): Sticker {
  return {
    version: 1,
    mint: MINT,
    name: null,
    symbol: null,
    imageUrl: null,
    computedAt: T0,
    headline: { marketCapUsd: null, independentPct: null, stickerPriceUsd: null, insiderPct: null },
    ratings: {
      build: { stars: null, reason: "Not enough evidence." },
      crowd: { stars: null, reason: "Not enough evidence." },
      market: { stars: null, reason: "No market data." },
      overall: { stars: null, reason: "Not enough evidence." },
    },
    build: {
      launchpad: "unknown",
      deployer: null,
      funder: null,
      deployerFundedBeforeLaunchMin: null,
      devBuySol: null,
      deployerLaunchCount: 0,
      familySize: 0,
      familyLaunchCount: 0,
      familyFastDevSellCount: 0,
      sentBackToFunderSol: 0,
      family: [],
      mintAuthority: "unknown",
      freezeAuthority: "unknown",
      createdAt: null,
      curveProgressPct: null,
      graduated: null,
    },
    crowd: {
      holdersAnalyzed: 0,
      topHolders: [],
      clusters: [],
      creatorPct: null,
      bundlePct: null,
      clusteredPct: null,
      infrastructurePct: null,
      top10Pct: null,
    },
    market: null,
    findings: [],
    coverage: { rpcRequests: 36, dexRequests: 1, notes: ["Ran out of time after 20 seconds."], complete: false, elapsedMs: 20_000 },
    disclaimer: DISCLAIMER,
  };
}

/** A clean sticker with 4+ overall stars (the SolanaView box shows). */
export function goodSticker(): Sticker {
  const s = uiSticker();
  s.ratings = {
    build: { stars: 4, reason: "No launch pattern found." },
    crowd: { stars: 5, reason: "Insiders hold 3% of circulating supply." },
    market: { stars: 4, reason: "Liquidity is 12% of market cap." },
    overall: { stars: 4, reason: "Lowest section rating: build (4 stars)." },
  };
  return s;
}

export const EVIL = `<script>alert(1)</script>"onerror=alert(2) '><img src=x onerror=alert(3)>`;

/** Hostile metadata everywhere a string can come from outside. */
export function evilSticker(): Sticker {
  const s = uiSticker();
  s.name = EVIL;
  s.symbol = `"><svg onload=alert(4)>`;
  s.imageUrl = "javascript:alert(5)";
  if (s.market) {
    s.market.dex = EVIL;
    s.market.pairUrl = "javascript:alert(6)";
  }
  s.ratings.build.reason = EVIL;
  s.findings[0]!.title = EVIL;
  s.findings[0]!.detail = EVIL;
  s.findings[0]!.evidence.push(`"><script>alert(7)</script>`);
  s.coverage.notes.push(EVIL);
  return s;
}

export function recent(): RecentSticker[] {
  return [
    { mint: MINT, name: "Window Dog", symbol: "WDOG", imageUrl: null, overallStars: 1, independentPct: 39.4, computedAt: T0 },
    { mint: pad("Cat"), name: "Glass Cat", symbol: "GCAT", imageUrl: null, overallStars: 4, independentPct: 81.2, computedAt: T0 - 600_000 },
    { mint: pad("Evi1"), name: EVIL, symbol: "X", imageUrl: "javascript:alert(1)", overallStars: null, independentPct: null, computedAt: T0 - 900_000 },
  ];
}

export const RULES: MethodologyRule[] = [
  { id: "build.deployer-trace", engine: "build", title: "Where the deployer's SOL came from", rule: "We read up to 1000 transactions.", why: "Reveals the funder.", limits: "Exchanges fund many people." },
  { id: "crowd.cluster", engine: "crowd", title: "Linked wallets", rule: "Same funder or same block.", why: "Insiders.", limits: "Patterns, not proof." },
  { id: "market.liquidity", engine: "market", title: "Liquidity", rule: "Liquidity vs market cap.", why: "Exit depth.", limits: "Can change fast." },
  { id: "overall.min", engine: "overall", title: "Overall", rule: "Lowest section.", why: "Weakest link.", limits: "Not a prediction." },
];
