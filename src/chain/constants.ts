/**
 * Chain-reader constants that are facts about Solana programs (not tunable limits).
 * Tunable limits live in src/config.ts (LIMITS / THRESHOLDS).
 */

/** pump.fun bonding-curve account tag (first 8 bytes). */
export const PUMP_CURVE_DISCRIMINATOR = Uint8Array.of(23, 183, 248, 55, 96, 216, 172, 96);

/** pump.fun starts every curve with this many raw token units for sale (793.1M tokens x 10^6). */
export const PUMP_INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n;

/** Metaplex token-metadata program (legacy SPL-token coins keep their name here). */
export const METAPLEX_METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Quote / stable coins that are never "the coin" in a swap. */
export const QUOTE_MINTS: ReadonlySet<string> = new Set([
  WSOL_MINT,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

/**
 * Pool authorities that own DEX vaults (verified with findProgramAddress):
 * Raydium AMM v4 ("amm authority") and Raydium CPMM ("vault_and_lp_mint_auth_seed").
 */
export const KNOWN_POOL_AUTHORITIES: ReadonlySet<string> = new Set([
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL",
]);

/** Jito tip accounts: SOL sent here is a priority tip, never "funding" a wallet. */
export const JITO_TIP_ACCOUNTS: ReadonlySet<string> = new Set([
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
]);

/**
 * Highest transaction version we ask the RPC for. Mainnet carries version-1 transactions
 * (seen Nov 2026: asking for 0 makes the node refuse them with error -32015).
 */
export const MAX_TX_VERSION = 1;

/** Options for getTransaction everywhere in the chain reader. */
export const TX_OPTIONS = { encoding: "jsonParsed", maxSupportedTransactionVersion: MAX_TX_VERSION, commitment: "confirmed" } as const;

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Associated token account program (holds each wallet's default token account). */
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/**
 * pump.fun "mayhem" program. Every CreateV2 launch references the PDA ["mayhem-state", mint]
 * of this program; for normal coins nothing else ever touches it, so its first signature is the
 * coin's creation (verified Nov 2026: exactly one signature, the CreateV2 transaction).
 */
export const PUMP_MAYHEM_PROGRAM = "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e";

/** DEX / AMM programs besides the ones in config PROGRAMS: accounts they own are pools. */
export const EXTRA_AMM_PROGRAMS: ReadonlySet<string> = new Set([
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca Whirlpool
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", // Meteora pools (DAMM v1)
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", // Meteora DAMM v2
]);

/** Anchor event-CPI instruction tag (first 8 bytes of a self-CPI event instruction). */
export const ANCHOR_EVENT_IX_TAG = Uint8Array.of(0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d);

/**
 * Collection knobs that are not in config LIMITS (yet). Kept here so collect.ts has no magic numbers.
 */
export const COLLECT = {
  /** Signatures per page when paging a coin's own history (the RPC maximum). */
  MINT_SIGNATURE_PAGE: 1000,
  /** Pages of a coin's history we read at most when looking for its creation. */
  MAX_MINT_PAGES: 4,
  /** Signatures read for the per-coin "creation marker" accounts (metadata / mayhem-state PDAs). */
  CREATION_MARKER_SIGNATURES: 20,
  /** Signatures read for the deployer's own token account of this coin (its buys/sells of it). */
  DEPLOYER_TOKEN_ACCOUNT_SIGNATURES: 50,
  /** Deployer transactions right after the creation we always read (to catch a fast dev sell). */
  DEV_SELL_LOOKAHEAD_TX: 6,
  /** Signatures read for a graduated coin's bonding curve (its whole trading life on the curve, usually). */
  CURVE_SIGNATURES: 1000,
  /**
   * To reach a busy coin's first block we read its history backwards from a transaction we already
   * know; that transaction must be at most this many slots (~400 ms each, so ~5 minutes) after the
   * creation, so the stretch in between usually fits in one page of signatures.
   */
  FIRST_BLOCK_ANCHOR_SLOTS: 750,
  /** Max transactions read to confirm same-block / next-block buys. */
  EARLY_BUY_TX_CAP: 40,
  /** SOL below this is a tip or fee, not "funding" a sibling wallet. */
  MIN_SIBLING_FUNDING_SOL: 0.01,
  /**
   * A wallet's first SOL must keep it rent-exempt (890,880 lamports for a plain wallet), so a smaller
   * move (e.g. 1-lamport "address poisoning" dust) is never the funding we are looking for.
   */
  MIN_FUNDING_LAMPORTS: 890_880,
  /** Don't start another round of requests with less time than this left. */
  MIN_ROUND_MS: 750,
} as const;
