/** Public surface of the engines: facts in, sticker out. Pure functions, no network, no clock. */
export { buildSticker, stickerPrice } from "./sticker";
export { METHODOLOGY } from "./methodology";
export { sampleSticker, exampleFacts, EXAMPLE_MINT, EXAMPLE_NOTE } from "./sample";
export { analyzeCrowd, crowdInputFromFacts, isInfrastructure, INFRASTRUCTURE_KINDS } from "./crowd";
export type { CrowdAnalysis, CrowdInput, CrowdEvidence } from "./crowd";
export { analyzeBuild } from "./build";
export type { BuildAnalysis, BuildSigns } from "./build";
export { analyzeMarket, sanitizeMarket } from "./market";
export type { MarketAnalysis } from "./market";
export { rateBuild, rateCrowd, rateMarket, rateOverall, starsFromInsiderPct, starsFromLiquidityPct, starsFromSigns } from "./ratings";
export { buildFindings, crowdFindings, marketFindings, collectFindings, sortFindings } from "./findings";
export { ENGINE_RULES } from "./rules";
