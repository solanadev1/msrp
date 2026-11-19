/**
 * FINDINGS: the plain-language lines printed on the sticker.
 *
 * Wording rules (enforced by tests): neutral and factual. Wallets are "linked" or "funded by the
 * same wallet"; repeated launches are "a pattern consistent with an automated launch operation".
 * Never a verdict about a person, never advice, never a price view.
 *
 * Ids are stable strings (e.g. "build.sweep", "crowd.bundle", "crowd.cluster.c1") so the UI,
 * badges and stored history can refer to them.
 */
import type { Finding, HolderKind, Severity } from "../types";
import { LIMITS, THRESHOLDS } from "../config";
import type { BuildAnalysis } from "./build";
import type { CrowdAnalysis } from "./crowd";
import type { MarketAnalysis } from "./market";
import { ENGINE_RULES } from "./rules";
import { cmpStr, fmtMinutes, fmtPct, fmtSol, fmtUsd, plural, shortAddr, sum, uniqueList } from "./format";

const SEVERITY_ORDER: readonly Severity[] = ["danger", "warning", "caution", "unknown", "info", "good"];
const ENGINE_ORDER: readonly Finding["engine"][] = ["build", "crowd", "market"];

function finding(
  id: string,
  engine: Finding["engine"],
  severity: Severity,
  title: string,
  detail: string,
  evidence: Iterable<string | null | undefined> = [],
): Finding {
  return { id, engine, severity, title, detail, evidence: uniqueList(evidence, ENGINE_RULES.MAX_EVIDENCE) };
}

/** Most severe first, then build / crowd / market, then id. Deterministic. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      ENGINE_ORDER.indexOf(a.engine) - ENGINE_ORDER.indexOf(b.engine) ||
      cmpStr(a.id, b.id),
  );
}

// ---------------------------------------------------------------------------------------------
// Build sheet
// ---------------------------------------------------------------------------------------------

export function buildFindings(b: BuildAnalysis): Finding[] {
  const out: Finding[] = [];
  const s = b.section;
  const deployer = s.deployer;
  const fast = THRESHOLDS.FAST_DEV_SELL_MIN;

  if (!b.deployerKnown) {
    out.push(
      finding(
        "build.deployer-unknown",
        "build",
        "unknown",
        "Deployer wallet unknown",
        "We could not identify the wallet that created this coin, so its launch history was not checked.",
      ),
    );
  } else if (!b.traced) {
    out.push(
      finding(
        "build.trace-missing",
        "build",
        "unknown",
        "Deployer history not traced",
        "We could not read the deployer wallet's history this time, so its funding, linked wallets and past launches are unknown.",
        [deployer],
      ),
    );
  } else if (!b.originKnown) {
    const read = b.deployerSignaturesSampled;
    out.push(
      finding(
        "build.origin-unknown",
        "build",
        "unknown",
        "Couldn't find where the deployer's SOL came from",
        `We read ${read !== null ? plural(read, "transaction") : "the available transactions"} of the deployer wallet ` +
          "without reaching its first funding, so its funder and the funder's other wallets are unknown.",
        [deployer],
      ),
    );
  } else if (!b.traceComplete) {
    out.push(
      finding(
        "build.trace-partial",
        "build",
        "unknown",
        "Deployer history only partly read",
        "Some reads of the deployer, its funder or related wallets did not finish in time, so signs we did not " +
          "see may still exist. Missing signs are not counted as good news.",
        [deployer],
      ),
    );
  }

  // Deployer funding time.
  const before = s.deployerFundedBeforeLaunchMin;
  if (b.signs.freshDeployer && before !== null) {
    out.push(
      finding(
        "build.fresh-deployer",
        "build",
        "caution",
        `Deployer was funded ${fmtMinutes(before)} before launch`,
        `The wallet that created this coin got its first SOL ${fmtMinutes(before)} before the launch` +
          (s.funder ? `, from ${shortAddr(s.funder)}` : "") +
          ". A brand-new wallet funded right before launch is a pattern consistent with an automated launch " +
          "operation; some people also simply use a new wallet.",
        [deployer, s.funder],
      ),
    );
  } else if (before !== null) {
    out.push(
      finding(
        "build.deployer-age",
        "build",
        "info",
        `Deployer was first funded ${fmtMinutes(before)} before launch`,
        "Time between the deployer wallet's first SOL and the creation of this coin.",
        [deployer, s.funder],
      ),
    );
  } else if (b.deployerVeteran) {
    out.push(
      finding(
        "build.deployer-veteran",
        "build",
        "info",
        "Deployer wallet has a long history",
        `The deployer wallet has ${LIMITS.VETERAN_SIGNATURES} or more transactions, so we did not trace where its ` +
          "first SOL came from.",
        [deployer],
      ),
    );
  }

  if (b.funderIsVeteran) {
    out.push(
      finding(
        "build.funder-veteran",
        "build",
        "info",
        "The deployer's funder is a long-history wallet",
        `It has ${LIMITS.VETERAN_SIGNATURES} or more transactions and may be an exchange or payment service, so ` +
          (b.siblingsIgnored > 0 ? `the ${plural(b.siblingsIgnored, "other wallet")} it funded were` : "other wallets it funded are") +
          " not treated as the deployer's family.",
        [s.funder],
      ),
    );
  }

  // Family and launches.
  const others = s.familySize - 1;
  const familyWallets = s.family.map((m) => m.wallet);
  if (b.signs.factoryFamily) {
    const fastShare = s.familyLaunchCount > 0 ? s.familyFastDevSellCount / s.familyLaunchCount : 0;
    out.push(
      finding(
        "build.factory-pattern",
        "build",
        fastShare >= ENGINE_RULES.FAST_SELL_DANGER_SHARE ? "danger" : "warning",
        others > 0
          ? `${s.familySize} linked wallets launched ${s.familyLaunchCount} coins`
          : `The deployer launched ${s.familyLaunchCount} coins`,
        (others > 0
          ? `The deployer and ${plural(others, "other wallet")} funded by the same wallet launched `
          : "The deployer wallet launched ") +
          `${s.familyLaunchCount} coins (this one included) in the transactions we sampled. Repeated launches from ` +
          "one funding source are a pattern consistent with an automated launch operation.",
        familyWallets,
      ),
    );
  } else if (b.deployerKnown && (others > 0 || s.familyLaunchCount >= 2)) {
    out.push(
      finding(
        "build.family",
        "build",
        "info",
        others > 0
          ? `The deployer's funder also funded ${plural(others, "other wallet")}`
          : `The deployer launched ${s.familyLaunchCount} coins`,
        (others > 0 ? "Together with the deployer they launched " : "It launched ") +
          `${plural(s.familyLaunchCount, "coin")} (this one included) in the transactions we sampled.`,
        familyWallets,
      ),
    );
  }

  if (b.signs.fastDevSell) {
    const k = s.familyFastDevSellCount;
    out.push(
      finding(
        "build.fast-dev-sells",
        "build",
        k >= 2 ? "warning" : "caution",
        `${k} of ${s.familyLaunchCount} launches had a dev sell within ${fast} minutes`,
        `Counted across the deployer${others > 0 ? " and its linked wallets" : ""} in the transactions we sampled; ` +
          "sells outside that sample are not counted. Selling soon after launch is a pattern consistent with an " +
          "automated launch operation that recycles coins nobody else bought.",
        b.fastSellMints,
      ),
    );
  }

  // This coin's dev sell.
  if (b.currentDevSellMin !== null) {
    out.push(
      finding(
        "build.current-dev-sell",
        "build",
        b.currentDevSellMin <= fast ? "warning" : "info",
        `The deployer first sold this coin ${fmtMinutes(b.currentDevSellMin)} after launch`,
        "The first sell by the deployer wallet that we saw in its recent transactions.",
        [deployer, b.currentLaunch?.signature],
      ),
    );
    // The launch-and-sell fingerprint on this very coin: a deployer funded right before launch that
    // sold within FAST_DEV_SELL_MIN. It is the core move of an automated launch operation, so it is a
    // danger finding (it caps the overall rating) even when the family trace could not be read.
    if (b.signs.freshDeployer && before !== null && b.currentDevSellMin <= fast) {
      out.push(
        finding(
          "build.launch-and-sell",
          "build",
          "danger",
          `Deployer funded ${fmtMinutes(before)} before launch, first sold ${fmtMinutes(b.currentDevSellMin)} after`,
          "A brand-new wallet that launches a coin and sells it within minutes is the core pattern of an " +
            `automated launch operation. It is a pattern, not proof of who controls the wallet. It caps the overall ` +
            `rating at ${ENGINE_RULES.DANGER_MAX_STARS} stars.`,
          [deployer, s.funder, b.currentLaunch?.signature],
        ),
      );
    }
  } else if (b.currentLaunch?.devSold) {
    out.push(
      finding(
        "build.current-dev-sell",
        "build",
        "info",
        "The deployer has sold some of this coin",
        "We saw a sell by the deployer wallet but could not tell when it happened.",
        [deployer, b.currentLaunch.signature],
      ),
    );
  } else if (b.currentLaunch && b.traceComplete) {
    out.push(
      finding(
        "build.no-dev-sell",
        "build",
        "info",
        "No dev sell of this coin seen",
        "In the transactions we sampled, the deployer wallet had not sold this coin. Older or later sells may exist.",
        [deployer],
      ),
    );
  }

  if (b.signs.sweep) {
    const n = b.sweepWallets.length;
    out.push(
      finding(
        "build.sweep",
        "build",
        "warning",
        `${fmtSol(s.sentBackToFunderSol)} sent back to the funder`,
        (n > 1 ? `${n} linked wallets sent` : "The deployer sent") +
          ` ${fmtSol(s.sentBackToFunderSol)} back to the wallet that funded ${n > 1 ? "them" : "it"}. Collecting SOL ` +
          "back into one wallet is a pattern consistent with an automated launch operation.",
        [...b.sweepWallets, s.funder],
      ),
    );
  }

  if (s.devBuySol !== null && s.devBuySol > 0) {
    out.push(
      finding(
        "build.dev-buy",
        "build",
        "info",
        `Dev buy at launch: ${fmtSol(s.devBuySol)}`,
        "SOL the deployer spent on its own coin inside the creation transaction. An initial dev buy is standard " +
          "on pump.fun; its size is shown for context.",
        [deployer],
      ),
    );
  }

  out.push(...authorityFindings("mint", s.mintAuthority), ...authorityFindings("freeze", s.freezeAuthority));

  if (b.traced && b.originKnown && b.traceComplete && b.signCount === 0) {
    out.push(
      finding(
        "build.no-factory-signs",
        "build",
        "good",
        "No launch-factory signs found",
        "In the deployer's traced history we saw no funding right before launch, no repeated launches, no fast " +
          "dev sells, no SOL sent back to a funder, and no active mint or freeze authority. This covers only the " +
          "transactions we sampled.",
        [deployer],
      ),
    );
  }
  return out;
}

function authorityFindings(which: "mint" | "freeze", authority: string | null | "unknown"): Finding[] {
  const id = `build.${which}-authority`;
  const Name = which === "mint" ? "Mint authority" : "Freeze authority";
  if (authority === "unknown") {
    return [finding(id, "build", "unknown", `${Name} not checked`, `We could not read the coin's ${which} authority.`)];
  }
  if (authority === null) {
    return [
      finding(
        id,
        "build",
        "good",
        `${Name} renounced`,
        which === "mint" ? "No one can create more of this coin." : "No one can freeze holders' coins.",
      ),
    ];
  }
  return [
    finding(
      id,
      "build",
      "danger",
      `${Name} is still active`,
      which === "mint"
        ? `Wallet ${shortAddr(authority)} can still create more of this coin, which would dilute every holder.`
        : `Wallet ${shortAddr(authority)} can still freeze any holder's coins so they cannot be moved.`,
      [authority],
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Crowd X-ray
// ---------------------------------------------------------------------------------------------

const INFRA_NAMES: Partial<Record<HolderKind, string>> = {
  "bonding-curve": "the bonding curve",
  pool: "trading pools",
  burn: "the burn address",
  program: "program accounts",
};

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function insiderSeverity(pct: number): Severity {
  if (pct >= ENGINE_RULES.INSIDER_DANGER_PCT) return "danger";
  if (pct >= ENGINE_RULES.INSIDER_WARNING_PCT) return "warning";
  if (pct >= ENGINE_RULES.INSIDER_CAUTION_PCT) return "caution";
  const best = ENGINE_RULES.INSIDER_STAR_TIERS[0].below;
  return pct < best ? "good" : "info";
}

export function crowdFindings(c: CrowdAnalysis): Finding[] {
  const out: Finding[] = [];
  const top = LIMITS.TOP_HOLDERS;

  if (c.holdersAnalyzed === 0) {
    out.push(
      finding(
        "crowd.no-holders",
        "crowd",
        "unknown",
        "Holder list unavailable",
        "We could not read the coin's largest holders, so who holds it is unknown.",
      ),
    );
    return out;
  }

  if (c.skippedHolders > 0) {
    out.push(
      finding(
        "crowd.unreadable",
        "crowd",
        "unknown",
        `${plural(c.skippedHolders, "holder entry", "holder entries")} could not be read`,
        "They had no readable balance, so they are left out of every share on this sticker.",
      ),
    );
  }
  if (c.scaledDown) {
    out.push(
      finding(
        "crowd.scaled",
        "crowd",
        "info",
        "Holder shares were scaled to add up to 100%",
        "The reported holder shares added up to more than 100% of supply, so each was scaled down in proportion.",
      ),
    );
  }

  // Infrastructure.
  const infra = c.topHolders.filter((v) => v.label === "infrastructure");
  if (infra.length > 0 && c.infrastructurePct !== null) {
    const names = uniqueList(
      infra.map((v) => INFRA_NAMES[v.kind]),
      4,
    );
    out.push(
      finding(
        "crowd.infrastructure",
        "crowd",
        "info",
        `${fmtPct(c.infrastructurePct)} sits in ${joinList(names)}`,
        "These accounts belong to programs, not people, so they are left out of the insider and independent shares " +
          "(which are shares of the remaining, circulating supply).",
        infra.map((v) => v.owner),
      ),
    );
  }

  if (c.walletCount === 0) {
    out.push(
      finding(
        "crowd.no-wallets",
        "crowd",
        "unknown",
        "No wallet holders found among the top accounts",
        "Every top account we read belongs to a program, so there were no wallets to check.",
      ),
    );
  }

  // Creator.
  if (c.creator !== null) {
    if (c.creatorListed && c.creatorPct !== null) {
      out.push(
        finding(
          "crowd.creator",
          "crowd",
          c.creatorPct > THRESHOLDS.CREATOR_NOTE_PCT ? "caution" : "info",
          `Creator holds ${fmtPct(c.creatorPct)}`,
          "Share of total supply in the deployer wallet right now.",
          [c.creator],
        ),
      );
    } else if (c.creatorPct === 0) {
      out.push(
        finding(
          "crowd.creator",
          "crowd",
          "info",
          "Creator holds none of the supply",
          "The deployer wallet is not in the coin's complete holder list.",
          [c.creator],
        ),
      );
    } else if (c.smallestListedPct !== null) {
      out.push(
        finding(
          "crowd.creator",
          "crowd",
          "info",
          `Creator is not among the top ${top} holders`,
          `So the deployer wallet holds less than ${fmtPct(c.smallestListedPct)} of supply, possibly none.`,
          [c.creator],
        ),
      );
    }
  }

  // Same-block buyers.
  const slots: number = THRESHOLDS.BUNDLE_SLOTS;
  const window =
    slots === 0
      ? "in the creation block"
      : slots === 1
        ? "in the creation block or the next one"
        : `in the creation block or the next ${slots} blocks`;
  if (c.bundlePct === null) {
    if (c.walletCount > 0) {
      out.push(
        finding(
          "crowd.bundle-unknown",
          "crowd",
          "unknown",
          "Same-block buyers not checked",
          "We could not find the coin's creation block, so buys in its first blocks were not checked.",
        ),
      );
    }
  } else if (c.bundlePct > 0) {
    const n = c.earlyBuyers.length;
    const m = c.bundleHolders.length;
    const atLeast = c.earlyBuysComplete ? "" : "at least ";
    out.push(
      finding(
        "crowd.bundle",
        "crowd",
        c.bundlePct > THRESHOLDS.BUNDLE_WARNING_PCT ? "warning" : "caution",
        `Same-block buyers hold ${atLeast}${fmtPct(c.bundlePct)}`,
        `${plural(n, "wallet")} bought ${window} (creator not counted); ${m} of them ` +
          `${m === 1 ? "is" : "are"} still among the top holders with ${fmtPct(c.bundlePct)} of supply. Buying at the ` +
          "moment of creation is a pattern consistent with a bundled launch; fast trading bots can do it too." +
          (c.earlyBuysComplete ? "" : " The first blocks could not be read in full, so there may be more."),
        [...c.bundleHolders, ...c.earlyBuyers],
      ),
    );
  } else if (c.earlyBuyers.length > 0) {
    out.push(
      finding(
        "crowd.early-buyers",
        "crowd",
        "info",
        `${plural(c.earlyBuyers.length, "wallet")} bought ${window}`,
        `None of them is among the top ${top} holders now.`,
        c.earlyBuyers,
      ),
    );
  } else if (c.earlyBuysComplete) {
    out.push(
      finding(
        "crowd.no-bundle",
        "crowd",
        "good",
        "No same-block buyers found",
        `No wallet other than the creator bought ${window}.`,
      ),
    );
  } else if (c.walletCount > 0) {
    // Never "none found" when we could not read everything.
    out.push(
      finding(
        "crowd.bundle-unknown",
        "crowd",
        "unknown",
        "Same-block buyers not fully checked",
        "This coin's first blocks could not be read in full, so wallets that bought at the moment of creation " +
          "may be missing.",
      ),
    );
  }

  // Clusters (largest first). Pure same-block clusters are already covered by crowd.bundle.
  const holderSet = new Set(c.topHolders.map((v) => v.owner));
  const described = c.clusters
    .filter((cl) => !(cl.reasons.length === 1 && cl.reasons[0] === "same-block-buy"))
    .slice(0, ENGINE_RULES.MAX_CLUSTER_FINDINGS);
  for (const cl of described) {
    const holding = cl.wallets.filter((w) => holderSet.has(w)).length;
    const hasCreator = c.creator !== null && cl.wallets.includes(c.creator);
    const only = cl.reasons.length === 1 ? cl.reasons[0] : null;
    const pctText = fmtPct(cl.pctSupply);
    let title: string;
    if (hasCreator) {
      const creatorHolds = holderSet.has(c.creator as string);
      const others = creatorHolds ? holding - 1 : holding;
      title = creatorHolds
        ? `The creator and ${plural(others, "linked wallet")} hold ${pctText}`
        : `${plural(others, "wallet")} linked to the creator ${others === 1 ? "holds" : "hold"} ${pctText}`;
    } else if (only === "shared-funder") {
      title = `${plural(holding, "wallet")} funded by the same wallet hold ${pctText}`;
    } else if (only === "similar-funding") {
      title = `${plural(holding, "wallet")} funded with similar amounts in the same hour hold ${pctText}`;
    } else {
      title = `${plural(holding, "linked wallet")} hold ${pctText}`;
    }
    const why: string[] = [];
    if (cl.reasons.includes("shared-funder")) {
      why.push(`first SOL from the same wallet${cl.funder ? ` (${shortAddr(cl.funder)})` : ""}`);
    }
    if (cl.reasons.includes("creator-sent-tokens")) why.push("received this coin from the creator in a plain transfer");
    if (cl.reasons.includes("creator-funded")) why.push("first SOL from the creator");
    if (cl.reasons.includes("similar-funding")) {
      why.push(
        `brand-new wallets funded within ${ENGINE_RULES.SIMILAR_FUNDING_WINDOW_MIN} minutes of each other with ` +
          `amounts within ${Math.round(THRESHOLDS.SIMILAR_FUNDING_FRACTION * 100)}%`,
      );
    }
    if (cl.reasons.includes("same-block-buy")) why.push(`bought ${window}`);
    out.push(
      finding(
        `crowd.cluster.${cl.id}`,
        "crowd",
        cl.pctSupply >= THRESHOLDS.WALLET_CONCENTRATION_PCT ? "warning" : "caution",
        title,
        `Linked by: ${why.join("; ")}.` +
          (hasCreator ? " The creator is part of this group." : "") +
          " Links are patterns, not proof that one person controls these wallets.",
        [...cl.wallets, cl.funder],
      ),
    );
  }

  // Single-wallet concentration.
  if (c.concentrated.length > 0) {
    const first = c.concentrated[0];
    out.push(
      finding(
        "crowd.concentration",
        "crowd",
        "caution",
        c.concentrated.length === 1 && first
          ? `One wallet holds ${fmtPct(first.pctSupply)}`
          : `${c.concentrated.length} wallets each hold more than ${fmtPct(THRESHOLDS.WALLET_CONCENTRATION_PCT)}`,
        `A single wallet with more than ${fmtPct(THRESHOLDS.WALLET_CONCENTRATION_PCT)} of supply can move the ` +
          "price a lot by itself." +
          (c.concentrated.some((v) => v.label === "unknown" && v.pctSupply > ENGINE_RULES.DOMINANT_WALLET_PCT)
            ? ` A wallet with more than ${fmtPct(ENGINE_RULES.DOMINANT_WALLET_PCT)} is never counted as independent: ` +
              "it may belong to the team, an exchange or a pool we do not recognise."
            : ""),
        c.concentrated.map((v) => v.owner),
      ),
    );
  }

  // Insider summary. Never good news while the creator is unknown or its launch bag is unaccounted for.
  const insiderSev = (pct: number): Severity => {
    const sev = insiderSeverity(pct);
    return sev === "good" && (c.creatorBagUnexplained || c.creator === null) ? "info" : sev;
  };
  if (c.evidence === "sufficient" && c.insiderPct !== null && c.independentPct !== null) {
    out.push(
      finding(
        "crowd.insiders",
        "crowd",
        insiderSev(c.insiderPct),
        `Insiders hold ${fmtPct(c.insiderPct)} of circulating supply`,
        "Insiders are the creator, wallets linked to it or to each other, and same-block buyers. Wallets we " +
          `checked and found no link for hold ${fmtPct(c.independentPct)}; the rest is held by wallets we could ` +
          `not trace or that are outside the top ${top}.`,
        c.topHolders.filter((v) => v.label === "insider").map((v) => v.owner),
      ),
    );
  } else if (
    c.evidence === "partial" &&
    c.insiderHeldPct !== null &&
    c.insiderHeldPct > 0 &&
    c.circulatingPct !== null &&
    c.circulatingPct > 0
  ) {
    const floor = Math.min(100, (c.insiderHeldPct / c.circulatingPct) * 100);
    out.push(
      finding(
        "crowd.insiders",
        "crowd",
        insiderSev(floor),
        `Insiders hold at least ${fmtPct(Math.round(floor * 100) / 100)} of circulating supply`,
        "Only part of the holder list could be traced, so the real insider share may be higher. Insiders are the " +
          "creator, wallets linked to it or to each other, and same-block buyers.",
        c.topHolders.filter((v) => v.label === "insider").map((v) => v.owner),
      ),
    );
  }

  if (
    c.evidence === "sufficient" &&
    c.clusters.length === 0 &&
    (c.bundlePct ?? 0) === 0 &&
    c.walletCount > 0 &&
    !c.creatorBagUnexplained
  ) {
    out.push(
      finding(
        "crowd.no-links",
        "crowd",
        "good",
        "No linked wallets among the top holders",
        // Only the checks that really ran are listed.
        `None of the top holders we traced ${joinList([
          "share a first funder",
          ...(c.creator !== null ? ["were funded by the creator"] : []),
          ...(c.creatorTransfersChecked ? ["received this coin from the creator"] : []),
          "got similar funding at the same time",
          ...(c.earlyBuysComplete ? ["bought in the creation block"] : []),
        ]).replace(/ and ([^,]*)$/, " or $1")}.`,
      ),
    );
  }

  if (c.creatorBagUnexplained && c.creatorDevBagPct !== null) {
    out.push(
      finding(
        "crowd.creator-bag",
        "crowd",
        "unknown",
        `Creator's launch buy of ${fmtPct(c.creatorDevBagPct)} not accounted for`,
        "The creator bought this share in the creation transaction and holds much less of it now. We saw no sell " +
          "by the creator and no transfer that explains it, so it may sit in wallets we could not link.",
        c.creator ? [c.creator] : [],
      ),
    );
  }

  if (c.programWallets.length > 0) {
    const held = sum(c.topHolders.filter((v) => c.programWallets.includes(v.owner)).map((v) => v.pctSupply));
    out.push(
      finding(
        "crowd.program-wallets",
        "crowd",
        "unknown",
        `${plural(c.programWallets.length, "program-controlled wallet")} ${c.programWallets.length === 1 ? "holds" : "hold"} ${fmtPct(Math.round(held * 100) / 100)}`,
        "Addresses a program controls on someone's behalf, such as a multisig vault. We can't tell who is behind " +
          "them, so they are counted as unknown, never as independent.",
        c.programWallets,
      ),
    );
  }

  // Unknowns (program-controlled wallets are described above).
  const untraced = c.unknownWallets.filter((w) => !c.programWallets.includes(w));
  if (untraced.length > 0) {
    const held =
      c.programWallets.length === 0
        ? (c.unknownHeldPct ?? 0)
        : Math.round(sum(c.topHolders.filter((v) => untraced.includes(v.owner)).map((v) => v.pctSupply)) * 100) / 100;
    out.push(
      finding(
        "crowd.untraced",
        "crowd",
        "unknown",
        `Couldn't trace ${untraced.length} of ${plural(c.walletCount, "holder")}`,
        `We could not find where their first SOL came from (we read up to ${LIMITS.ORIGIN_SIGNATURES} ` +
          `transactions per wallet). Together they hold ${fmtPct(held)} of supply and are not ` +
          "counted as independent.",
        untraced,
      ),
    );
  }

  if (c.listCapped && c.tailPct !== null && c.tailPct > 0) {
    out.push(
      finding(
        "crowd.long-tail",
        "crowd",
        "info",
        `${fmtPct(c.tailPct)} of supply is outside the top ${top} holders`,
        (c.smallestListedPct !== null ? `Each of those wallets holds less than ${fmtPct(c.smallestListedPct)}. ` : "") +
          "We did not check them, so they are counted as neither insider nor independent.",
      ),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------------------------

export function marketFindings(m: MarketAnalysis): Finding[] {
  const out: Finding[] = [];
  if (!m.market) {
    out.push(
      finding(
        "market.no-data",
        "market",
        "unknown",
        "No market data",
        "DEX Screener had no trading pair for this coin when we checked, so price, liquidity and volume are unknown.",
      ),
    );
  } else {
    const pair = m.market.pairAddress;
    if (m.marketCapUsd === null) {
      out.push(
        finding(
          "market.no-mcap",
          "market",
          "unknown",
          "Market cap not reported",
          "DEX Screener did not report a market cap for this coin.",
          [pair],
        ),
      );
    }
    const ratio = m.liquidityToMcapPct;
    if (ratio !== null && m.liquidityUsd !== null && m.marketCapUsd !== null && ratio >= ENGINE_RULES.LIQUIDITY_ANOMALY_PCT) {
      out.push(
        finding(
          "market.liquidity-anomaly",
          "market",
          "caution",
          "Liquidity is above the market cap",
          `${fmtUsd(m.liquidityUsd)} of liquidity against a ${fmtUsd(m.marketCapUsd)} market cap ` +
            `(${fmtPct(ratio)}). A pool only holds more than the market cap when most of the supply has been sold ` +
            `back into it, often right after a sharp fall, so the market rating is capped at ` +
            `${plural(ENGINE_RULES.LIQUIDITY_ANOMALY_MAX_STARS, "star")}.`,
          [pair],
        ),
      );
    } else if (ratio !== null && m.liquidityUsd !== null && m.marketCapUsd !== null) {
      const low = ratio < ENGINE_RULES.LOW_LIQUIDITY_PCT;
      const healthy = ratio >= ENGINE_RULES.LIQUIDITY_STAR_TIERS[0].atLeast;
      out.push(
        finding(
          low ? "market.low-liquidity" : "market.liquidity",
          "market",
          low ? "warning" : healthy ? "good" : "info",
          `Liquidity is ${fmtPct(ratio)} of market cap`,
          `${fmtUsd(m.liquidityUsd)} of liquidity against a ${fmtUsd(m.marketCapUsd)} market cap.` +
            (low
              ? " With liquidity this thin, a modest trade moves the price a lot and large holders may not be able " +
                "to exit near the quoted price."
              : ""),
          [pair],
        ),
      );
    } else if (m.liquidityUsd === null) {
      out.push(
        finding(
          "market.liquidity-unknown",
          "market",
          "unknown",
          "Liquidity not reported",
          m.graduated === false
            ? "The coin is still on its bonding curve and DEX Screener reported no pool liquidity."
            : "DEX Screener did not report liquidity for this coin's pair.",
          [pair],
        ),
      );
    }
    if (m.hasVolume === false) {
      out.push(
        finding(
          "market.no-volume",
          "market",
          "caution",
          "No trading in the last 24 hours",
          "DEX Screener reported zero volume for the last 24 hours.",
          [pair],
        ),
      );
    } else if (m.hasVolume === true && m.volume24hUsd !== null) {
      out.push(
        finding(
          "market.volume",
          "market",
          "info",
          `24-hour volume: ${fmtUsd(m.volume24hUsd)}`,
          "Volume can include trades between linked wallets; it shows activity, not demand.",
          [pair],
        ),
      );
    }
  }
  if (m.graduated === true) {
    out.push(
      finding(
        "market.graduated",
        "market",
        "info",
        "Graduated from the pump.fun bonding curve",
        "The coin completed its bonding curve and now trades in a pool.",
      ),
    );
  } else if (m.graduated === false) {
    out.push(
      finding(
        "market.bonding-curve",
        "market",
        "info",
        m.curveProgressPct !== null
          ? `Still on the pump.fun bonding curve (${fmtPct(m.curveProgressPct)} complete)`
          : "Still on the pump.fun bonding curve",
        "Until it graduates, trades go through the curve, whose price follows a fixed formula.",
      ),
    );
  }
  return out;
}

/** Every finding for a sticker, sorted, with unique ids. */
export function collectFindings(b: BuildAnalysis, c: CrowdAnalysis, m: MarketAnalysis): Finding[] {
  const seen = new Set<string>();
  const unique = [...buildFindings(b), ...crowdFindings(c), ...marketFindings(m)].filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
  return sortFindings(unique);
}
