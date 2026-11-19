/**
 * MSRP shared contract.
 *
 * Data flows one way:
 *
 *   src/chain   (reads Solana + DEX Screener, read-only)  ->  *Facts
 *   src/engines (pure functions, no network)              ->  Sticker
 *   src/ui      (pure rendering, no network)              ->  HTML / SVG
 *   src/worker  (routing, caching, limits)                ->  HTTP
 *
 * Rules every module follows:
 * - Read-only. MSRP never holds a private key, never builds, signs or sends a transaction.
 * - Unknown is not zero. When evidence is missing, say "unknown" and record why in `coverage`.
 * - Every number shown to a visitor can be traced back to a fact listed here.
 * - All amounts are plain JS numbers in human units (SOL, whole tokens, USD) unless
 *   the field name ends in `Raw` (then it is a decimal string of base units).
 * - Timestamps are unix milliseconds.
 */

// ---------------------------------------------------------------------------
// 1. Facts (produced by src/chain, consumed by src/engines)
// ---------------------------------------------------------------------------

/** Where a wallet's first SOL came from, as far as we could see. */
export interface WalletOrigin {
  wallet: string;
  /** Number of signatures we read for this wallet (capped). */
  signaturesSampled: number;
  /** True when we reached the wallet's very first transaction. */
  historyComplete: boolean;
  /** Time of the oldest transaction we saw. */
  firstSeenAt: number | null;
  /** Wallet that sent this wallet its first SOL (null = not found / not reached). */
  funder: string | null;
  fundedSol: number | null;
  fundedAt: number | null;
  /** Wallets with very long histories are "veteran"; we don't trace them. */
  veteran: boolean;
}

export type HolderKind =
  | "bonding-curve" // pump.fun curve account (not a person)
  | "pool" // AMM / DEX pool vault (not a person)
  | "creator" // the deployer wallet
  | "burn" // incinerator / burn address
  | "program" // owned by a program (PDA), not a person
  | "wallet"; // ordinary wallet

export interface HolderFact {
  owner: string;
  tokenAccount: string;
  amount: number;
  /** 0-100 share of total supply. */
  pctSupply: number;
  kind: HolderKind;
  /** Funding origin, only traced for kind === "wallet" | "creator". */
  origin: WalletOrigin | null;
}

/** A buy that landed in the same slot as (or the slot right after) the coin's creation. */
export interface EarlyBuyFact {
  wallet: string;
  slot: number;
  signature: string;
  tokenAmount: number;
  /** slot - creationSlot (0 = same block as creation). */
  slotsAfterCreate: number;
}

export interface MarketFacts {
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  dex: string | null;
  pairAddress: string | null;
  pairUrl: string | null;
  pairCreatedAt: number | null;
}

export interface CoinFacts {
  mint: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  decimals: number;
  /** Total supply in whole tokens. */
  supply: number;
  launchpad: "pump.fun" | "unknown";
  bondingCurve: {
    address: string;
    complete: boolean;
    /** 0-100: how far through the curve (pump.fun graduates at 100). null if unknown. */
    progressPct: number | null;
    realSolReserves: number;
  } | null;
  /** Deployer / creator wallet. */
  creator: string | null;
  createdAt: number | null;
  creationSlot: number | null;
  creationSignature: string | null;
  /** SOL the creator spent buying its own coin inside the creation transaction (dev buy). */
  devBuySol: number | null;
  /** Mint and freeze authorities (null = renounced). "unknown" if not read. */
  mintAuthority: string | null | "unknown";
  freezeAuthority: string | null | "unknown";
  market: MarketFacts | null;
}

/** One coin launched by a wallet (from that wallet's Create transactions). */
export interface LaunchFact {
  mint: string;
  deployer: string;
  signature: string;
  createdAt: number | null;
  slot: number | null;
  /** SOL spent on the dev buy inside the create tx, if visible. */
  devBuySol: number | null;
  /** Minutes from creation until the deployer first sold this coin; null = no sell seen in sample. */
  firstDevSellAfterMin: number | null;
  /** Did the deployer sell (any amount) inside our sample? */
  devSold: boolean;
}

/** A wallet funded by the same source as the deployer. */
export interface SiblingFact {
  wallet: string;
  fundedSol: number | null;
  fundedAt: number | null;
  launches: LaunchFact[];
  /** SOL this wallet sent back to the funder (the "sweep" pattern) in our sample. */
  sentBackSol: number;
  signaturesSampled: number;
}

export interface FactoryFacts {
  deployer: string;
  deployerOrigin: WalletOrigin | null;
  /** The deployer's funder (one hop up). */
  funder: string | null;
  /** Other wallets that funder sent SOL to (capped sample, excludes the deployer). */
  siblings: SiblingFact[];
  /** Coins the deployer itself launched (capped sample, includes the current coin when seen). */
  deployerLaunches: LaunchFact[];
  /** SOL the deployer sent back to its funder. */
  deployerSentBackSol: number;
  /** Signatures of the funder we sampled (to judge how complete the family picture is). */
  funderSignaturesSampled: number;
  funderIsVeteran: boolean;
}

/** What it cost us to gather the facts, and what we could not see. */
export interface Coverage {
  rpcRequests: number;
  dexRequests: number;
  /** Plain-language notes about anything missing or capped, shown on the sticker. */
  notes: string[];
  /** True if every collection step finished. False means some sections say "unknown". */
  complete: boolean;
  /** Wall-clock time spent collecting, ms. */
  elapsedMs: number;
}

export interface CollectedFacts {
  coin: CoinFacts;
  holders: HolderFact[];
  earlyBuys: EarlyBuyFact[];
  factory: FactoryFacts | null;
  coverage: Coverage;
  collectedAt: number;
}

// ---------------------------------------------------------------------------
// 2. Sticker (produced by src/engines, rendered by src/ui, served by src/worker)
// ---------------------------------------------------------------------------

export type Severity = "good" | "info" | "caution" | "warning" | "danger" | "unknown";

export interface Finding {
  /** Stable id, e.g. "factory.family-size", "xray.bundle". */
  id: string;
  engine: "build" | "crowd" | "market";
  severity: Severity;
  /** Short plain-language headline, e.g. "Deployer was funded 4 minutes before launch". */
  title: string;
  /** One or two sentences, plain language, says what was measured and its limits. */
  detail: string;
  /** Wallet addresses / signatures backing the finding (for links). */
  evidence: string[];
}

/** 1-5 stars, or null when there wasn't enough evidence to rate. */
export type Stars = 1 | 2 | 3 | 4 | 5 | null;

export interface Rating {
  stars: Stars;
  /** One-line reason for the star count. */
  reason: string;
}

export type ClusterReason = "shared-funder" | "same-block-buy" | "similar-funding" | "creator-funded";

export interface Cluster {
  id: string;
  /** Common funder if the reason is a shared funder. */
  funder: string | null;
  wallets: string[];
  /** Combined % of supply these wallets hold right now. */
  pctSupply: number;
  reasons: ClusterReason[];
}

export interface HolderView {
  owner: string;
  pctSupply: number;
  kind: HolderKind;
  /** Cluster id if linked to others. */
  clusterId: string | null;
  funder: string | null;
  /** "insider" = creator, creator-funded, clustered or same-block buyer. */
  label: "independent" | "insider" | "infrastructure" | "unknown";
}

export interface FamilyMember {
  wallet: string;
  role: "funder" | "deployer" | "sibling";
  launches: number;
  launchesWithFastDevSell: number;
  sentBackSol: number;
}

export interface Sticker {
  version: 1;
  mint: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  computedAt: number;

  /** The big numbers on the sticker. */
  headline: {
    marketCapUsd: number | null;
    /** 0-100: share of the circulating (non-infrastructure) supply held by independent wallets. */
    independentPct: number | null;
    /** The "sticker price": market cap x independent share of total supply. */
    stickerPriceUsd: number | null;
    /** 0-100: share held by insiders (creator + clusters + same-block buyers). */
    insiderPct: number | null;
  };

  ratings: {
    build: Rating; // who made it (factory trace)
    crowd: Rating; // who holds it (x-ray)
    market: Rating; // liquidity / trading reality
    overall: Rating;
  };

  build: {
    launchpad: CoinFacts["launchpad"];
    deployer: string | null;
    funder: string | null;
    deployerFundedBeforeLaunchMin: number | null;
    devBuySol: number | null;
    deployerLaunchCount: number;
    familySize: number; // deployer + siblings
    familyLaunchCount: number;
    familyFastDevSellCount: number; // launches where the dev sold within 30 minutes
    sentBackToFunderSol: number;
    family: FamilyMember[];
    mintAuthority: CoinFacts["mintAuthority"];
    freezeAuthority: CoinFacts["freezeAuthority"];
    createdAt: number | null;
    curveProgressPct: number | null;
    graduated: boolean | null;
  };

  crowd: {
    holdersAnalyzed: number;
    topHolders: HolderView[];
    clusters: Cluster[];
    creatorPct: number | null;
    bundlePct: number | null; // same-block / next-block buyers still holding
    clusteredPct: number | null;
    infrastructurePct: number | null; // curve, pools, burn
    top10Pct: number | null; // top 10 non-infrastructure holders
  };

  market: MarketFacts | null;

  findings: Finding[];
  coverage: Coverage;
  /** Always shown with the sticker. */
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// 3. Interfaces between layers
// ---------------------------------------------------------------------------

/** Minimal JSON-RPC client the chain layer uses. Implemented by src/chain/rpc.ts and by test fakes. */
export interface RpcClient {
  call<T>(method: string, params: unknown[]): Promise<T>;
  /** Many calls in ONE HTTP request (JSON-RPC batch). Results in the same order; failed entries are Error. */
  batch<T>(calls: { method: string; params: unknown[] }[]): Promise<(T | Error)[]>;
  /** Number of HTTP requests made so far. */
  readonly requests: number;
}

/** Minimal fetch-like used for DEX Screener (so tests can fake it). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface AnalyzeOptions {
  rpc: RpcClient;
  fetch: FetchLike;
  now: () => number;
  /** Max HTTP requests to Solana for one sticker (Cloudflare caps outbound requests per visit). */
  maxRpcRequests: number;
  /** Abort collection after this many ms and return what we have. */
  deadlineMs: number;
}

/** Cloudflare bindings available to the Worker. */
export interface Env {
  ASSETS?: Fetcher;
  DB?: D1Database;
  /** Cloudflare secret: a Solana mainnet RPC URL (e.g. Helius) including its key. */
  SOLANA_RPC_URL?: string;
  MSRP_PUBLIC_URL?: string;
  SOLANAVIEW_URL?: string;
}

// ---------------------------------------------------------------------------
// 4. Rendering inputs (src/ui)
// ---------------------------------------------------------------------------

/** Passed to every page renderer. */
export interface PageContext {
  /** Absolute base URL of this site, no trailing slash. */
  publicUrl: string;
  /** Absolute base URL of SolanaView, no trailing slash. */
  solanaviewUrl: string;
}

/** One rule of the methodology. Exported by src/engines/methodology.ts so the page text always matches the code. */
export interface MethodologyRule {
  id: string;
  engine: "build" | "crowd" | "market" | "overall";
  title: string;
  /** What exactly is measured / the exact threshold, plain language. */
  rule: string;
  /** Why it matters to a buyer. */
  why: string;
  /** What it cannot tell you. */
  limits: string;
}

/** Row for "recently checked" lists and the sitemap. */
export interface RecentSticker {
  mint: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  overallStars: Stars;
  independentPct: number | null;
  computedAt: number;
}
