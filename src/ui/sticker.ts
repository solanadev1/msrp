/**
 * THE STICKER for one coin, in the owner's final "ultra minimal" design (docs/DESIGN.md,
 * docs/design/min/sticker.html): one quiet column, one big purple number, rating dots,
 * hairlines, monospace wallets, the family tree, a small wallet graph and plain notes.
 *
 * Rules kept from every earlier version:
 * - Every number links to its evidence (class "ev": Solscan, DEX Screener or the rows below).
 * - Every wallet carries data-w / data-g so msrp.js can highlight it and every wallet linked to it.
 * - Unknown is printed as "Unknown" with the reason, never as 0.
 * - Shares: crowd numbers are % of TOTAL supply; headline insider/independent are % of
 *   CIRCULATING supply (outside the curve, pools and burn). Holders outside the top 20 are
 *   neither insider nor independent: they are shown as untraced, never as independent.
 */
import type { Cluster, ClusterReason, Finding, HolderView, PageContext, Rating, Severity, Stars, Sticker } from "../types";
import { LIMITS, THRESHOLDS } from "../config";
import { cleanLabel, esc, isSignature, safeUrl } from "./escape";
import {
  UNKNOWN,
  dayTime,
  iso,
  joinAnd,
  makeShortener,
  minutes,
  pct,
  pctChange,
  plural,
  seconds,
  sol,
  starText,
  usdFull,
  usdPrice,
  usdShort,
} from "./format";
import { walletGraph } from "./graph";
import { ext } from "./layout";
import { abs, external, paths } from "./paths";

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/** Display name for a coin: "Example Coin ($EXAMPLE)", with fallbacks. Not escaped. */
export function coinTitle(name: string | null, symbol: string | null): string {
  const n = cleanLabel(name, 48);
  const s = cleanLabel(symbol, 16);
  if (n && s) return `${n} ($${s})`;
  if (n) return n;
  if (s) return `$${s}`;
  return "Unnamed coin";
}

export function isExample(s: Sticker): boolean {
  return s.coverage.notes.some((n) => /^example data/i.test(n));
}

/** Five 7px dots, `stars` of them purple; "Not rated" when there was too little evidence. */
export function dots(stars: Stars): string {
  if (stars === null) return `<span class="nr">Not rated</span>`;
  let out = "";
  for (let i = 0; i < 5; i++) out += i < stars ? `<i class="on"></i>` : "<i></i>";
  return `<span class="dots" role="img" aria-label="${stars} of 5">${out}</span>`;
}

/** Kept for callers of the old API: a rating as dots. */
export function stars(r: Rating): string {
  return dots(r.stars);
}

/** "Unknown" plus a short reason, so a missing number is never mistaken for zero. */
function unknown(reason: string): string {
  return `<span class="u">${UNKNOWN}</span><small class="rs"> · ${esc(reason)}</small>`;
}

/** A number that links to the evidence behind it (dotted underline on hover). `text` must be escaped. */
function receipt(href: string, text: string, title: string): string {
  return /^https?:/.test(href)
    ? `<a class="ev" href="${esc(href)}" rel="noopener nofollow" target="_blank" title="${esc(title)}">${text}</a>`
    : `<a class="ev" href="${esc(href)}" title="${esc(title)}">${text}</a>`;
}

/** One hairline row: label on the left, value on the right. `value` is HTML. */
function kv(label: string, value: string, cls = ""): string {
  return `<div class="kv"><span>${esc(label)}</span><span class="v${cls ? ` ${cls}` : ""}">${value}</span></div>`;
}

const SEP = ` <span class="sep">·</span> `;

const REASON_TEXT: Record<ClusterReason, string> = {
  "shared-funder": "first SOL from the same wallet",
  "similar-funding": `funded with amounts within ${Math.round(THRESHOLDS.SIMILAR_FUNDING_FRACTION * 100)}% of each other`,
  "same-block-buy":
    (THRESHOLDS.BUNDLE_SLOTS as number) === 0 ? "bought in the creation block" : "bought in the creation block or the next one",
  "creator-funded": "funded by the creator",
};

/** "Group A", "Group B", ... "Group AA" for cluster number i (0-based). */
export function groupName(i: number): string {
  let n = i;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Group ${out}`;
}

// ---------------------------------------------------------------------------
// Wallet links + highlighter groups
// ---------------------------------------------------------------------------

/**
 * Knows every address on the page, how to shorten it unambiguously, and which highlighter
 * groups it belongs to. Only links the engines established become groups: a cluster
 * ("c:<id>") or the deployer's funding family ("f:<funder>").
 */
class Wallets {
  private groups = new Map<string, Set<string>>();
  private keyIds = new Map<string, string>();
  readonly short: (addr: string) => string;

  constructor(s: Sticker) {
    const all: string[] = [s.mint];
    const b = s.build;
    if (b.deployer) all.push(b.deployer);
    if (b.funder) all.push(b.funder);
    for (const m of b.family) all.push(m.wallet);
    for (const h of s.crowd.topHolders) {
      all.push(h.owner);
      if (h.funder) all.push(h.funder);
    }
    for (const c of s.crowd.clusters) {
      all.push(...c.wallets);
      if (c.funder) all.push(c.funder);
    }
    for (const f of s.findings) all.push(...f.evidence);
    if (typeof b.mintAuthority === "string") all.push(b.mintAuthority);
    if (typeof b.freezeAuthority === "string") all.push(b.freezeAuthority);
    if (s.market?.pairAddress) all.push(s.market.pairAddress);
    this.short = makeShortener(all);

    if (b.funder) {
      const fam = `f:${b.funder}`;
      this.add(b.funder, fam);
      if (b.deployer) this.add(b.deployer, fam);
      for (const m of b.family) this.add(m.wallet, fam);
    }
    for (const c of s.crowd.clusters) {
      const key = `c:${c.id}`;
      for (const w of c.wallets) this.add(w, key);
      if (c.funder) this.add(c.funder, key);
    }
    for (const h of s.crowd.topHolders) if (h.clusterId) this.add(h.owner, `c:${h.clusterId}`);
  }

  private add(addr: string, key: string): void {
    let set = this.groups.get(addr);
    if (!set) this.groups.set(addr, (set = new Set()));
    set.add(key);
  }

  private keyId(key: string): string {
    let id = this.keyIds.get(key);
    if (!id) this.keyIds.set(key, (id = `g${this.keyIds.size + 1}`));
    return id;
  }

  /** data-w / data-g attributes for one address. */
  attrs(addr: string): string {
    const keys = [...(this.groups.get(addr) ?? [])].sort().map((k) => this.keyId(k));
    return ` data-w="${esc(addr)}"${keys.length ? ` data-g="${keys.join(" ")}"` : ""}`;
  }

  /** A wallet (or mint) linked to Solscan, shortened, monospace, highlightable. `cls`: f = funder (yellow), d = dim. */
  link(addr: string, cls = ""): string {
    return (
      `<a class="wl${cls ? ` ${cls}` : ""}" href="${esc(external.solscanAccount(addr))}" rel="noopener nofollow" ` +
      `target="_blank" title="${esc(addr)}"${this.attrs(addr)}>${esc(this.short(addr))}</a>`
    );
  }

  /** A transaction signature linked to Solscan. */
  tx(sig: string): string {
    return (
      `<a class="wl" href="${esc(external.solscanTx(sig))}" rel="noopener nofollow" target="_blank" title="${esc(sig)}">` +
      `tx ${esc(this.short(sig))}</a>`
    );
  }
}

// ---------------------------------------------------------------------------
// Supply split (shares of TOTAL supply, from the holder rows, so everything adds up)
// ---------------------------------------------------------------------------

interface Split {
  infra: number;
  insider: number;
  independent: number;
  /** Top holders we couldn't trace. */
  untraced: number;
  /** Everything outside the top holders: not checked. */
  outside: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function splitSupply(s: Sticker): Split | null {
  const t = s.crowd.topHolders;
  if (t.length === 0) return null;
  const sum = (label: HolderView["label"]) => round1(t.filter((h) => h.label === label).reduce((a, h) => a + h.pctSupply, 0));
  const infra = sum("infrastructure");
  const insider = sum("insider");
  const independent = sum("independent");
  const untraced = sum("unknown");
  const outside = round1(Math.max(0, 100 - infra - insider - independent - untraced));
  return { infra, insider, independent, untraced, outside };
}

/** What the infrastructure is made of, for sentences: "the bonding curve", "pools", "burned coins". */
function infraParts(s: Sticker): string[] {
  const kinds = new Set(s.crowd.topHolders.filter((h) => h.label === "infrastructure").map((h) => h.kind));
  const parts: string[] = [];
  if (kinds.has("bonding-curve")) parts.push("the bonding curve");
  if (kinds.has("pool") || kinds.has("program") || kinds.has("wallet")) parts.push("pools");
  if (kinds.has("burn")) parts.push("burned coins");
  return parts;
}

/** "the supply outside the bonding curve and pools" / "the supply". */
function circulatingWords(s: Sticker): string {
  const parts = infraParts(s);
  return parts.length ? `the supply outside ${joinAnd(parts)}` : "the supply";
}

/** Short legend word for the infrastructure slice. */
function infraWord(s: Sticker): string {
  const parts = infraParts(s);
  if (parts.length === 1 && parts[0] === "the bonding curve") return "curve";
  if (parts.length === 1 && parts[0] === "burned coins") return "burned";
  if (parts.includes("the bonding curve")) return "curve & pools";
  return "pools";
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function where(s: Sticker): string {
  const b = s.build;
  if (b.launchpad !== "pump.fun") return "launchpad unknown";
  if (b.graduated === true) return "pump.fun, graduated";
  if (b.graduated === false) return `pump.fun, bonding curve${b.curveProgressPct !== null ? ` ${pct(b.curveProgressPct)}` : ""}`;
  return "pump.fun";
}

function coinHeader(s: Sticker): string {
  const name = cleanLabel(s.name, 48);
  const sym = cleanLabel(s.symbol, 16);
  const main = name ?? (sym ? `$${sym}` : "Unnamed coin");
  const second = name && sym ? ` <span>$${esc(sym)}</span>` : "";
  const mintShort = s.mint.length > 20 ? `${s.mint.slice(0, 8)}…${s.mint.slice(-6)}` : s.mint;
  const created = s.build.createdAt !== null ? `created <time datetime="${iso(s.build.createdAt)}">${esc(dayTime(s.build.createdAt))}</time>` : `created ${UNKNOWN.toLowerCase()}`;
  const bits = [
    `<a class="m ev" href="${esc(external.solscanToken(s.mint))}" rel="noopener nofollow" target="_blank" title="${esc(s.mint)}">${esc(mintShort)}</a>` +
      `<button type="button" class="cp" data-copy="${esc(s.mint)}" hidden>copy</button>`,
    esc(where(s)),
    created,
  ];
  if (isExample(s)) bits.push(`<span class="ex">example data</span>`);
  return `<header class="coin"><h1>${esc(main)}${second}</h1><p class="meta">${bits.join(SEP)}</p></header>`;
}

function hero(s: Sticker): string {
  const h = s.headline;
  const pairUrl = safeUrl(s.market?.pairUrl) ?? external.dexscreener(s.mint);
  const cap = h.marketCapUsd;
  const price = h.stickerPriceUsd;
  const ind = h.independentPct;

  const big =
    price !== null
      ? receipt("#holders", `<em>${esc(usdShort(price))}</em>`, "Market cap × share of total supply held by independent wallets")
      : `<em class="u">${UNKNOWN}</em>`;
  const of = cap !== null ? ` <span class="of">/ ${receipt(pairUrl, esc(usdShort(cap)), "Market cap on DEX Screener")}</span>` : "";
  const indB = ind !== null ? `<b>${esc(pct(ind))}</b>` : "";
  const capB = cap !== null ? `<b>${esc(usdShort(cap))}</b>` : "";
  const traceGap =
    s.crowd.topHolders.length === 0
      ? "we couldn't read the largest holders"
      : "wallets we couldn't trace hold more than half of the supply we checked";

  let text: string;
  if (price !== null && cap !== null) {
    text =
      `Of this coin's ${capB} market cap, <b>${esc(usdShort(price))}</b> is held by wallets with no link we could find to the creator or to each other.` +
      (ind !== null ? ` That's ${indB} of ${esc(circulatingWords(s))}.` : "");
  } else if (cap !== null) {
    text = `No sticker price: ${esc(traceGap)}, so we can't say how much of the ${capB} market cap independent wallets hold.`;
  } else if (ind !== null) {
    text = `No sticker price: DEX Screener had no market cap for this coin when we checked. Independent wallets hold ${indB} of ${esc(circulatingWords(s))}.`;
  } else {
    text = `No sticker price: DEX Screener had no market cap for this coin when we checked, and ${esc(traceGap)}.`;
  }
  return (
    `<div class="hero"><p class="n">${big}${of}</p>` +
    `<p class="say">${text}</p></div>`
  );
}

function rates(s: Sticker): string {
  const r = s.ratings;
  const cell = (label: string, rating: Rating, href: string, ov = false) =>
    `<a class="rt${ov ? " ov" : ""}" href="${href}" title="${esc(rating.reason)}"><small>${esc(label)}</small>${dots(rating.stars)}</a>`;
  return (
    `<div class="rates" id="ratings">` +
    cell("Who made it", r.build, "#made") +
    cell("Who holds it", r.crowd, "#holders") +
    cell("Market", r.market, "#market") +
    cell("Overall", r.overall, "#notes", true) +
    `</div>` +
    `<p class="why">${esc(r.overall.reason)} Ratings measure how open the ownership is, not where the price goes. ` +
    `<a href="${paths.methodology}#overall">How ratings work</a></p>`
  );
}

function madeLead(s: Sticker, w: Wallets): string {
  const b = s.build;
  if (!b.deployer) return `We couldn't find the transaction that created this coin, so who made it is ${UNKNOWN.toLowerCase()}.`;
  const D = w.link(b.deployer);
  const siblings = b.family.filter((m) => m.role === "sibling").length;
  const launches = (n: number) => receipt("#tree", esc(plural(n, "coin")), "Launches seen, listed in the family tree below");
  const fast = (n: number) =>
    n > 0
      ? ` and sold within ${THRESHOLDS.FAST_DEV_SELL_MIN} minutes on ${receipt("#tree", esc(String(n)), "Launches where the launching wallet sold quickly")}.`
      : `, with no sell within ${THRESHOLDS.FAST_DEV_SELL_MIN} minutes seen.`;

  if (!b.funder) {
    return (
      `The creator ${D} got its first SOL from a wallet we couldn't find (it was beyond the transactions we read), so its funder and family are ${UNKNOWN.toLowerCase()}. ` +
      (b.deployerLaunchCount > 0
        ? `It launched ${launches(b.deployerLaunchCount)} in the transactions we sampled${fast(b.familyFastDevSellCount)}`
        : `We saw no other launches from it in the transactions we sampled.`)
    );
  }
  let t = `The creator ${D} was funded by ${w.link(b.funder, "f")}`;
  if (b.deployerFundedBeforeLaunchMin !== null) {
    t += ` ${receipt(external.solscanAccount(b.deployer), esc(minutes(b.deployerFundedBeforeLaunchMin)), "The creator's first incoming SOL, on Solscan")} before launch`;
  }
  t += ".";
  t += siblings > 0 ? ` That wallet funded ${receipt("#tree", esc(plural(siblings, "other wallet")), "Wallets the same funder paid")}.` : " We found no other wallets it funded.";
  if (b.familyLaunchCount > 0) t += ` ${siblings > 0 ? "Together they" : "It"} launched ${launches(b.familyLaunchCount)}${fast(b.familyFastDevSellCount)}`;
  else t += " We saw no launches from them in the transactions we sampled.";
  if (b.sentBackToFunderSol > 0) {
    t += ` ${receipt(external.solscanAccount(b.funder), esc(sol(b.sentBackToFunderSol)), "The funder wallet on Solscan")} went back to the funder.`;
  }
  return t;
}

/** The family as aligned monospace text, like a file listing. No box. */
function familyTree(s: Sticker, w: Wallets): string {
  const b = s.build;
  if (!b.deployer) return "";
  const held = new Map(s.crowd.topHolders.map((h) => [h.owner, h]));
  const deployer = b.family.find((m) => m.role === "deployer");
  const siblings = b.family.filter((m) => m.role === "sibling");
  const MAX = 6;

  interface Row {
    addr: string | null;
    text: string;
    tag: string;
    tagCls: string;
    launches: number;
    fast: number;
  }
  const rows: Row[] = [];
  const holdTag = (addr: string): [string, string] => {
    const h = held.get(addr);
    return h && h.label === "insider" ? [`holds ${pct(h.pctSupply)}`, "r"] : ["", ""];
  };
  rows.push({
    addr: b.deployer,
    text: w.short(b.deployer),
    tag: "this coin",
    tagCls: "t",
    launches: deployer?.launches ?? b.deployerLaunchCount,
    fast: deployer?.launchesWithFastDevSell ?? 0,
  });
  for (const m of siblings.slice(0, MAX - 1)) {
    const [tag, tagCls] = holdTag(m.wallet);
    rows.push({ addr: m.wallet, text: w.short(m.wallet), tag, tagCls, launches: m.launches, fast: m.launchesWithFastDevSell });
  }
  const rest = siblings.slice(MAX - 1);
  if (rest.length) {
    rows.push({
      addr: null,
      text: `+ ${rest.length} more`,
      tag: "",
      tagCls: "",
      launches: rest.reduce((a, m) => a + m.launches, 0),
      fast: rest.reduce((a, m) => a + m.launchesWithFastDevSell, 0),
    });
  }

  const addrW = Math.max(...rows.map((r) => r.text.length), b.funder ? w.short(b.funder).length - 3 : 0);
  const tagW = Math.max(9, ...rows.map((r) => r.tag.length));
  const launchText = (n: number) => (n === 0 ? "no launches" : plural(n, "launch", "launches"));
  const lw = Math.max(...rows.map((r) => launchText(r.launches).length));
  const sp = (n: number) => " ".repeat(Math.max(0, n));

  const lines: string[] = [];
  if (b.funder) {
    const f = w.short(b.funder);
    lines.push(`${w.link(b.funder, "f")}${sp(3 + addrW + 2 - f.length)}<span class="c">funder</span>`);
  } else {
    lines.push(`<span class="c">? funder ${UNKNOWN.toLowerCase()}</span>`);
  }
  rows.forEach((r, i) => {
    const branch = i === rows.length - 1 ? "└─ " : "├─ ";
    const addr = r.addr ? w.link(r.addr) : `<span class="c">${esc(r.text)}</span>`;
    const lt = launchText(r.launches);
    const tag = r.tag ? `<span class="${r.tagCls}">${esc(r.tag)}</span>` : "";
    const sells =
      r.launches > 0
        ? `  <span class="${r.fast > 0 ? "r" : "c"}">${esc(`${r.fast} sold <${THRESHOLDS.FAST_DEV_SELL_MIN}m`)}</span>`
        : "";
    lines.push(
      `${branch}${addr}${sp(addrW - r.text.length + 2)}${tag}${sp(tagW - r.tag.length + 2)}` +
        `${sp(lw - lt.length)}<span class="${r.launches ? "" : "c"}">${esc(lt)}</span>${sells}`,
    );
  });

  const sampled = b.funder
    ? `Wallets the funder paid, from up to ${LIMITS.FUNDER_TX_SAMPLE} of its transactions (at most ${LIMITS.MAX_SIBLINGS} checked). ` +
      `Launch counts come from each wallet's latest ${LIMITS.LAUNCH_SIGNATURE_SAMPLE} transactions.`
    : "We couldn't find the creator's funder, so we couldn't look for other wallets it paid.";
  return `<pre class="tree" id="tree" aria-label="Family tree">${lines.join("\n")}</pre><p class="fine">${esc(sampled)}</p>`;
}

function authority(v: string | null | "unknown", w: Wallets, effect: string): [string, string] {
  if (v === null) return ["removed", "g"];
  if (v === "unknown") return [unknown("couldn't read the coin's settings"), ""];
  return [`still set, ${esc(effect)}: ${w.link(v)}`, "r"];
}

function madeSection(ctx: PageContext, s: Sticker, w: Wallets): string {
  const b = s.build;
  const graph = walletGraph(s, w);
  const lead = `<p class="lead">${madeLead(s, w)}</p>`;
  const [mintA, mintCls] = authority(b.mintAuthority, w, "more coins can be created");
  const [frzA, frzCls] = authority(b.freezeAuthority, w, "holders' coins can be frozen");
  const facts =
    `<div class="kvs">` +
    kv(
      "Creator's first SOL",
      b.deployerFundedBeforeLaunchMin !== null && b.deployer
        ? receipt(external.solscanAccount(b.deployer), esc(`${minutes(b.deployerFundedBeforeLaunchMin)} before launch`), "The creator wallet on Solscan")
        : unknown(b.deployer ? "funding time not found" : "needs the creator wallet"),
      b.deployerFundedBeforeLaunchMin !== null && b.deployerFundedBeforeLaunchMin <= THRESHOLDS.FRESH_DEPLOYER_MIN ? "y" : "",
    ) +
    kv(
      "Creator's buy at launch",
      b.devBuySol !== null && b.deployer
        ? receipt(external.solscanAccount(b.deployer), esc(sol(b.devBuySol)), "Buy inside the creation transaction")
        : unknown("not visible in the creation transaction"),
    ) +
    kv(
      "SOL sent back to the funder",
      b.funder ? receipt(external.solscanAccount(b.funder), esc(sol(b.sentBackToFunderSol)), "The funder wallet on Solscan") : unknown("needs the funder"),
      b.funder && b.sentBackToFunderSol > 0 ? "r" : "",
    ) +
    kv("Mint authority", mintA, mintCls) +
    kv("Freeze authority", frzA, frzCls) +
    (b.deployer ? kv("Creator's other coins", ext(external.solanaviewDev(ctx, b.deployer), "on SolanaView ↗", 'title="Deployer history on SolanaView"')) : "") +
    `</div>`;
  return (
    `<section id="made"><h2>Who made it</h2>` +
    (graph ? `<div class="split">${lead}${graph}</div>` : lead) +
    familyTree(s, w) +
    facts +
    `</section>`
  );
}

function holderLabel(h: HolderView, groupOf: Map<string, string>, groups: number): [string, string] {
  const group = h.clusterId && groups > 1 ? groupOf.get(h.clusterId) : undefined;
  const linked = group ? `linked, ${group.replace("Group ", "")}` : "linked";
  switch (h.kind) {
    case "bonding-curve":
      return ["bonding curve", "p"];
    case "pool":
      return ["pool", "p"];
    case "burn":
      return ["burned", "p"];
    case "program":
      return ["program", "p"];
    case "creator":
      return ["creator", "r"];
    default:
      if (h.label === "insider") return [h.clusterId ? linked : "launch block", "r"];
      if (h.label === "independent") return ["independent", "g"];
      if (h.label === "infrastructure") return ["pool or program", "p"];
      return ["untraced", "c"];
  }
}

function holdersSection(s: Sticker, w: Wallets): string {
  const c = s.crowd;
  const sp = splitSupply(s);
  if (!sp) {
    return (
      `<section id="holders"><h2>Who holds it</h2>` +
      `<p class="lead">We couldn't read the largest holders, so who holds it is ${UNKNOWN.toLowerCase()}.</p>` +
      `<div class="kvs">${kv("Holders checked", unknown("no holder list"))}${kv("Independent share", unknown("needs the holder list"))}</div>` +
      `</section>`
    );
  }
  const n = c.topHolders.length;
  const rest = round1(sp.untraced + sp.outside);
  const iw = infraWord(s);
  const seg = (v: number, cls: string, name: string) =>
    v > 0 ? `<span class="${cls}" style="flex-grow:${v}" title="${esc(`${name}: ${pct(v)} of total supply`)}"></span>` : "";
  const bar =
    `<div class="bar" role="img" aria-label="${esc(
      `Total supply: ${pct(sp.insider)} linked, ${pct(sp.infra)} ${iw}, ${pct(sp.independent)} independent, ${pct(rest)} untraced or not checked`,
    )}">` +
    seg(sp.insider, "lk", "Linked") +
    seg(sp.infra, "ps", iw) +
    seg(sp.independent, "in", "Independent") +
    seg(rest, "ut", "Untraced or not checked") +
    `</div>`;
  const leg = (v: number, label: string, cls = "") => `<span${cls ? ` class="${cls}"` : ""}><b>${esc(pct(v))}</b>${esc(label)}</span>`;
  const legend =
    `<div class="leg">` +
    leg(sp.insider, "linked") +
    leg(sp.infra, iw) +
    leg(sp.independent, "independent") +
    (rest > 0 ? leg(rest, "untraced", "dim") : "") +
    `</div>`;

  const h = s.headline;
  const circ =
    h.independentPct !== null && h.insiderPct !== null
      ? ` Of ${esc(circulatingWords(s))}, independent wallets hold <b>${esc(pct(h.independentPct))}</b> and linked wallets <b>${esc(pct(h.insiderPct))}</b>.`
      : ` Too much of the supply is untraced to give insider and independent shares of ${esc(circulatingWords(s))}.`;
  const untr =
    rest > 0
      ? ` Untraced: ${esc(pct(sp.untraced))} in top holders we couldn't trace and ${esc(pct(sp.outside))} outside the top ${n}, counted as neither linked nor independent.`
      : "";
  const explain = `<p class="fine">Shares of total supply.${circ}${untr}</p>`;

  const groupOf = new Map<string, string>();
  c.clusters.forEach((cl, i) => groupOf.set(cl.id, groupName(i)));
  const row = (hv: HolderView, i: number) => {
    const [label, cls] = holderLabel(hv, groupOf, c.clusters.length);
    const from = hv.funder ? ` title="${esc(`first SOL from ${w.short(hv.funder)}`)}"` : "";
    const infra = hv.label === "infrastructure";
    return (
      `<tr><td class="rk">${i + 1}</td><td>${w.link(hv.owner, infra ? "d" : "")}</td>` +
      `<td class="pc">${receipt(external.solscanAccount(hv.owner), esc(pct(hv.pctSupply)), "Wallet on Solscan")}</td>` +
      `<td class="lb ${cls}"${from}>${esc(label)}</td></tr>`
    );
  };
  const outsideRow =
    sp.outside > 0
      ? `<tr class="dim"><td class="rk"></td><td>outside the top ${n}</td><td class="pc">${esc(pct(sp.outside))}</td><td class="lb c">not checked</td></tr>`
      : "";
  const table = (list: HolderView[], offset: number, last: boolean) =>
    `<table class="hold"><colgroup><col class="rk"><col><col class="pc"><col class="lb"></colgroup><thead class="vh"><tr><th scope="col">Rank</th><th scope="col">Wallet</th><th scope="col">Share of supply</th><th scope="col">What it is</th></tr></thead><tbody>` +
    list.map((hv, i) => row(hv, i + offset)).join("") +
    (last ? outsideRow : "") +
    `</tbody></table>`;
  const FIRST = 10;
  const head = c.topHolders.slice(0, FIRST);
  const more = c.topHolders.slice(FIRST);
  const rows =
    table(head, 0, more.length === 0) +
    (more.length ? `<details class="more"><summary>${esc(`Show ${plural(more.length, "more holder")}`)}</summary>${table(more, FIRST, true)}</details>` : "");

  const groups = c.clusters.length
    ? `<h3>Linked groups</h3><ul class="grp">${c.clusters.map((cl, i) => clusterItem(cl, i, w)).join("")}</ul>`
    : `<p class="fine">No linked groups among the top ${n} holders.</p>`;

  return (
    `<section id="holders"><h2>Who holds it</h2>${bar}${legend}${explain}${rows}${groups}` +
    `<p class="fine">Wallets with ${LIMITS.VETERAN_SIGNATURES}+ transactions have too much history to trace; they count as independent unless they bought in the launch block.</p>` +
    `</section>`
  );
}

function clusterItem(cl: Cluster, i: number, w: Wallets): string {
  const reasons = cl.reasons.map((r) => (r === "shared-funder" && cl.funder ? `${esc(REASON_TEXT[r])} (${w.link(cl.funder, "f")})` : esc(REASON_TEXT[r])));
  return (
    `<li><span class="gn">${esc(groupName(i))}</span><span>${esc(plural(cl.wallets.length, "wallet"))} hold ${esc(pct(cl.pctSupply))} of supply.` +
    `${reasons.length ? ` Linked by: ${reasons.join("; ")}.` : ""}<br><span class="ws">${cl.wallets.map((a) => w.link(a)).join(" ")}</span></span></li>`
  );
}

function marketSection(s: Sticker): string {
  const m = s.market;
  if (!m) {
    return `<section id="market"><h2>Market</h2><div class="kvs">${kv("Trading", unknown("DEX Screener had no trading pair when we checked"))}</div></section>`;
  }
  const pair = safeUrl(m.pairUrl) ?? external.dexscreener(s.mint);
  const money = (v: number | null, fmt: (n: number | null) => string, title: string) =>
    v !== null ? receipt(pair, esc(fmt(v)), title) : unknown("not reported");
  const ratio =
    m.liquidityUsd !== null && m.marketCapUsd !== null && m.marketCapUsd > 0
      ? `<small class="rs"> · ${esc(pct((m.liquidityUsd / m.marketCapUsd) * 100))} of market cap</small>`
      : "";
  const dex = cleanLabel(m.dex, 32);
  return (
    `<section id="market"><h2>Market</h2><div class="kvs">` +
    kv("Price", money(m.priceUsd, usdPrice, "Price on DEX Screener")) +
    kv("Market cap", money(m.marketCapUsd, usdFull, "Market cap on DEX Screener")) +
    kv("Liquidity", money(m.liquidityUsd, usdFull, "Liquidity on DEX Screener") + ratio) +
    kv("Volume, 24 hours", money(m.volume24hUsd, usdFull, "24-hour volume on DEX Screener")) +
    kv("Price change, 24 hours", m.priceChange24hPct !== null ? esc(pctChange(m.priceChange24hPct)) : unknown("not reported")) +
    kv("Trading on", dex ? ext(pair, esc(dex)) : unknown("not reported")) +
    kv("Pair created", m.pairCreatedAt !== null ? esc(dayTime(m.pairCreatedAt)) : unknown("not reported")) +
    `</div><p class="fine">From DEX Screener; can lag by a minute or two.</p></section>`
  );
}

const DOT: Record<Severity, string> = { danger: "r", warning: "r", caution: "y", good: "g", info: "i", unknown: "c" };

function notesSection(s: Sticker, w: Wallets): string {
  const MAX_EVIDENCE = 4;
  const evidence = (ev: string[]) => {
    if (ev.length === 0) return "";
    const fmt = (e: string) => (isSignature(e) ? w.tx(e) : w.link(e));
    const extra = ev.length - MAX_EVIDENCE;
    return `<small class="ws">${ev.slice(0, MAX_EVIDENCE).map(fmt).join(" ")}${extra > 0 ? ` <span class="c">+${extra}</span>` : ""}</small>`;
  };
  const item = (f: Finding, i: number) =>
    `<li id="n${i + 1}" class="${DOT[f.severity] ?? "c"}"><i></i><div><p>${esc(f.title)}</p><small>${esc(f.detail)}</small>` +
    `${f.severity === "info" || f.severity === "good" ? "" : evidence(f.evidence)}</div></li>`;
  const gaps = s.coverage.notes.map((n) => `<li class="c"><i></i><div><p>${esc(n)}</p></div></li>`);
  if (!s.coverage.complete) gaps.unshift(`<li class="c"><i></i><div><p>Some steps didn't finish in time. Anything marked Unknown above is why.</p></div></li>`);
  const items = s.findings.map(item).concat(gaps);
  return (
    `<section id="notes"><h2>Notes</h2>` +
    (items.length ? `<ul class="notes">${items.join("")}</ul>` : `<p class="fine">No notes. Every step finished; each check still has limits, listed on the <a href="${paths.methodology}">methodology</a> page.</p>`) +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** Text for "share on X / Telegram". Neutral: numbers only, no advice. */
export function shareText(s: Sticker): string {
  const title = coinTitle(s.name, s.symbol);
  const parts = [`MSRP window sticker for ${title}: ${starText(s.ratings.overall.stars)} overall`];
  if (s.headline.independentPct !== null) parts.push(`${pct(s.headline.independentPct)} of circulating supply held by independent wallets`);
  return `${parts.join(", ")}.`;
}

/** The one-line monospace footer from real coverage data: "31 rpc calls · 6.4s · checked 14 Oct 18:00 UTC". */
export function coverageLine(s: Sticker): string {
  const cv = s.coverage;
  const bits = [plural(cv.rpcRequests, "rpc call"), seconds(cv.elapsedMs), `checked ${dayTime(s.computedAt)}`];
  return esc(bits.join(" · "));
}

/** The sticker plus share/embed links and, only at 4+ overall stars, the quiet SolanaView line. */
export function renderStickerBody(ctx: PageContext, s: Sticker): string {
  const w = new Wallets(s);
  const url = abs(ctx, paths.coin(s.mint));
  const badgeUrl = abs(ctx, paths.badge(s.mint));
  const text = shareText(s);
  const embed = `<a href="${esc(url)}"><img src="${esc(badgeUrl)}" alt="MSRP window sticker" height="20"></a>`;

  const sticker =
    `<article id="sticker" data-mint="${esc(s.mint)}">` +
    coinHeader(s) +
    hero(s) +
    rates(s) +
    madeSection(ctx, s, w) +
    holdersSection(s, w) +
    marketSection(s) +
    notesSection(s, w) +
    `</article>`;

  const acts =
    `<nav class="acts" aria-label="Share and export">` +
    `<button type="button" class="cp" data-copy="${esc(url)}" hidden>Copy link</button>` +
    ext(external.shareX(text, url), "Post on X") +
    ext(external.shareTelegram(text, url), "Telegram") +
    `<a href="#embed">Embed</a>` +
    `<a href="${esc(paths.api(s.mint))}">JSON</a>` +
    ext(external.solscanToken(s.mint), "Solscan ↗") +
    `</nav>`;

  const embedBlock =
    `<section class="embed" id="embed"><h2>Embed</h2>` +
    `<p class="fine">Put this badge on your site. It always shows the latest sticker.</p>` +
    `<p><img src="${esc(paths.badge(s.mint))}" alt="MSRP badge preview" height="20"></p>` +
    `<textarea id="embed-code" readonly rows="3" aria-label="Badge HTML">${esc(embed)}</textarea>` +
    `<button type="button" class="cp" data-copy-from="embed-code" hidden>Copy code</button>` +
    `</section>`;

  const promo =
    s.ratings.overall.stars !== null && s.ratings.overall.stars >= 4
      ? `<aside class="promo" aria-label="Sponsored, separate from ratings"><small>Separate from ratings</small>` +
        `<p>Sponsored listings are separate from MSRP ratings — payment never changes a sticker. ` +
        `Coins with 4 or more stars can buy one on SolanaView, run by the same team. ` +
        `${ext(external.solanaviewPromote(ctx, s.mint), "SolanaView listings ↗")}</p></aside>`
      : "";

  const disclaimer = `<p class="dis">${esc(s.disclaimer)} Payment never changes a sticker.</p>`;
  return sticker + acts + promo + embedBlock + disclaimer;
}
