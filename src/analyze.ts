import type { AnalyzeOptions, Sticker } from "./types";

/**
 * Full pipeline: read facts from the chain (src/chain/collect.ts), then build the sticker
 * (src/engines/sticker.ts). PLACEHOLDER until the integration step wires it up.
 */
export async function analyze(_mint: string, _opts: AnalyzeOptions): Promise<Sticker> {
  throw new Error("analyze() is not wired up yet");
}
