/**
 * BUILD SHEET: who made the coin.
 *
 * A launch factory works like this (public knowledge of the playbook): a master wallet funds a
 * fresh child deployer just before launch, the launch creates the coin and makes the dev buy in one
 * transaction, the child is rotated after a few launches, unsold bags are sold ("recycled") around
 * 30 minutes later when no outside buyers show up, and SOL is swept back to the master.
 *
 * This engine reverses that from the facts the chain layer gathered: how long before launch the
 * deployer got its first SOL, which other wallets the same funder paid ("family"), how many coins
 * the family launched, how fast the deployer sold, and how much SOL went back to the funder.
 *
 * Each pattern is a "sign". Signs feed ratings.ts (stars) and findings.ts (plain-language text).
 */
import type { CoinFacts, FactoryFacts, FamilyMember, LaunchFact, SiblingFact, Sticker } from "../types";
import { THRESHOLDS } from "../config";
import { ENGINE_RULES } from "./rules";
import { cmpStr, finite, nonNegative, round, sum } from "./format";

export interface BuildSigns {
  /** Deployer got its first SOL within THRESHOLDS.FRESH_DEPLOYER_MIN before launch. */
  freshDeployer: boolean;
  /** Deployer + family launched at least THRESHOLDS.FACTORY_LAUNCHES coins. */
  factoryFamily: boolean;
  /** At least one family launch had a dev sell within THRESHOLDS.FAST_DEV_SELL_MIN. */
  fastDevSell: boolean;
  /** At least ENGINE_RULES.SWEEP_MIN_SOL went back to the funder. */
  sweep: boolean;
  /** Mint or freeze authority is still held by someone. */
  authorityActive: boolean;
}

export interface BuildAnalysis {
  section: Sticker["build"];
  deployerKnown: boolean;
  /** The chain layer ran the factory trace. */
  traced: boolean;
  /**
   * Every step of that trace finished (creation found; deployer, funder and related-wallet reads all
   * came back). Without it, signs we did not see may simply not have been read: no good-news findings.
   */
  traceComplete: boolean;
  /** We know where the deployer's SOL came from (or that it is a long-history wallet). */
  originKnown: boolean;
  /** Deployer signatures the trace read (null = no trace). */
  deployerSignaturesSampled: number | null;
  deployerVeteran: boolean;
  /** The funder is a long-history wallet (could be an exchange); its other wallets are not family. */
  funderIsVeteran: boolean;
  /** Sibling wallets left out because the funder is a long-history wallet. */
  siblingsIgnored: number;
  /** The current coin's own launch record, if the deployer's sample included it. */
  currentLaunch: LaunchFact | null;
  /** Minutes from launch to the deployer's first sell of THIS coin, if seen. */
  currentDevSellMin: number | null;
  signs: BuildSigns;
  signCount: number;
  /** Distinct mints launched by the family with a dev sell within the fast window. */
  fastSellMints: string[];
  /** Distinct mints launched by the family (current coin included). */
  familyMints: string[];
  /** Wallets that sent SOL back to the funder. */
  sweepWallets: string[];
}

/** Minutes from creation to the dev's first sell, when it is a usable number. */
function sellMinutes(l: LaunchFact): number | null {
  const m = nonNegative(l.firstDevSellAfterMin);
  return m === null ? null : m;
}

function isFastSell(l: LaunchFact): boolean {
  const m = sellMinutes(l);
  return m !== null && m <= THRESHOLDS.FAST_DEV_SELL_MIN;
}

/** Usable launches in a fixed order (mint, then signature) so results never depend on input order. */
function validLaunches(launches: readonly LaunchFact[] | undefined): LaunchFact[] {
  return (launches ?? [])
    .filter((l) => !!l && typeof l.mint === "string" && l.mint.length > 0)
    .sort((a, b) => cmpStr(a.mint, b.mint) || cmpStr(String(a.signature), String(b.signature)));
}

/** Count distinct mints and distinct fast-sell mints in a set of launches. */
function launchStats(launches: readonly LaunchFact[]): { mints: Set<string>; fast: Set<string> } {
  const mints = new Set<string>();
  const fast = new Set<string>();
  for (const l of launches) {
    mints.add(l.mint);
    if (isFastSell(l)) fast.add(l.mint);
  }
  return { mints, fast };
}

export function analyzeBuild(coin: CoinFacts, factory: FactoryFacts | null): BuildAnalysis {
  const deployer = coin.creator ?? factory?.deployer ?? null;
  const deployerKnown = deployer !== null && deployer.length > 0;
  const origin = factory?.deployerOrigin ?? null;
  const funder = factory ? (factory.funder ?? origin?.funder ?? null) : null;
  const funderIsVeteran = factory?.funderIsVeteran === true;
  const createdAt = finite(coin.createdAt);

  // --- deployer funding time ---
  let fundedBeforeMin: number | null = null;
  const fundedAt = finite(origin?.fundedAt);
  if (createdAt !== null && fundedAt !== null && createdAt >= fundedAt) {
    fundedBeforeMin = round((createdAt - fundedAt) / 60_000, 1);
  }

  // --- family: deployer + siblings (unless the funder is a long-history wallet) ---
  const seenSiblings = new Set<string>();
  const allSiblings: SiblingFact[] = [];
  for (const s of factory?.siblings ?? []) {
    if (!s || !s.wallet || s.wallet === deployer || s.wallet === funder || seenSiblings.has(s.wallet)) continue;
    seenSiblings.add(s.wallet);
    allSiblings.push(s);
  }
  allSiblings.sort((a, b) => cmpStr(a.wallet, b.wallet));
  const siblings = funderIsVeteran ? [] : allSiblings;

  const deployerLaunches = validLaunches(factory?.deployerLaunches);
  const deployerStats = launchStats(deployerLaunches);
  if (deployerKnown && coin.mint) deployerStats.mints.add(coin.mint);

  const siblingStats = siblings.map((s) => ({ s, stats: launchStats(validLaunches(s.launches)) }));
  const familyMints = new Set(deployerStats.mints);
  const fastMints = new Set(deployerStats.fast);
  for (const { stats } of siblingStats) {
    for (const m of stats.mints) familyMints.add(m);
    for (const m of stats.fast) fastMints.add(m);
  }

  // --- SOL sent back to the funder ---
  const deployerSentBack = nonNegative(factory?.deployerSentBackSol) ?? 0;
  const siblingSentBack = siblings.map((s) => nonNegative(s.sentBackSol) ?? 0);
  const sentBack = round(deployerSentBack + sum(siblingSentBack), 3);
  const sweepWallets: string[] = [];
  if (deployerKnown && deployerSentBack >= ENGINE_RULES.SWEEP_MIN_SOL) sweepWallets.push(deployer as string);
  siblings.forEach((s, i) => {
    if ((siblingSentBack[i] ?? 0) >= ENGINE_RULES.SWEEP_MIN_SOL) sweepWallets.push(s.wallet);
  });

  // --- family table ---
  const family: FamilyMember[] = [];
  if (factory && funder) {
    family.push({ wallet: funder, role: "funder", launches: 0, launchesWithFastDevSell: 0, sentBackSol: 0 });
  }
  if (deployerKnown) {
    family.push({
      wallet: deployer as string,
      role: "deployer",
      launches: deployerStats.mints.size,
      launchesWithFastDevSell: deployerStats.fast.size,
      sentBackSol: round(deployerSentBack, 3),
    });
  }
  const siblingMembers: FamilyMember[] = siblingStats.map(({ s, stats }, i) => ({
    wallet: s.wallet,
    role: "sibling",
    launches: stats.mints.size,
    launchesWithFastDevSell: stats.fast.size,
    sentBackSol: round(siblingSentBack[i] ?? 0, 3),
  }));
  siblingMembers.sort(
    (a, b) => b.launches - a.launches || b.sentBackSol - a.sentBackSol || cmpStr(a.wallet, b.wallet),
  );
  family.push(...siblingMembers);

  // --- current coin ---
  const currentLaunch = deployerLaunches.find((l) => l.mint === coin.mint) ?? null;
  const currentDevSellMin = currentLaunch ? sellMinutes(currentLaunch) : null;

  // --- signs ---
  const mint = coin.mintAuthority;
  const freeze = coin.freezeAuthority;
  const signs: BuildSigns = {
    freshDeployer: fundedBeforeMin !== null && fundedBeforeMin <= THRESHOLDS.FRESH_DEPLOYER_MIN,
    factoryFamily: familyMints.size >= THRESHOLDS.FACTORY_LAUNCHES,
    fastDevSell: fastMints.size > 0,
    sweep: sentBack >= ENGINE_RULES.SWEEP_MIN_SOL,
    authorityActive: (mint !== null && mint !== "unknown") || (freeze !== null && freeze !== "unknown"),
  };
  const signCount = Object.values(signs).filter(Boolean).length;

  const curve = coin.bondingCurve;
  const progress = finite(curve?.progressPct);

  const section: Sticker["build"] = {
    launchpad: coin.launchpad,
    deployer: deployerKnown ? deployer : null,
    funder,
    deployerFundedBeforeLaunchMin: fundedBeforeMin,
    devBuySol: nonNegative(coin.devBuySol),
    deployerLaunchCount: deployerKnown ? deployerStats.mints.size : 0,
    familySize: deployerKnown ? 1 + siblings.length : 0,
    familyLaunchCount: deployerKnown ? familyMints.size : 0,
    familyFastDevSellCount: fastMints.size,
    traced: factory !== null,
    traceComplete: factory !== null && factory.traceComplete === true,
    sentBackToFunderSol: sentBack,
    family,
    mintAuthority: mint,
    freezeAuthority: freeze,
    createdAt,
    curveProgressPct: progress === null ? null : round(Math.min(100, Math.max(0, progress)), 2),
    graduated: curve ? curve.complete === true : null,
  };

  return {
    section,
    deployerKnown,
    traced: factory !== null,
    traceComplete: factory !== null && factory.traceComplete === true,
    originKnown: !!origin && (origin.veteran || origin.historyComplete || origin.funder !== null),
    deployerSignaturesSampled: nonNegative(origin?.signaturesSampled),
    deployerVeteran: origin?.veteran === true,
    funderIsVeteran,
    siblingsIgnored: funderIsVeteran ? allSiblings.length : 0,
    currentLaunch,
    currentDevSellMin,
    signs,
    signCount,
    fastSellMints: [...fastMints].sort(cmpStr),
    familyMints: [...familyMints].sort(cmpStr),
    sweepWallets,
  };
}
