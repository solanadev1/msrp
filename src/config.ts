/**
 * Every limit and threshold MSRP uses, in one place, with the reason for each.
 * Change numbers here, not inside the modules.
 */

export const PROGRAMS = {
  PUMP: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  PUMP_AMM: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  /** pump.fun's migration signer (every graduation is signed by it). */
  PUMP_MIGRATION_WALLET: "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg",
  RAYDIUM_V4: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  RAYDIUM_CPMM: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  METEORA_DLMM: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  SYSTEM: "11111111111111111111111111111111",
  TOKEN: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  TOKEN_2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  INCINERATOR: "1nc1nerator11111111111111111111111111111111",
} as const;

export const LIMITS = {
  /**
   * Max HTTP requests to Solana per sticker. Cloudflare's Free plan allows 50
   * outbound requests per visit; we keep 10 spare for DEX Screener, storage and retries.
   * Batching lets one request carry many Solana calls.
   */
  MAX_RPC_REQUESTS: 36,
  /** Max Solana calls packed into one batched HTTP request. */
  MAX_BATCH: 40,
  /** Give up gathering after this long and show what we have. */
  DEADLINE_MS: 20_000,
  /** Largest token accounts Solana returns (fixed by the network at 20). */
  TOP_HOLDERS: 20,
  /** Signatures read per wallet when tracing where its SOL came from. */
  ORIGIN_SIGNATURES: 1000,
  /** A wallet with this many signatures or more is "veteran": not traced. */
  VETERAN_SIGNATURES: 1000,
  /** Funder transactions read when looking for sibling wallets. */
  FUNDER_TX_SAMPLE: 40,
  /** Max sibling wallets examined. */
  MAX_SIBLINGS: 12,
  /** Recent signatures read per deployer/sibling when looking for launches. */
  LAUNCH_SIGNATURE_SAMPLE: 60,
  /** Max transactions fetched per wallet when looking for launches and sells. */
  LAUNCH_TX_SAMPLE: 25,
  /**
   * Holder-list fallback (only when the provider refuses getTokenLargestAccounts, like the public RPC):
   * we read every token account of the coin, owner + amount only. A Worker has 128 MB of memory and
   * little CPU, so we stop if the coin has more token accounts than this and say holders are unknown.
   * pump.fun curve coins usually have a few hundred; 3,000 covers almost every young coin.
   */
  HOLDER_SCAN_MAX_ACCOUNTS: 3_000,
  /**
   * Largest answer (bytes) we accept for that fallback. Each account is about 290 bytes of JSON,
   * so 1 MB is a little over HOLDER_SCAN_MAX_ACCOUNTS. Bigger answers are cut off while downloading.
   */
  HOLDER_SCAN_MAX_BYTES: 1_000_000,
  /**
   * Largest answer (bytes) we accept for any one Solana request. A full batch of 40 signature lists
   * is about 7 MB; this only stops a runaway answer from exhausting the Worker's 128 MB of memory.
   */
  MAX_RESPONSE_BYTES: 16_000_000,
} as const;

export const THRESHOLDS = {
  /** A dev sell within this many minutes of launch counts as a "fast dev sell" (dev.x's auto-recycle waits 30). */
  FAST_DEV_SELL_MIN: 30,
  /** Deployer funded this soon before launch = "fresh deployer" (dev.x funds right before launch). */
  FRESH_DEPLOYER_MIN: 60,
  /** Funding amounts within this fraction of each other are "similar" (trade.x uses 10%). */
  SIMILAR_FUNDING_FRACTION: 0.1,
  /** Buys within this many slots of creation are "same-block" bundle buys (trade.x: creation slot or +1). */
  BUNDLE_SLOTS: 1,
  /** One wallet above this % of supply is a concentration warning (trade.x: 4.5%). */
  WALLET_CONCENTRATION_PCT: 4.5,
  /** Bundle share above this % is a warning (trade.x: 15%). */
  BUNDLE_WARNING_PCT: 15,
  /** Creator holding above this % is noted (trade.x: 3.5%). */
  CREATOR_NOTE_PCT: 3.5,
  /** Family launch counts at or above this are a "launch factory" pattern. */
  FACTORY_LAUNCHES: 5,
} as const;

export const CACHE = {
  /** Fresh stickers are reused for this long before re-checking the chain. */
  STICKER_TTL_SEC: 10 * 60,
  /** Badges/images can be cached by browsers and other sites a bit longer. */
  BADGE_TTL_SEC: 30 * 60,
  /**
   * A badge older than this shows "tap to check" instead of its old rating: a badge embedded on
   * another site must never keep showing a reading from weeks ago (the date isn't visible on it).
   */
  BADGE_MAX_AGE_SEC: 24 * 60 * 60,
} as const;

export const RATE_LIMITS = {
  /** New (uncached) stickers one visitor can request per hour. Cached ones are free. */
  NEW_STICKERS_PER_IP_PER_HOUR: 20,
  /** New stickers site-wide per day (protects the RPC allowance). Needs the D1 database to be site-wide. */
  NEW_STICKERS_PER_DAY: 2_000,
  /**
   * Without the D1 database each Worker instance can only count its own stickers, and Cloudflare runs
   * many instances, so each one gets this much smaller share of the daily limit instead.
   */
  NEW_STICKERS_PER_DAY_PER_INSTANCE_WITHOUT_DB: 200,
} as const;

export const DISCLAIMER =
  "MSRP measures who made a coin and who holds it, using public blockchain data. It is not financial advice, " +
  "not a prediction of price, and not a guarantee of safety. Links between wallets are patterns, not proof of " +
  "who controls them. Anything we could not check is shown as unknown.";
