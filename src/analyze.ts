import { collectFacts } from "./chain/collect";
import { buildSticker } from "./engines/sticker";
import type { AnalyzeOptions, Sticker } from "./types";

/**
 * Full pipeline for one coin: read the facts from Solana and DEX Screener (src/chain, read-only,
 * inside the request budget and deadline in `opts`), then turn them into a sticker (src/engines,
 * pure). Throws only the chain reader's errors (InvalidMintError, NotFoundError,
 * ChainUnavailableError); src/web turns those into plain-language pages.
 */
export async function analyze(mint: string, opts: AnalyzeOptions): Promise<Sticker> {
  return buildSticker(await collectFacts(mint, opts));
}
