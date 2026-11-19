/**
 * Engine-only rules that are not (yet) in src/config.ts.
 *
 * The shared thresholds (fresh deployer, fast dev sell, bundle slots, concentration, ...) live in
 * src/config.ts and are imported from there. The numbers below are the extra cut-offs the engines
 * need to turn facts into stars. They sit here, in one place, so src/engines/methodology.ts can
 * print them and the methodology page always matches the code.
 *
 * Integrator note: these can move into src/config.ts (e.g. as THRESHOLDS / RATINGS) without any
 * behaviour change; only the import line in each engine would change.
 */
export const ENGINE_RULES = {
  // --- Crowd X-ray: linking wallets ---------------------------------------------------------

  /**
   * "Similar funding" only links two wallets whose first SOL arrived within this many minutes of
   * each other. Round amounts (1 SOL, 0.5 SOL) are common, so without a tight time window two
   * strangers would be linked. This is the "same funding hour" rule.
   */
  SIMILAR_FUNDING_WINDOW_MIN: 60,
  /**
   * ...and only when both wallets got their first SOL within this many hours of the coin's
   * creation (a wallet born for this launch). Older wallets are never linked by amount alone.
   */
  FRESH_WALLET_WINDOW_HOURS: 24,
  /**
   * "Funded by the same wallet" only links two holders whose first SOL arrived within this many hours
   * of each other. Seen live: two strangers who withdrew from the same exchange 100 days apart were
   * linked. A wallet preparing buyers for a launch funds them within hours, not months.
   */
  SHARED_FUNDER_WINDOW_HOURS: 6,

  // --- Crowd X-ray: stars --------------------------------------------------------------------

  /**
   * Crowd stars from the share of circulating supply held by insiders (0-100).
   * First tier whose `below` is above the insider share wins; otherwise 1 star.
   */
  INSIDER_STAR_TIERS: [
    { below: 5, stars: 5 },
    { below: 15, stars: 4 },
    { below: 30, stars: 3 },
    { below: 50, stars: 2 },
  ] as const,
  /** Insider share (of circulating supply) at or above this is a "danger" finding. */
  INSIDER_DANGER_PCT: 50,
  /** ...at or above this is a "warning" finding. */
  INSIDER_WARNING_PCT: 30,
  /** ...at or above this is a "caution" finding. */
  INSIDER_CAUTION_PCT: 15,
  /** One wallet above THRESHOLDS.WALLET_CONCENTRATION_PCT caps the crowd rating at this. */
  CONCENTRATION_MAX_STARS: 3,
  /**
   * One ordinary wallet holding more than this % of TOTAL supply is never counted as independent,
   * even when no link to the creator was found: that much in one place is a team, treasury,
   * exchange or unrecognised pool far more often than an outside buyer, and we cannot tell which.
   * It is labelled unknown (so the sticker price never rests on it). Seen live: a coin whose
   * sticker price was 68% made of one wallet that collected the project's fees.
   */
  DOMINANT_WALLET_PCT: 20,
  /**
   * When untraceable wallets hold more than this fraction of the supply we checked, the crowd
   * section can only be rated low (1-2 stars, from insiders we did find), never high.
   */
  UNKNOWN_MAX_SHARE: 0.5,
  /**
   * When the creator bought a large bag at launch and it left without a sell or a transfer we could
   * see, the crowd rating is capped at this: the bag may sit in wallets we could not link.
   */
  CREATOR_BAG_MAX_STARS: 3,
  /** When more than this % of circulating supply sits outside the top holders (unchecked)... */
  TAIL_CAP_PCT: 50,
  /** ...the crowd rating is capped at this many stars. */
  TAIL_MAX_STARS: 4,

  // --- Build sheet -----------------------------------------------------------------------------

  /** SOL sent back to the funder below this is treated as dust and ignored. */
  SWEEP_MIN_SOL: 0.01,
  /**
   * A launch-factory pattern becomes a "danger" finding when at least this fraction of the
   * family's launches had a dev sell within THRESHOLDS.FAST_DEV_SELL_MIN.
   */
  FAST_SELL_DANGER_SHARE: 0.5,
  /** Without a full trace of the deployer, the build rating is capped at this (and needs a sign). */
  PARTIAL_TRACE_MAX_STARS: 3,

  // --- Market ----------------------------------------------------------------------------------

  /**
   * Market stars from liquidity as a % of market cap.
   * First tier whose `atLeast` is met wins; otherwise 1 star.
   */
  LIQUIDITY_STAR_TIERS: [
    { atLeast: 10, stars: 5 },
    { atLeast: 5, stars: 4 },
    { atLeast: 2, stars: 3 },
    { atLeast: 1, stars: 2 },
  ] as const,
  /** Liquidity below this % of market cap is a "low liquidity" warning. */
  LOW_LIQUIDITY_PCT: 2,
  /**
   * Liquidity at or above this % of market cap is an anomaly, not a sign of a deep market: a pool
   * holds both sides, so it only exceeds the market cap when most of the supply has been sold back
   * into the pool (typically right after a crash). Seen live on a coin worth $1,420 with $308K of
   * 24-hour volume. Such a market is capped at LIQUIDITY_ANOMALY_MAX_STARS.
   */
  LIQUIDITY_ANOMALY_PCT: 100,
  LIQUIDITY_ANOMALY_MAX_STARS: 3,

  // --- Overall ---------------------------------------------------------------------------------

  /** Any "danger" finding caps the overall rating at this many stars. */
  DANGER_MAX_STARS: 2,

  // --- Output size -----------------------------------------------------------------------------

  /** Max wallet addresses listed as evidence on one finding. */
  MAX_EVIDENCE: 25,
  /** Max per-cluster findings (largest clusters first). */
  MAX_CLUSTER_FINDINGS: 5,
  /** Top holders counted for the "top 10" concentration figure. */
  TOP_N_CONCENTRATION: 10,
} as const;
