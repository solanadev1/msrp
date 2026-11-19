/**
 * METHODOLOGY: every rule the engines apply, in plain language, with the numbers templated from
 * src/config.ts and src/engines/rules.ts so the published text always matches the code.
 */
import type { MethodologyRule } from "../types";
import { LIMITS, THRESHOLDS } from "../config";
import { ENGINE_RULES } from "./rules";

const R = ENGINE_RULES;
const T = THRESHOLDS;
const L = LIMITS;

const pct = (n: number) => `${n}%`;
const fraction = (f: number) => `${Math.round(f * 100)}%`;
const bundleSlots: number = T.BUNDLE_SLOTS;
const blocks =
  bundleSlots === 0
    ? "in the creation block"
    : `in the creation block or the next ${bundleSlots === 1 ? "block" : `${bundleSlots} blocks`}`;

const insiderTiers = R.INSIDER_STAR_TIERS.map((t) => `under ${pct(t.below)} = ${t.stars}`).join(", ");
const liquidityTiers = R.LIQUIDITY_STAR_TIERS.map((t) => `${pct(t.atLeast)}+ = ${t.stars}`).join(", ");

export const METHODOLOGY: MethodologyRule[] = [
  // ------------------------------------------------------------------ build
  {
    id: "build.deployer-trace",
    engine: "build",
    title: "Where the deployer's SOL came from",
    rule:
      `We read up to ${L.ORIGIN_SIGNATURES} transactions of the wallet that created the coin to find the wallet that ` +
      `sent its first SOL (the funder). Wallets with ${L.VETERAN_SIGNATURES} or more transactions are "long-history" ` +
      "wallets and are not traced.",
    why: "Launch operations pay a fresh wallet from a master wallet right before each launch; the funder reveals it.",
    limits:
      "A funder can be an exchange or a payment service used by many unrelated people. If the first funding is " +
      "beyond what we read, the funder is shown as unknown.",
  },
  {
    id: "build.fresh-deployer",
    engine: "build",
    title: "Fresh deployer",
    rule: `The deployer counts as fresh when its first SOL arrived ${T.FRESH_DEPLOYER_MIN} minutes or less before the coin was created.`,
    why: "Automated launch operations fund a brand-new wallet just before each launch.",
    limits: "Plenty of people also create a new wallet for a launch; on its own this is a weak sign.",
  },
  {
    id: "build.family",
    engine: "build",
    title: "The deployer's family",
    rule:
      `We read up to ${L.FUNDER_TX_SAMPLE} transactions of the funder and check up to ${L.MAX_SIBLINGS} other wallets ` +
      "it sent SOL to (siblings). The deployer plus its siblings is the family. When the funder is a long-history " +
      "wallet, its other wallets are not treated as family.",
    why: "Launch operations rotate through many child wallets paid by one master wallet.",
    limits: "We see a sample of the funder's activity, so the real family can be larger.",
  },
  {
    id: "build.factory-pattern",
    engine: "build",
    title: "Launch-factory pattern",
    rule:
      `When the family launched ${T.FACTORY_LAUNCHES} or more coins (this one included) we report a pattern ` +
      "consistent with an automated launch operation; it is marked danger when at least " +
      `${fraction(R.FAST_SELL_DANGER_SHARE)} of those launches had a dev sell within ${T.FAST_DEV_SELL_MIN} minutes.`,
    why: "A single funding source launching coin after coin, and selling quickly, is how launch factories work.",
    limits: `We read up to ${L.LAUNCH_SIGNATURE_SAMPLE} recent transactions per family wallet, so older launches can be missed.`,
  },
  {
    id: "build.fast-dev-sell",
    engine: "build",
    title: "Fast dev sell",
    rule: `A launch has a fast dev sell when its deployer first sold it ${T.FAST_DEV_SELL_MIN} minutes or less after creation.`,
    why: "Launch operations sell (recycle) coins that no one else bought after about half an hour.",
    limits: "Sells outside the transactions we sampled are not counted, so the real number can be higher.",
  },
  {
    id: "build.sweep",
    engine: "build",
    title: "SOL sent back to the funder",
    rule: `We add up SOL the deployer and its siblings sent back to their funder; less than ${R.SWEEP_MIN_SOL} SOL is ignored as dust.`,
    why: "Launch operations sweep proceeds from child wallets back into the master wallet.",
    limits: "Only transfers inside the transactions we sampled are counted.",
  },
  {
    id: "build.authorities",
    engine: "build",
    title: "Mint and freeze authority",
    rule:
      "We read the coin's mint authority (can create more coins) and freeze authority (can freeze holders' coins); " +
      "either one still active is a danger finding.",
    why: "An active mint authority can dilute every holder; an active freeze authority can stop holders from moving coins.",
    limits: "Renounced authorities say nothing about who holds the coin.",
  },
  {
    id: "build.stars",
    engine: "build",
    title: "Build stars",
    rule:
      "Start at 5 stars and lose one for each sign (fresh deployer, launch-factory pattern, any fast dev sell, SOL " +
      "sent back to the funder, active mint or freeze authority), never below 1; without a full trace of the " +
      `deployer the rating is capped at ${R.PARTIAL_TRACE_MAX_STARS} and needs at least one sign, otherwise it is not rated.`,
    why: "Each sign is one step of the launch-factory playbook; more steps seen means less independent ownership.",
    limits: "No signs means none were seen in our sample, not that none exist.",
  },
  // ------------------------------------------------------------------ crowd
  {
    id: "crowd.top-holders",
    engine: "crowd",
    title: "Which holders we check",
    rule:
      `We check the top ${L.TOP_HOLDERS} token accounts Solana reports (merged by owner). The bonding curve, ` +
      "trading pools, the burn address and program-owned accounts are infrastructure, not people, and are left " +
      "out; what remains is the circulating supply.",
    why: "Large holders decide whether a price can hold; infrastructure accounts are not people.",
    limits: `Solana returns only the largest ${L.TOP_HOLDERS} accounts; smaller holders are not examined one by one.`,
  },
  {
    id: "crowd.long-tail",
    engine: "crowd",
    title: "Holders outside the top list",
    rule:
      `Supply held outside the top ${L.TOP_HOLDERS} holders is counted as neither insider nor independent: it stays ` +
      "unchecked, so the independent share is a floor, not an estimate.",
    why: "Counting unchecked wallets as independent would hide insiders who split their coins across many small wallets.",
    limits: "A widely held coin shows a smaller independent share than it may really have.",
  },
  {
    id: "crowd.shared-funder",
    engine: "crowd",
    title: "Funded by the same wallet",
    rule:
      "Two holders are linked when their first SOL came from the same wallet, when one holder funded the other, or " +
      "when the build trace shows the deployer's funder funded them; funders that are long-history wallets are " +
      "never used as a link.",
    why: "One person controlling many wallets usually pays them all from one place.",
    limits: "A shared funder is a pattern, not proof of control; exchanges we cannot recognise may still link strangers.",
  },
  {
    id: "crowd.creator-funded",
    engine: "crowd",
    title: "Funded by the creator",
    rule: "A holder whose first SOL came from the deployer wallet is linked to the creator.",
    why: "Wallets paid by the creator are likely under the creator's influence.",
    limits: "We only see the first funding, not later transfers.",
  },
  {
    id: "crowd.similar-funding",
    engine: "crowd",
    title: "Similar funding at the same time",
    rule:
      "Two holders are linked when both are brand-new wallets (we saw their full history) that got their first SOL " +
      `within ${R.SIMILAR_FUNDING_WINDOW_MIN} minutes of each other and within ${R.FRESH_WALLET_WINDOW_HOURS} hours of ` +
      `the coin's creation, in amounts within ${fraction(T.SIMILAR_FUNDING_FRACTION)} of each other.`,
    why: "Scripts that prepare many buying wallets fund them with near-identical amounts in one go.",
    limits: "Round amounts are common, which is why this rule only applies to brand-new wallets funded close together.",
  },
  {
    id: "crowd.same-block",
    engine: "crowd",
    title: "Same-block buyers",
    rule:
      `Wallets other than the creator that bought ${blocks} are early insiders, and those still among the top ` +
      `holders are linked together; their share above ${pct(T.BUNDLE_WARNING_PCT)} of supply is a warning.`,
    why: "Buying at the very moment of creation usually means the purchase was bundled with the launch.",
    limits: "Fast trading bots can also buy in the first blocks; we count them as insiders because no ordinary buyer could.",
  },
  {
    id: "crowd.labels",
    engine: "crowd",
    title: "Insider, independent, unknown",
    rule:
      "A holder is an insider when it is the creator, part of a linked group, a same-block buyer or in the " +
      "deployer's family; otherwise it is independent when we traced its funding (or it is a long-history wallet), " +
      "and unknown when we could not.",
    why: "Separating who is linked from who is not is the point of the X-ray.",
    limits: "Independent means no link was found in what we read, not that the owner is a stranger to the creator.",
  },
  {
    id: "crowd.shares",
    engine: "crowd",
    title: "How shares are measured",
    rule:
      "Creator, same-block, linked, infrastructure and top-10 figures are shares of total supply; insider and " +
      "independent figures are shares of circulating supply, and are shown only when wallets we could not trace " +
      `hold no more than ${fraction(R.UNKNOWN_MAX_SHARE)} of the supply we checked.`,
    why: "Shares of circulating supply show who holds the coins that can actually trade.",
    limits: "Balances are a snapshot from when the sticker was made.",
  },
  {
    id: "crowd.insiders",
    engine: "crowd",
    title: "Insider share",
    rule:
      `Insiders holding ${pct(R.INSIDER_DANGER_PCT)} or more of circulating supply is a danger finding, ` +
      `${pct(R.INSIDER_WARNING_PCT)} or more a warning and ${pct(R.INSIDER_CAUTION_PCT)} or more a caution.`,
    why: "When linked wallets hold most of the tradable coins, they can set the price.",
    limits: "Insiders outside the top holders, or linked in ways public data does not show, are not counted.",
  },
  {
    id: "crowd.concentration",
    engine: "crowd",
    title: "Single-wallet concentration",
    rule: `Any single wallet with more than ${pct(T.WALLET_CONCENTRATION_PCT)} of supply is flagged; the creator holding more than ${pct(T.CREATOR_NOTE_PCT)} is noted.`,
    why: "One large holder can move the price by itself.",
    limits: "An exchange or a pool we did not recognise can look like a large wallet.",
  },
  {
    id: "crowd.stars",
    engine: "crowd",
    title: "Crowd stars",
    rule:
      `Stars come from the insider share of circulating supply (${insiderTiers}, otherwise 1), capped at ` +
      `${R.CONCENTRATION_MAX_STARS} when one wallet holds more than ${pct(T.WALLET_CONCENTRATION_PCT)} of supply and at ` +
      `${R.TAIL_MAX_STARS} when more than ${pct(R.TAIL_CAP_PCT)} of circulating supply is outside the top ` +
      `${L.TOP_HOLDERS}; when untraced wallets hold more than ${fraction(R.UNKNOWN_MAX_SHARE)} of the checked supply ` +
      "only a 1-2 star result (from insiders already found) is shown, otherwise it is not rated.",
    why: "The fewer coins sit with linked wallets, the more the price reflects independent buyers.",
    limits: "Links are patterns found in public data, not proof of who controls a wallet.",
  },
  // ------------------------------------------------------------------ market
  {
    id: "market.source",
    engine: "market",
    title: "Market data",
    rule: "Price, market cap, liquidity and 24-hour volume come from DEX Screener's most liquid pair for the coin.",
    why: "It is the public reference most traders look at.",
    limits: "DEX Screener can lag or miss new pairs; missing values are shown as unknown, never as zero.",
  },
  {
    id: "market.liquidity",
    engine: "market",
    title: "Liquidity compared with market cap",
    rule: `We divide liquidity by market cap; below ${pct(R.LOW_LIQUIDITY_PCT)} is a low-liquidity warning.`,
    why: "Thin liquidity means a modest trade moves the price a lot.",
    limits: "Liquidity can be added or removed at any time.",
  },
  {
    id: "market.stars",
    engine: "market",
    title: "Market stars",
    rule:
      `Stars come from liquidity as a share of market cap (${liquidityTiers}, otherwise 1), minus one star when ` +
      "DEX Screener reports zero volume for the last 24 hours; not rated without market cap or liquidity.",
    why: "A market with real liquidity and trading lets holders enter and exit near the quoted price.",
    limits: "Volume can include trades between linked wallets.",
  },
  // ------------------------------------------------------------------ overall
  {
    id: "overall.stars",
    engine: "overall",
    title: "Overall stars",
    rule:
      "Overall is the lowest of the build, crowd and market stars (market is skipped when not rated), capped at " +
      `${R.DANGER_MAX_STARS} by any danger finding; it is not rated when build or crowd is not rated, unless a ` +
      "danger finding already caps it.",
    why: "Ownership is only as transparent as its weakest part.",
    limits: "Stars describe how transparent the launch and ownership are, not where the price will go.",
  },
  {
    id: "overall.sticker-price",
    engine: "overall",
    title: "Sticker price",
    rule:
      "Sticker price = market cap x the share of total supply held by top holders we traced and found no link for; " +
      "it is not shown when either number is unknown.",
    why: "It shows how much of the market cap sits with wallets that look independent of the creator.",
    limits:
      `Coins held outside the top ${L.TOP_HOLDERS} holders are not counted, so it is a floor. It is not a fair ` +
      "value, a target or a forecast.",
  },
];
