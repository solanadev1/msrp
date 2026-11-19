/**
 * CROWD X-RAY: who holds the coin.
 *
 * Input: the top token holders (Solana returns at most LIMITS.TOP_HOLDERS), the buys that landed in
 * the creation block or the next, and what the build trace learned about the creator's family.
 * Output: clusters of linked wallets, a label per holder, and the share percentages.
 *
 * Linking rules (each one is a documented rule in methodology.ts):
 * - shared-funder:   two holders got their first SOL from the same wallet (or one funded the other,
 *                    or the build trace says the creator's funder funded them).
 * - creator-funded:  a holder got its first SOL from the creator.
 * - similar-funding: two brand-new wallets (full history seen) got their first SOL within
 *                    SIMILAR_FUNDING_WINDOW_MIN of each other, within FRESH_WALLET_WINDOW_HOURS of the
 *                    coin's creation, in amounts within SIMILAR_FUNDING_FRACTION of each other.
 * - same-block-buy:  holders that bought within BUNDLE_SLOTS slots of creation are linked together.
 *
 * Percent bases (be careful, there are two):
 * - Crowd section numbers (creatorPct, bundlePct, clusteredPct, infrastructurePct, top10Pct, cluster
 *   and holder pctSupply) are % of TOTAL supply, like HolderFact.pctSupply.
 * - insiderPct / independentPct are % of CIRCULATING supply (total minus infrastructure seen in the
 *   top holders), as Sticker.headline documents.
 *
 * Long-tail rule: only the top holders are analyzed. Supply held by wallets outside that list (the
 * "tail") is counted as neither insider nor independent: it stays unchecked. So independentPct is a
 * floor ("at least this much is held by wallets we checked and found no link for"), never a guess.
 */
import type {
  CollectedFacts,
  Cluster,
  ClusterReason,
  EarlyBuyFact,
  HolderFact,
  HolderKind,
  HolderView,
  WalletOrigin,
} from "../types";
import { LIMITS, THRESHOLDS } from "../config";
import { ENGINE_RULES } from "./rules";
import { cmpStr, finite, nonNegative, positive, roundPct, sum } from "./format";

export const INFRASTRUCTURE_KINDS: ReadonlySet<HolderKind> = new Set<HolderKind>([
  "bonding-curve",
  "pool",
  "burn",
  "program",
]);

export function isInfrastructure(kind: HolderKind): boolean {
  return INFRASTRUCTURE_KINDS.has(kind);
}

/** Order used for Cluster.reasons. */
const REASON_ORDER: readonly ClusterReason[] = ["shared-funder", "creator-funded", "similar-funding", "same-block-buy"];

export interface CrowdInput {
  holders: readonly HolderFact[];
  earlyBuys: readonly EarlyBuyFact[];
  /** Deployer wallet, if known. */
  creator: string | null;
  /** Total supply in whole tokens (used only to repair a missing holder percentage). */
  supply: number | null;
  /** Coin creation time (needed for the similar-funding rule; without it that rule is skipped). */
  createdAt: number | null;
  /** False when we could not look for early buys at all (unknown creation slot). */
  earlyBuysChecked: boolean;
  /** Where the creator's first SOL came from (from the build trace). */
  creatorOrigin: WalletOrigin | null;
  /** The creator's funder (one hop up), if known. */
  creatorFunder: string | null;
  /** Other wallets the creator's funder funded (the "family" from the build trace). */
  familyWallets: readonly string[];
  /** Funders never used as a link (e.g. a long-history wallet that could be an exchange). */
  ignoredFunders: readonly string[];
}

/**
 * "none": nothing to check (no wallet holders, or no circulating supply).
 * "partial": wallets we could not trace hold more than UNKNOWN_MAX_SHARE of the supply we checked.
 * "sufficient": enough was traced to state insider / independent shares.
 */
export type CrowdEvidence = "none" | "partial" | "sufficient";

export interface CrowdAnalysis {
  /** Distinct owners analyzed (after merging token accounts of the same owner). */
  holdersAnalyzed: number;
  topHolders: HolderView[];
  clusters: Cluster[];
  creator: string | null;
  /** % of total supply held by the creator; null when unknown (see creatorListed / listCapped). */
  creatorPct: number | null;
  /** True when the creator appears among the analyzed holders. */
  creatorListed: boolean;
  /** True when Solana's top-holder list was full, so wallets outside it may exist. */
  listCapped: boolean;
  /** Smallest % among analyzed holders: every unlisted wallet holds less than this when listCapped. */
  smallestListedPct: number | null;
  /** % of total supply held by same-block / next-block buyers still among the top holders (creator excluded). */
  bundlePct: number | null;
  bundleHolders: string[];
  /** Distinct wallets (creator excluded) that bought within BUNDLE_SLOTS of creation. */
  earlyBuyers: string[];
  clusteredPct: number | null;
  infrastructurePct: number | null;
  top10Pct: number | null;
  /** % of total supply NOT in infrastructure seen among the top holders. */
  circulatingPct: number | null;
  /** % of total supply held by analyzed non-infrastructure holders. */
  checkedPct: number | null;
  /** % of total supply held outside the analyzed list (not checked). */
  tailPct: number | null;
  /** % of TOTAL supply by label. */
  insiderHeldPct: number | null;
  independentHeldPct: number | null;
  unknownHeldPct: number | null;
  /** % of CIRCULATING supply (null unless evidence is "sufficient"). */
  insiderPct: number | null;
  independentPct: number | null;
  /** Unchecked tail as % of circulating supply. */
  tailOfCirculatingPct: number | null;
  evidence: CrowdEvidence;
  /** Analyzed non-infrastructure holders. */
  walletCount: number;
  unknownWallets: string[];
  /** Non-infrastructure holders above THRESHOLDS.WALLET_CONCENTRATION_PCT. */
  concentrated: HolderView[];
  /** Holder entries dropped because neither a percentage nor an amount could be read. */
  skippedHolders: number;
  /** True when the reported percentages added up to more than 100 and were scaled down. */
  scaledDown: boolean;
}

interface MergedHolder {
  owner: string;
  pct: number;
  kind: HolderKind;
  origin: WalletOrigin | null;
}

interface Node {
  wallet: string;
  holder: MergedHolder | null;
  origin: WalletOrigin | null;
  funder: string | null;
}

interface Edge {
  a: number;
  b: number;
  reason: ClusterReason;
  funder: string | null;
}

class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root] ?? root;
    let cur = i;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur] ?? root;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Smaller index becomes the root: deterministic regardless of edge order.
    if (ra < rb) this.parent[rb] = ra;
    else this.parent[ra] = rb;
  }
}

/** Build the crowd input from collected facts. Keeps the "family" rules in one place. */
export function crowdInputFromFacts(facts: CollectedFacts): CrowdInput {
  const factory = facts.factory;
  const creator = facts.coin.creator ?? factory?.deployer ?? null;
  const creatorFunder = factory ? (factory.funder ?? factory.deployerOrigin?.funder ?? null) : null;
  const funderIsVeteran = factory?.funderIsVeteran === true;
  const ignoredFunders = funderIsVeteran && creatorFunder ? [creatorFunder] : [];
  const familyWallets =
    factory && !funderIsVeteran
      ? [...new Set(factory.siblings.map((s) => s.wallet))]
          .filter((w) => w && w !== creator && w !== creatorFunder)
          .sort(cmpStr)
      : [];
  return {
    holders: facts.holders,
    earlyBuys: facts.earlyBuys,
    creator,
    supply: positive(facts.coin.supply),
    createdAt: finite(facts.coin.createdAt),
    earlyBuysChecked: finite(facts.coin.creationSlot) !== null,
    creatorOrigin: factory?.deployerOrigin ?? null,
    creatorFunder,
    familyWallets,
    ignoredFunders,
  };
}

function mergeHolders(
  holders: readonly HolderFact[],
  creator: string | null,
  supply: number | null,
): { merged: MergedHolder[]; skipped: number; scaledDown: boolean } {
  const byOwner = new Map<string, MergedHolder>();
  let skipped = 0;
  for (const h of holders) {
    if (!h || typeof h.owner !== "string" || h.owner.length === 0) {
      skipped++;
      continue;
    }
    let pct = nonNegative(h.pctSupply);
    if (pct === null) {
      const amount = nonNegative(h.amount);
      pct = amount !== null && supply !== null ? (amount / supply) * 100 : null;
    }
    if (pct === null) {
      skipped++;
      continue;
    }
    pct = Math.min(pct, 100);
    const kind: HolderKind = creator !== null && h.owner === creator ? "creator" : h.kind;
    const existing = byOwner.get(h.owner);
    if (existing) {
      existing.pct += pct;
      existing.origin = existing.origin ?? h.origin ?? null;
    } else {
      byOwner.set(h.owner, { owner: h.owner, pct, kind, origin: h.origin ?? null });
    }
  }
  const merged = [...byOwner.values()];
  const total = sum(merged.map((m) => m.pct));
  const scaledDown = total > 100.01;
  if (scaledDown) for (const m of merged) m.pct = (m.pct / total) * 100;
  merged.sort((a, b) => b.pct - a.pct || cmpStr(a.owner, b.owner));
  return { merged, skipped, scaledDown };
}

/** A wallet whose first SOL arrived recently enough, with a full history, to be judged by amount. */
function freshFunding(origin: WalletOrigin | null, createdAt: number | null): { sol: number; at: number } | null {
  if (!origin || createdAt === null) return null;
  if (!origin.historyComplete || origin.veteran) return null;
  const sol = positive(origin.fundedSol);
  const at = finite(origin.fundedAt);
  if (sol === null || at === null) return null;
  if (Math.abs(createdAt - at) > ENGINE_RULES.FRESH_WALLET_WINDOW_HOURS * 3_600_000) return null;
  return { sol, at };
}

/** True when two fresh fundings match the similar-funding rule. */
export function similarFunding(a: { sol: number; at: number }, b: { sol: number; at: number }): boolean {
  if (Math.abs(a.at - b.at) > ENGINE_RULES.SIMILAR_FUNDING_WINDOW_MIN * 60_000) return false;
  return Math.abs(a.sol - b.sol) / Math.max(a.sol, b.sol) <= THRESHOLDS.SIMILAR_FUNDING_FRACTION;
}

/** True when the wallet's origin was traced well enough to call it independent if nothing links it. */
function traced(origin: WalletOrigin | null): boolean {
  return !!origin && (origin.veteran || origin.historyComplete || origin.funder !== null);
}

export function analyzeCrowd(input: CrowdInput): CrowdAnalysis {
  // The creator is the deployer we were told about, else a holder the chain layer marked "creator".
  const creator =
    input.creator && input.creator.length > 0
      ? input.creator
      : ([...input.holders]
          .filter((x) => x?.kind === "creator" && typeof x.owner === "string" && x.owner.length > 0)
          .map((x) => x.owner)
          .sort(cmpStr)[0] ?? null);
  const { merged, skipped, scaledDown } = mergeHolders(input.holders, creator, positive(input.supply));
  const ignored = new Set(input.ignoredFunders);
  const family = new Set(ignored.has(input.creatorFunder ?? "") ? [] : input.familyWallets);
  const creatorFunder = input.creatorFunder && !ignored.has(input.creatorFunder) ? input.creatorFunder : null;

  // ---- nodes: non-infrastructure holders, plus the creator (even when it no longer holds) ----
  const people = merged.filter((m) => !isInfrastructure(m.kind));
  const infra = merged.filter((m) => isInfrastructure(m.kind));
  const nodes: Node[] = people.map((h) => {
    const traceFunder = h.origin?.funder ?? null;
    const funder = traceFunder ?? (family.has(h.owner) ? creatorFunder : null);
    return { wallet: h.owner, holder: h, origin: h.origin, funder };
  });
  const index = new Map<string, number>(nodes.map((n, i) => [n.wallet, i]));
  let creatorIdx: number | null = null;
  if (creator !== null) {
    const existing = index.get(creator);
    const creatorOrigin = input.creatorOrigin ?? (existing !== undefined ? (nodes[existing]?.origin ?? null) : null);
    const creatorFunderForNode = creatorFunder ?? creatorOrigin?.funder ?? null;
    if (existing !== undefined) {
      const node = nodes[existing];
      if (node) {
        node.origin = creatorOrigin;
        node.funder = creatorFunderForNode;
      }
      creatorIdx = existing;
    } else {
      creatorIdx = nodes.length;
      nodes.push({ wallet: creator, holder: null, origin: creatorOrigin, funder: creatorFunderForNode });
      index.set(creator, creatorIdx);
    }
  }
  // A funder that is itself a long-history (veteran) holder is often an exchange: never a link.
  for (const n of nodes) if (n.holder && n.origin?.veteran && n.wallet !== creator) ignored.add(n.wallet);
  for (const n of nodes) {
    if (n.funder !== null && (ignored.has(n.funder) || n.funder === n.wallet)) n.funder = null;
  }

  // ---- edges ----
  const edges: Edge[] = [];
  const link = (a: number, b: number, reason: ClusterReason, funder: string | null) => {
    if (a !== b) edges.push({ a, b, reason, funder });
  };

  // shared-funder: same first funder (the creator as funder is handled by creator-funded).
  const byFunder = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    if (n.funder === null || n.funder === creator) return;
    const list = byFunder.get(n.funder) ?? [];
    list.push(i);
    byFunder.set(n.funder, list);
  });
  for (const [funder, members] of byFunder) {
    const first = members[0];
    if (first === undefined) continue;
    for (const m of members.slice(1)) link(first, m, "shared-funder", funder);
    // The funding wallet itself is a holder: it belongs with the wallets it funded.
    const funderIdx = index.get(funder);
    if (funderIdx !== undefined) link(funderIdx, first, "shared-funder", funder);
  }

  // Family from the build trace: wallets the creator's funder funded, and that funder itself.
  if (creatorIdx !== null) {
    nodes.forEach((n, i) => {
      if (i === creatorIdx) return;
      if (family.has(n.wallet) || (creatorFunder !== null && n.wallet === creatorFunder)) {
        link(i, creatorIdx as number, "shared-funder", creatorFunder);
      }
    });
  }

  // creator-funded: first SOL came from the creator.
  if (creatorIdx !== null && creator !== null) {
    nodes.forEach((n, i) => {
      if (i !== creatorIdx && n.funder === creator) link(i, creatorIdx as number, "creator-funded", creator);
    });
  }

  // similar-funding: brand-new wallets, same hour, amounts within the fraction.
  const createdAt = finite(input.createdAt);
  const fresh = nodes.map((n) => freshFunding(n.origin, createdAt));
  for (let i = 0; i < nodes.length; i++) {
    const fi = fresh[i];
    if (!fi) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const fj = fresh[j];
      if (fj && similarFunding(fi, fj)) link(i, j, "similar-funding", null);
    }
  }

  // same-block-buy: early buyers (creator excluded) still among the holders.
  const earlyBuyers: string[] = [];
  const earlySet = new Set<string>();
  if (input.earlyBuysChecked) {
    for (const b of input.earlyBuys) {
      const slots = finite(b?.slotsAfterCreate);
      if (!b || !b.wallet || slots === null || slots < 0 || slots > THRESHOLDS.BUNDLE_SLOTS) continue;
      if (b.wallet === creator || earlySet.has(b.wallet)) continue;
      earlySet.add(b.wallet);
    }
    earlyBuyers.push(...[...earlySet].sort(cmpStr));
  }
  const bundleIdx = nodes
    .map((n, i) => (n.holder && n.wallet !== creator && earlySet.has(n.wallet) ? i : -1))
    .filter((i) => i >= 0);
  const firstBundle = bundleIdx[0];
  if (firstBundle !== undefined) for (const i of bundleIdx.slice(1)) link(firstBundle, i, "same-block-buy", null);

  // ---- components -> clusters ----
  const uf = new UnionFind(nodes.length);
  for (const e of edges) uf.union(e.a, e.b);
  const comps = new Map<number, number[]>();
  nodes.forEach((_, i) => {
    const r = uf.find(i);
    const list = comps.get(r) ?? [];
    list.push(i);
    comps.set(r, list);
  });

  const rawClusters: { members: number[]; cluster: Omit<Cluster, "id"> }[] = [];
  for (const [root, members] of comps) {
    if (members.length < 2) continue;
    const compEdges = edges.filter((e) => uf.find(e.a) === root);
    const reasons = REASON_ORDER.filter((r) => compEdges.some((e) => e.reason === r));
    const funderCounts = new Map<string, number>();
    for (const e of compEdges) {
      if (e.reason === "shared-funder" && e.funder) funderCounts.set(e.funder, (funderCounts.get(e.funder) ?? 0) + 1);
    }
    const funder =
      [...funderCounts.entries()].sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0]))[0]?.[0] ?? null;
    const sorted = [...members].sort((a, b) => {
      const pa = nodes[a]?.holder?.pct ?? 0;
      const pb = nodes[b]?.holder?.pct ?? 0;
      return pb - pa || cmpStr(nodes[a]?.wallet ?? "", nodes[b]?.wallet ?? "");
    });
    rawClusters.push({
      members,
      cluster: {
        funder,
        wallets: sorted.map((i) => nodes[i]?.wallet ?? ""),
        pctSupply: sum(members.map((i) => nodes[i]?.holder?.pct ?? 0)),
        reasons,
      },
    });
  }
  rawClusters.sort(
    (a, b) => b.cluster.pctSupply - a.cluster.pctSupply || cmpStr(a.cluster.wallets[0] ?? "", b.cluster.wallets[0] ?? ""),
  );
  const clusterOf = new Map<number, string>();
  const clusters: Cluster[] = rawClusters.map((rc, k) => {
    const id = `c${k + 1}`;
    for (const m of rc.members) clusterOf.set(m, id);
    return { id, ...rc.cluster, pctSupply: roundPct(rc.cluster.pctSupply) };
  });

  // ---- labels ----
  const bundleSet = new Set(bundleIdx.map((i) => nodes[i]?.wallet ?? ""));
  const topHolders: HolderView[] = merged.map((h) => {
    if (isInfrastructure(h.kind)) {
      return { owner: h.owner, pctSupply: roundPct(h.pct), kind: h.kind, clusterId: null, funder: null, label: "infrastructure" };
    }
    const i = index.get(h.owner);
    const node = i !== undefined ? nodes[i] : undefined;
    const clusterId = i !== undefined ? (clusterOf.get(i) ?? null) : null;
    const insider =
      h.owner === creator || h.kind === "creator" || clusterId !== null || bundleSet.has(h.owner) || family.has(h.owner);
    const label: HolderView["label"] = insider ? "insider" : traced(h.origin) ? "independent" : "unknown";
    return { owner: h.owner, pctSupply: roundPct(h.pct), kind: h.kind, clusterId, funder: node?.funder ?? null, label };
  });

  // ---- percentages ----
  const empty = merged.length === 0;
  const infraPct = sum(infra.map((m) => m.pct));
  const checked = sum(people.map((m) => m.pct));
  const analyzedTotal = infraPct + checked;
  const circulating = 100 - infraPct;
  const exactPct = new Map(merged.map((m) => [m.owner, m.pct]));
  const pctOfLabel = (label: HolderView["label"]) =>
    sum(topHolders.filter((v) => v.label === label).map((v) => exactPct.get(v.owner) ?? 0));
  const insiderHeld = pctOfLabel("insider");
  const independentHeld = pctOfLabel("independent");
  const unknownHeld = pctOfLabel("unknown");

  const listCapped = input.holders.length >= LIMITS.TOP_HOLDERS;
  const creatorHolder = creator !== null ? merged.find((m) => m.owner === creator) : undefined;
  let creatorPct: number | null = null;
  if (creatorHolder) creatorPct = roundPct(creatorHolder.pct);
  else if (creator !== null && !empty && !listCapped && skipped === 0) creatorPct = 0;

  let evidence: CrowdEvidence = "sufficient";
  if (empty || people.length === 0 || checked <= 0 || circulating <= 0) evidence = "none";
  else if (unknownHeld / checked > ENGINE_RULES.UNKNOWN_MAX_SHARE) evidence = "partial";

  const ofCirc = (v: number) => (evidence === "sufficient" ? roundPct((v / circulating) * 100) : null);
  const peopleSorted = topHolders.filter((v) => v.label !== "infrastructure");
  const tail = Math.max(0, 100 - analyzedTotal);

  return {
    holdersAnalyzed: merged.length,
    topHolders,
    clusters,
    creator,
    creatorPct,
    creatorListed: !!creatorHolder,
    listCapped,
    smallestListedPct: empty ? null : roundPct(Math.min(...merged.map((m) => m.pct))),
    bundlePct: empty || !input.earlyBuysChecked ? null : roundPct(sum(bundleIdx.map((i) => nodes[i]?.holder?.pct ?? 0))),
    bundleHolders: [...bundleSet],
    earlyBuyers,
    clusteredPct: empty ? null : roundPct(sum(rawClusters.map((rc) => rc.cluster.pctSupply))),
    infrastructurePct: empty ? null : roundPct(infraPct),
    top10Pct: empty
      ? null
      : roundPct(sum(people.slice(0, ENGINE_RULES.TOP_N_CONCENTRATION).map((m) => m.pct))),
    circulatingPct: empty ? null : roundPct(circulating),
    checkedPct: empty ? null : roundPct(checked),
    tailPct: empty ? null : roundPct(tail),
    insiderHeldPct: empty ? null : roundPct(insiderHeld),
    independentHeldPct: empty ? null : roundPct(independentHeld),
    unknownHeldPct: empty ? null : roundPct(unknownHeld),
    insiderPct: ofCirc(insiderHeld),
    independentPct: ofCirc(independentHeld),
    tailOfCirculatingPct: empty || circulating <= 0 ? null : roundPct((tail / circulating) * 100),
    evidence,
    walletCount: people.length,
    unknownWallets: peopleSorted.filter((v) => v.label === "unknown").map((v) => v.owner),
    concentrated: peopleSorted.filter((v) => v.pctSupply > THRESHOLDS.WALLET_CONCENTRATION_PCT),
    skippedHolders: skipped,
    scaledDown,
  };
}
