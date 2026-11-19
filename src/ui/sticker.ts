/**
 * THE STICKER for one coin, in the owner's final "simple" design (docs/DESIGN.md,
 * docs/design/min/sticker.html). Almost no words on the main view:
 *
 *   name + mono subline, ONE big purple number with a short caption, the wallet-family graph,
 *   four hairline rows (rating / creator / family / holders), up to four 1-3 word flags,
 *   then ONE collapsed <details> ("details ↓") holding everything else, tersely.
 *
 * Rules kept from every earlier version:
 * - Every number links to its evidence (Solscan, DEX Screener or the rows inside details).
 * - Every wallet carries data-w / data-g so msrp.js can highlight it and every wallet linked to it.
 * - Unknown is printed as unknown (with the reason inside details), never as 0.
 * - Shares: crowd numbers are % of TOTAL supply; headline insider/independent are % of
 *   CIRCULATING supply (outside the curve, pools and burn). Holders outside the top 20 are
 *   neither insider nor independent: they are shown as untraced, never as independent.
 */
import type { Cluster, ClusterReason, Finding, HolderView, PageContext, Rating, Severity, Stars, Sticker } from "../types";
import { LIMITS, THRESHOLDS } from "../config";
import { cleanLabel, esc, isSignature, safeUrl } from "./escape";
import {
  dateTime,
  dayTime,
  iso,
  makeShortener,
  minsShort,
  pct,
  pctChange,
  pctNum,
  plural,
  seconds,
  sol,
  starLabel,
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

const UNK = "unknown";
const FAST = THRESHOLDS.FAST_DEV_SELL_MIN;

/** Display name for a coin: "Example Coin ($EXAMPLE)", with fallbacks. Not escaped. */
export function coinTitle(name: string | null, symbol: string | null): string {
  const n = cleanLabel(name, 48);
  const s = cleanLabel(symbol, 16);
  if (n && s) return `${n} ($${s})`;
  if (n) return n;
  if (s) return `$${s}`;
  return "Unnamed coin";
}

/**
 * The independent share every visible headline uses: a share of TOTAL supply, like the main view's
 * holders row and the sticker price (the circulating-supply share appears only inside details).
 * Older stickers without the field fall back to the independent holders' own shares.
 */
export function independentShown(s: Sticker): number | null {
  const h = s.headline;
  if (h.independentPct === null || h.independentPct === undefined) return null;
  if (typeof h.independentOfTotalPct === "number" && Number.isFinite(h.independentOfTotalPct)) return h.independentOfTotalPct;
  const sum = (s.crowd?.topHolders ?? []).filter((v) => v.label === "independent").reduce((a, v) => a + v.pctSupply, 0);
  return Math.round(sum * 100) / 100;
}

export function isExample(s: Sticker): boolean {
  return s.coverage.notes.some((n) => /^example data/i.test(n));
}

/** Five rating dots, `stars` of them purple; "not rated" when there was too little evidence. */
export function dots(stars: Stars, small = false): string {
  if (stars === null) return `<span class="nr">not rated</span>`;
  let out = "";
  for (let i = 0; i < 5; i++) out += i < stars ? `<i class="on"></i>` : "<i></i>";
  return `<span class="dots${small ? " sm" : ""}" role="img" aria-label="${stars} of 5">${out}</span>`;
}

/** Kept for callers of the old API: a rating as dots. */
export function stars(r: Rating): string {
  return dots(r.stars);
}

/** "unknown" plus a short reason, so a missing number is never mistaken for zero (readable grey, not dim). */
function unknown(reason: string): string {
  return `<span class="t2">${UNK} · ${esc(reason)}</span>`;
}

/** A bare "unknown" value on the main view. */
const UNKNOWN = `<span class="t2">${UNK}</span>`;

/** A value that links to its evidence (no underline until hover). `text` must be escaped. */
function ev(href: string, text: string, title: string, cls = ""): string {
  const c = cls ? ` class="${cls}"` : "";
  return /^https?:/.test(href)
    ? `<a${c} href="${esc(href)}" rel="noopener nofollow" target="_blank" title="${esc(title)}">${text}</a>`
    : `<a${c} href="${esc(href)}" title="${esc(title)}">${text}</a>`;
}

const DOT = ` <span class="t3">·</span> `;

const REASON_TEXT: Record<ClusterReason, string> = {
  "shared-funder": "same funder",
  "similar-funding": "similar funding",
  "same-block-buy": "launch block",
  "creator-funded": "creator-funded",
  "creator-sent-tokens": "from creator",
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

  /** A wallet linked to Solscan, shortened, monospace, highlightable. `cls`: a = creator (purple), y = funder (yellow), t3 = dim. */
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
  /** untraced + outside: neither linked nor independent. */
  rest: number;
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
  return { infra, insider, independent, untraced, outside, rest: round1(untraced + outside) };
}

/** Short word for the infrastructure slice: "curve", "pools", "burned", "curve & pools". */
function infraWord(s: Sticker): string {
  const kinds = new Set(s.crowd.topHolders.filter((h) => h.label === "infrastructure").map((h) => h.kind));
  const curve = kinds.has("bonding-curve");
  const pools = kinds.has("pool") || kinds.has("program") || kinds.has("wallet");
  if (curve && pools) return "curve & pools";
  if (curve) return "curve";
  if (!pools && kinds.has("burn")) return "burned";
  return "pools";
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

function coinHeader(s: Sticker, w: Wallets): string {
  const name = cleanLabel(s.name, 48);
  const sym = cleanLabel(s.symbol, 16);
  const main = name ?? (sym ? `$${sym}` : "Unnamed coin");
  const second = name && sym ? ` <span>$${esc(sym)}</span>` : "";
  const bits = [ev(external.solscanToken(s.mint), esc(w.short(s.mint)), s.mint)];
  if (s.build.launchpad === "pump.fun") bits.push("pump.fun");
  const b = s.build;
  if (b.createdAt !== null && s.computedAt >= b.createdAt) {
    bits.push(
      `<time datetime="${iso(b.createdAt)}" title="${esc(`created ${dateTime(b.createdAt)}`)}">${esc(minsShort((s.computedAt - b.createdAt) / 60_000))}</time>`,
    );
  }
  if (isExample(s)) bits.push(`<span class="ex">example data</span>`);
  return `<header class="coin"><h1>${esc(main)}${second}</h1><p class="sub">${bits.join(" · ")}</p></header>`;
}

/** Why there is no sticker price, in two or three words. */
function missingPrice(s: Sticker): string {
  if (s.headline.marketCapUsd === null) return "market cap unknown";
  if (s.crowd.topHolders.length === 0) return "holders unknown";
  return "holders untraced";
}

function hero(s: Sticker, w: Wallets): string {
  const h = s.headline;
  const pairUrl = safeUrl(s.market?.pairUrl) ?? external.dexscreener(s.mint);
  let num: string;
  let cap: string;
  if (h.stickerPriceUsd !== null) {
    num = ev("#holders", esc(usdShort(h.stickerPriceUsd)), "Sticker price: market cap × share of total supply held by independent wallets", "big");
    cap =
      h.marketCapUsd !== null
        ? `independent of ${ev(pairUrl, `<b>${esc(usdShort(h.marketCapUsd))}</b>`, "Market cap on DEX Screener")}`
        : "independent";
  } else {
    num = `<span class="big unk" title="Sticker price unknown">?<span class="vh"> unknown</span></span>`;
    cap = `<span class="t2">${esc(missingPrice(s))}</span>`;
  }
  return `<div class="hero"><div>${num}<p class="cap">${cap}</p></div>${walletGraph(s, w)}</div>`;
}

function row(label: string, value: string): string {
  return `<div class="row"><dt>${esc(label)}</dt><dd class="v">${value}</dd></div>`;
}

function creatorValue(s: Sticker, w: Wallets): string {
  const b = s.build;
  if (!b.deployer) return UNKNOWN;
  const parts = [w.link(b.deployer, "a"), `<span class="t3">←</span>`];
  if (!b.funder) {
    parts.push(UNKNOWN);
    return parts.join("");
  }
  parts.push(w.link(b.funder, "y"));
  if (b.deployerFundedBeforeLaunchMin !== null) {
    parts.push(
      ev(external.solscanAccount(b.deployer), esc(`${minsShort(b.deployerFundedBeforeLaunchMin)} before launch`), "The creator's first incoming SOL, on Solscan", "t3"),
    );
  }
  return parts.join("");
}

/** Fast-sell count as text, or null when a zero would only mean "not fully read" (never shown as 0). */
function fastText(fast: number, complete: boolean): string | null {
  return fast > 0 || complete ? `${fast} sold <${FAST}m` : null;
}

function familyValue(s: Sticker): string {
  const b = s.build;
  // Never traced: launches and sells are unknown, never "1 launch · 0 sold".
  if (!b.deployer || b.traced !== true) return UNKNOWN;
  const complete = b.traceComplete === true;
  const deployer = b.family.find((m) => m.role === "deployer");
  const wallets = b.funder
    ? ev("#tree", esc(plural(b.familySize, "wallet")), "The creator plus the other wallets its funder paid")
    : `<span class="t2">wallets ${UNK}</span>`;
  const launches = b.funder ? b.familyLaunchCount : (deployer?.launches ?? b.deployerLaunchCount);
  const fast = b.funder ? b.familyFastDevSellCount : (deployer?.launchesWithFastDevSell ?? b.familyFastDevSellCount);
  const parts = [wallets];
  if (launches > 0) {
    parts.push(ev("#tree", esc(plural(launches, "launch", "launches")), "Launches seen in the transactions we sampled"));
    const ft = fastText(fast, complete);
    parts.push(
      ft
        ? ev("#tree", esc(ft), `Launches where the launching wallet sold within ${FAST} minutes`, fast > 0 ? "r" : "t3")
        : `<span class="t2">sells ${UNK}</span>`,
    );
  } else {
    parts.push(complete ? `<span class="t3">no launches seen</span>` : `<span class="t2">launches ${UNK}</span>`);
  }
  return parts.join(DOT);
}

function holdersValue(s: Sticker, sp: Split | null): string {
  if (!sp) return UNKNOWN;
  const iw = infraWord(s);
  const seg = (v: number, color: string) => (v > 0 ? `<span style="flex:${v};background:${color}"></span>` : "");
  const label =
    `Total supply: ${pct(sp.insider)} linked, ${pct(sp.infra)} ${iw}, ${pct(sp.independent)} independent` +
    `${sp.rest > 0 ? `, ${pct(sp.rest)} untraced or not checked` : ""}`;
  const n = (v: number, cls: string, what: string) => ev("#holders", esc(pctNum(v)), `${what}: ${pct(v)} of total supply`, cls);
  const nums = [n(sp.insider, sp.insider > 0 ? "r" : "t3", "Linked"), n(sp.infra, "t3", iw), n(sp.independent, "g", "Independent")];
  if (sp.rest > 0) nums.push(n(sp.rest, "t3", "Untraced or not checked"));
  return (
    `<a class="bar" href="#holders" aria-label="${esc(label)}" title="${esc(label)}">` +
    seg(sp.insider, "var(--red)") +
    seg(sp.infra, "#2c2c32") +
    seg(sp.independent, "var(--grn)") +
    seg(sp.rest, "#222227") +
    `</a><span class="nums">${nums.join(`<span class="t3">/</span>`)}</span>`
  );
}

interface Flag {
  text: string;
  /** The underlying severity: it decides the order, so a danger always beats a warning. */
  level: Severity;
  href: string;
}

const SEV: Record<Severity, "r" | "y" | "g" | "c"> = { danger: "r", warning: "r", caution: "y", good: "g", info: "c", unknown: "c" };
/** Most important first: danger, warning, caution, unknown, info, good. */
const RANK: Record<Severity, number> = { danger: 0, warning: 1, caution: 2, unknown: 3, info: 4, good: 5 };

/** Up to four 1-3 word flags, the most important first (by severity; a danger is never pushed off). */
function flags(s: Sticker, sp: Split | null, noteId: Map<string, string>): Flag[] {
  const b = s.build;
  const find = (id: string) => s.findings.find((f) => f.id === id);
  const out: Flag[] = [];
  const add = (text: string, level: Severity, href: string) => out.push({ text, level, href });
  const fromFinding = (id: string, text: string, fallback = "#notes") => {
    const f = find(id);
    if (f) add(text, f.severity, `#${noteId.get(f.id) ?? fallback.slice(1)}`);
  };

  if (!b.deployer) add("creator unknown", "unknown", "#family");
  // "launch & sell" already says "fresh creator" + "creator sold": show it instead of both.
  const launchAndSell = !!find("build.launch-and-sell");
  fromFinding("build.launch-and-sell", "launch & sell");
  fromFinding("build.factory-pattern", "launch factory");
  if (!find("build.factory-pattern")) {
    fromFinding("build.fast-dev-sells", "fast dev sells");
    fromFinding("build.sweep", "SOL sent back");
  }
  if (!launchAndSell) fromFinding("build.current-dev-sell", "creator sold");

  if (!sp) add("holders unknown", "unknown", "#holders");
  else if (s.headline.insiderPct === null) add("holders untraced", "unknown", "#holders");
  else {
    const f = find("crowd.insiders");
    const level: Severity = f ? f.severity : sp.insider > 0 ? "info" : "good";
    add(sp.insider > 0 ? `linked ${pct(sp.insider)}` : "no links found", level, f ? `#${noteId.get(f.id) ?? "holders"}` : "#holders");
  }

  if (!launchAndSell) fromFinding("build.fresh-deployer", "fresh creator");
  if (b.deployer && !b.funder) add("funder unknown", "unknown", "#family");

  const set = [b.mintAuthority, b.freezeAuthority].map((a) => typeof a === "string" && a !== "unknown");
  if (set[0] || set[1]) add(set[0] && set[1] ? "mint & freeze on" : set[0] ? "mint on" : "freeze on", "danger", "#family");
  else if (b.mintAuthority === "unknown" || b.freezeAuthority === "unknown") add("authorities unknown", "unknown", "#family");
  else add("authorities off", "good", "#family");

  fromFinding("crowd.bundle", "launch-block buys");
  const conc = find("crowd.concentration");
  if (conc) {
    const top = Math.max(0, ...s.crowd.topHolders.filter((h) => h.label !== "infrastructure").map((h) => h.pctSupply));
    add(`top wallet ${pct(top)}`, conc.severity, `#${noteId.get(conc.id) ?? "holders"}`);
  }
  if (!s.market) add("no market", "unknown", "#market");
  else {
    fromFinding("market.low-liquidity", "thin liquidity");
    fromFinding("market.liquidity-anomaly", "liquidity above cap");
  }
  if (!s.coverage.complete) add("partial check", "unknown", "#notes");

  return out
    .map((f, i) => ({ f, i }))
    .sort((a, z) => RANK[a.f.level] - RANK[z.f.level] || a.i - z.i)
    .slice(0, 4)
    .map((x) => x.f);
}

// ---------------------------------------------------------------------------
// Details (collapsed): everything else, tersely
// ---------------------------------------------------------------------------

function kvList(rows: [string, string][], cls = ""): string {
  return `<dl class="kv${cls ? ` ${cls}` : ""}">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}

function ratingsBlock(s: Sticker): string {
  const r = s.ratings;
  const line = (k: string, rt: Rating): [string, string] => [k, `${dots(rt.stars, true)}<span class="t3">${esc(rt.reason)}</span>`];
  return (
    `<section id="ratings"><h2>ratings</h2>` +
    kvList([line("overall", r.overall), line("made", r.build), line("holds", r.crowd), line("market", r.market)], "rt") +
    `<p class="t3">transparency of ownership, not price · <a href="${paths.methodology}#overall.stars">how</a></p></section>`
  );
}

/** The family as aligned monospace text, like a file listing. */
function familyTree(s: Sticker, w: Wallets): string {
  const b = s.build;
  if (!b.deployer) return `<p class="t2">creator ${UNK} · creation transaction not found</p>`;
  const traced = b.traced === true;
  const complete = b.traceComplete === true;
  const held = new Map(s.crowd.topHolders.map((h) => [h.owner, h]));
  const deployer = b.family.find((m) => m.role === "deployer");
  const siblings = b.family.filter((m) => m.role === "sibling");
  const MAX = 8;

  interface Line {
    addr: string | null;
    text: string;
    tag: string;
    tagCls: string;
    launches: number;
    fast: number;
  }
  const rows: Line[] = [];
  const holdTag = (addr: string): [string, string] => {
    const h = held.get(addr);
    return h && h.label === "insider" ? [`holds ${pct(h.pctSupply)}`, "r"] : ["", ""];
  };
  rows.push({
    addr: b.deployer,
    text: w.short(b.deployer),
    tag: "this coin",
    tagCls: "a",
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
  // Untraced: launches are unknown (the current coin alone would read "1 launch · 0 sold").
  const launchText = (n: number) => (!traced ? `launches ${UNK}` : n === 0 ? "no launches" : plural(n, "launch", "launches"));
  const lw = Math.max(...rows.map((r) => launchText(r.launches).length));
  const sp = (n: number) => " ".repeat(Math.max(0, n));

  const lines: string[] = [];
  if (b.funder) {
    const f = w.short(b.funder);
    lines.push(`${w.link(b.funder, "y")}${sp(3 + addrW + 2 - f.length)}<span class="t3">funder</span>`);
  } else {
    lines.push(`<span class="t2">? funder ${UNK}</span>`);
  }
  rows.forEach((r, i) => {
    const branch = `<span class="t3">${i === rows.length - 1 ? "└─ " : "├─ "}</span>`;
    const addr = r.addr ? w.link(r.addr, r.addr === b.deployer ? "a" : "") : `<span class="t3">${esc(r.text)}</span>`;
    const lt = launchText(r.launches);
    const tag = r.tag ? `<span class="${r.tagCls}">${esc(r.tag)}</span>` : "";
    const ft = fastText(r.fast, complete);
    const sells =
      traced && r.launches > 0
        ? `  <span class="${ft ? (r.fast > 0 ? "r" : "t3") : "t2"}">${esc(ft ?? `sells ${UNK}`)}</span>`
        : "";
    lines.push(
      `${branch}${addr}${sp(addrW - r.text.length + 2)}${tag}${sp(tagW - r.tag.length + 2)}` +
        `${sp(lw - lt.length)}<span${!traced ? ' class="t2"' : r.launches ? "" : ' class="t3"'}>${esc(lt)}</span>${sells}`,
    );
  });
  return `<pre class="tree" id="tree" aria-label="Family tree">${lines.join("\n")}</pre>`;
}

function authority(v: string | null | "unknown", w: Wallets): string {
  if (v === null) return `<span class="g">off</span>`;
  if (v === "unknown") return unknown("not read");
  return `<span class="r">on</span>${DOT}${w.link(v)}`;
}

function familyBlock(ctx: PageContext, s: Sticker, w: Wallets): string {
  const b = s.build;
  const rows: [string, string][] = [
    [
      "first SOL",
      b.deployerFundedBeforeLaunchMin !== null && b.deployer
        ? ev(external.solscanAccount(b.deployer), esc(`${minsShort(b.deployerFundedBeforeLaunchMin)} before launch`), "The creator wallet on Solscan", b.deployerFundedBeforeLaunchMin <= THRESHOLDS.FRESH_DEPLOYER_MIN ? "y" : "")
        : unknown(b.deployer ? "funding not found" : "needs the creator"),
    ],
    ["dev buy", b.devBuySol !== null && b.deployer ? ev(external.solscanAccount(b.deployer), esc(sol(b.devBuySol)), "Buy inside the creation transaction") : unknown("not visible")],
    [
      "sent back",
      // Measured on a sample of transactions: nothing found is "none seen", never a flat 0.
      b.funder
        ? b.sentBackToFunderSol > 0
          ? ev(external.solscanAccount(b.funder), esc(sol(b.sentBackToFunderSol)), "SOL sent back to the funder, on Solscan", "r")
          : ev(external.solscanAccount(b.funder), "none seen", "No SOL sent back in the transactions we read", "t3")
        : unknown("needs the funder"),
    ],
    ["mint", authority(b.mintAuthority, w)],
    ["freeze", authority(b.freezeAuthority, w)],
    ["created", b.createdAt !== null ? `<time datetime="${iso(b.createdAt)}">${esc(dateTime(b.createdAt))}</time>` : unknown("not found")],
    [
      b.launchpad === "pump.fun" ? "pump.fun" : "launchpad",
      b.launchpad !== "pump.fun"
        ? unknown("not recognised")
        : b.graduated === true
          ? "graduated"
          : b.graduated === false
            ? `curve ${b.curveProgressPct !== null ? esc(pct(b.curveProgressPct)) : UNK}`
            : unknown("curve not read"),
    ],
  ];
  if (b.deployer) rows.push(["history", ext(external.solanaviewDev(ctx, b.deployer), "SolanaView ↗", 'title="Deployer history on SolanaView"')]);
  const sample = !b.deployer
    ? ""
    : b.funder
      ? `sample: ${LIMITS.FUNDER_TX_SAMPLE} funder tx · ≤${LIMITS.MAX_SIBLINGS} wallets · ${LIMITS.LAUNCH_SIGNATURE_SAMPLE} tx each`
      : `funder ${UNK} · first SOL beyond the ${LIMITS.ORIGIN_SIGNATURES} tx we read`;
  return `<section id="family"><h2>family</h2>${familyTree(s, w)}${kvList(rows)}${sample ? `<p class="t3">${esc(sample)}</p>` : ""}</section>`;
}

function holderLabel(h: HolderView, groupOf: Map<string, string>, groups: number): [string, string] {
  const group = h.clusterId && groups > 1 ? groupOf.get(h.clusterId) : undefined;
  switch (h.kind) {
    case "bonding-curve":
      return ["curve", "t3"];
    case "pool":
      return ["pool", "t3"];
    case "burn":
      return ["burned", "t3"];
    case "program":
      return ["program", "t3"];
    case "creator":
      return ["creator", "r"];
    default:
      if (h.label === "insider") return [h.clusterId ? `linked${group ? ` ${group.replace("Group ", "")}` : ""}` : "launch block", "r"];
      if (h.label === "independent") return ["independent", "g"];
      if (h.label === "infrastructure") return ["pool", "t3"];
      return [h.kind === "unknown" ? "program wallet" : "untraced", "t2"];
  }
}

function clusterItem(cl: Cluster, i: number, w: Wallets): string {
  const reasons = cl.reasons.map((r) => esc(REASON_TEXT[r]));
  return (
    `<li><span class="r">${esc(groupName(i).replace("Group ", "group "))}</span>${DOT}${esc(plural(cl.wallets.length, "wallet"))}${DOT}${esc(pct(cl.pctSupply))}` +
    `${reasons.length ? `${DOT}<span class="t3">${reasons.join(", ")}</span>` : ""}` +
    `${cl.funder ? `${DOT}<span class="t3">funder</span> ${w.link(cl.funder, "y")}` : ""}<br>${cl.wallets.map((a) => w.link(a)).join(" ")}</li>`
  );
}

function holdersBlock(s: Sticker, sp: Split | null, w: Wallets): string {
  const c = s.crowd;
  if (!sp) return `<section id="holders"><h2>holders</h2><p class="t2">${UNK} · largest holders not readable</p></section>`;
  const n = c.topHolders.length;
  const iw = infraWord(s);
  const leg = (v: number, color: string, label: string) => `<span><i style="background:${color}"></i>${esc(label)} ${esc(pct(v))}</span>`;
  const legend =
    `<p class="leg">${leg(sp.insider, "var(--red)", "linked")}${leg(sp.infra, "#2c2c32", iw)}${leg(sp.independent, "var(--grn)", "independent")}` +
    `${sp.rest > 0 ? leg(sp.rest, "#3a3a41", "untraced") : ""}</p>`;
  const h = s.headline;
  const circ =
    h.independentPct !== null && h.insiderPct !== null
      ? `of circulating: linked ${pct(h.insiderPct)} · independent ${pct(h.independentPct)}`
      : "circulating shares unknown · untraced wallets hold over half of what we checked";
  const lines = [`% of total supply · ${circ}`];
  if (sp.rest > 0) lines.push(`untraced: ${pct(sp.untraced)} not traced · ${pct(sp.outside)} outside top ${n}, not checked · never counted as independent`);

  const groupOf = new Map<string, string>();
  c.clusters.forEach((cl, i) => groupOf.set(cl.id, groupName(i)));
  const tr = (hv: HolderView, i: number) => {
    const [label, cls] = holderLabel(hv, groupOf, c.clusters.length);
    const from = hv.funder ? ` title="${esc(`first SOL from ${w.short(hv.funder)}`)}"` : "";
    return (
      `<tr><td class="t3">${i + 1}</td><td>${w.link(hv.owner, hv.label === "infrastructure" ? "t3" : "")}</td>` +
      `<td class="pc">${ev(external.solscanAccount(hv.owner), esc(hv.pctSupply > 0 ? pct(hv.pctSupply) : "<0.01%"), "Wallet on Solscan")}</td>` +
      `<td class="${cls}"${from}>${esc(label)}</td></tr>`
    );
  };
  const outside =
    sp.outside > 0 ? `<tr><td></td><td class="t3">outside top ${n}</td><td class="pc t3">${esc(pct(sp.outside))}</td><td class="t3">not checked</td></tr>` : "";
  const table =
    `<table class="hold"><thead class="vh"><tr><th scope="col">Rank</th><th scope="col">Wallet</th><th scope="col">Share of total supply</th><th scope="col">What it is</th></tr></thead><tbody>` +
    c.topHolders.map(tr).join("") +
    outside +
    `</tbody></table>`;
  const groups = c.clusters.length ? `<ul class="grp">${c.clusters.map((cl, i) => clusterItem(cl, i, w)).join("")}</ul>` : `<p class="t3">no linked groups in the top ${n}</p>`;
  return (
    `<section id="holders"><h2>holders</h2>${legend}${lines.map((l) => `<p class="t3">${esc(l)}</p>`).join("")}${table}${groups}` +
    `<p class="t3">${esc(`wallets with ${LIMITS.VETERAN_SIGNATURES}+ tx are not traced: independent unless they bought in the launch block`)}</p></section>`
  );
}

function marketBlock(s: Sticker): string {
  const m = s.market;
  if (!m) return `<section id="market"><h2>market</h2><p class="t2">${UNK} · no trading pair on DEX Screener</p></section>`;
  const pair = safeUrl(m.pairUrl) ?? external.dexscreener(s.mint);
  const money = (v: number | null, fmt: (n: number | null) => string, title: string) => (v !== null ? ev(pair, esc(fmt(v)), title) : unknown("not reported"));
  const ratio =
    m.liquidityUsd !== null && m.marketCapUsd !== null && m.marketCapUsd > 0
      ? `<span class="t3"> · ${esc(pct((m.liquidityUsd / m.marketCapUsd) * 100))} of cap</span>`
      : "";
  const dex = cleanLabel(m.dex, 32);
  return (
    `<section id="market"><h2>market</h2>` +
    kvList([
      ["price", money(m.priceUsd, usdPrice, "Price on DEX Screener")],
      ["market cap", money(m.marketCapUsd, usdFull, "Market cap on DEX Screener")],
      ["liquidity", money(m.liquidityUsd, usdFull, "Liquidity on DEX Screener") + ratio],
      ["volume 24h", money(m.volume24hUsd, usdFull, "24-hour volume on DEX Screener")],
      ["change 24h", m.priceChange24hPct !== null ? esc(pctChange(m.priceChange24hPct)) : unknown("not reported")],
      ["pair", dex ? ext(pair, `${esc(dex)} ↗`) : unknown("not reported")],
      ["pair created", m.pairCreatedAt !== null ? esc(dayTime(m.pairCreatedAt)) : unknown("not reported")],
    ]) +
    `<p class="t3">DEX Screener · can lag a minute or two</p></section>`
  );
}

/** Stable, unique element ids for the findings, so flags can link to them. */
function noteIds(s: Sticker): Map<string, string> {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  for (const f of s.findings) {
    if (ids.has(f.id)) continue;
    let id = `f-${f.id.replace(/[^A-Za-z0-9_.-]/g, "-")}`;
    while (used.has(id)) id += "-";
    used.add(id);
    ids.set(f.id, id);
  }
  return ids;
}

function notesBlock(s: Sticker, w: Wallets, ids: Map<string, string>): string {
  const MAX_EVIDENCE = 4;
  const evidence = (list: string[]) => {
    if (list.length === 0) return "";
    const fmt = (e: string) => (isSignature(e) ? w.tx(e) : w.link(e, "t3"));
    const extra = list.length - MAX_EVIDENCE;
    return ` <span class="evd">${list.slice(0, MAX_EVIDENCE).map(fmt).join(" ")}${extra > 0 ? ` <span class="t3">+${extra}</span>` : ""}</span>`;
  };
  const seen = new Set<string>();
  const item = (f: Finding) => {
    const id = seen.has(f.id) ? "" : ` id="${esc(ids.get(f.id) ?? "")}"`;
    seen.add(f.id);
    const ev = f.severity === "info" || f.severity === "good" ? "" : evidence(f.evidence);
    return `<li><details class="nd"${id}><summary><i class="${SEV[f.severity]}"></i>${esc(f.title)}</summary><p>${esc(f.detail)}${ev}</p></details></li>`;
  };
  const gap = (t: string) => `<li><p class="nd"><i class="c"></i><span class="t3">${esc(t)}</span></p></li>`;
  const gaps = s.coverage.notes.map(gap);
  if (!s.coverage.complete) gaps.unshift(gap("some steps didn't finish in time · anything missing is shown as unknown"));
  const items = s.findings.map(item).concat(gaps);
  return `<section id="notes"><h2>notes</h2>${items.length ? `<ul class="notes">${items.join("")}</ul>` : `<p class="t3">no notes</p>`}</section>`;
}

function shareBlock(ctx: PageContext, s: Sticker): string {
  const url = abs(ctx, paths.coin(s.mint));
  const badgeUrl = abs(ctx, paths.badge(s.mint));
  const text = shareText(s);
  const embed = `<a href="${esc(url)}"><img src="${esc(badgeUrl)}" alt="MSRP window sticker" height="20"></a>`;
  const pair = safeUrl(s.market?.pairUrl) ?? external.dexscreener(s.mint);
  return (
    `<section id="share"><h2>share</h2><p class="links">` +
    `<button type="button" class="cp" data-copy="${esc(url)}" hidden>copy link</button>` +
    ext(external.shareX(text, url), "x ↗") +
    ext(external.shareTelegram(text, url), "telegram ↗") +
    `<a href="${esc(paths.api(s.mint))}">json</a>` +
    ext(external.solscanToken(s.mint), "solscan ↗") +
    ext(pair, "dexscreener ↗") +
    `<a href="${paths.methodology}">how</a>` +
    `</p><div class="embed" id="embed"><img src="${esc(paths.badge(s.mint))}" alt="MSRP badge preview" height="20">` +
    `<button type="button" class="cp" data-copy-from="embed-code" hidden>copy embed</button>` +
    `<textarea id="embed-code" readonly rows="3" aria-label="Badge HTML">${esc(embed)}</textarea></div></section>`
  );
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** Text for "share on X / Telegram". Neutral: numbers only, no advice. */
export function shareText(s: Sticker): string {
  const title = coinTitle(s.name, s.symbol);
  const parts = [`MSRP window sticker for ${title}: ${starText(s.ratings.overall.stars)} overall`];
  const ind = independentShown(s);
  if (ind !== null) parts.push(`${pct(ind)} of supply held by independent wallets`);
  return `${parts.join(", ")}.`;
}

/** The one-line monospace footer from real coverage data: "32 calls · 6.4s · 14 Oct 18:00 UTC". */
export function coverageLine(s: Sticker): string {
  const cv = s.coverage;
  return esc([plural(cv.rpcRequests + cv.dexRequests, "call"), seconds(cv.elapsedMs), dayTime(s.computedAt)].join(" · "));
}

/** The sticker: the tiny main view plus ONE collapsed details block with everything else. */
export function renderStickerBody(ctx: PageContext, s: Sticker): string {
  const w = new Wallets(s);
  const sp = splitSupply(s);
  const ids = noteIds(s);
  const overall = s.ratings.overall;

  const rows =
    `<dl class="rows">` +
    row("rating", `<a href="#ratings" title="${esc(`${starLabel(overall.stars)} overall: ${overall.reason}`)}">${dots(overall.stars)}</a>`) +
    row("creator", creatorValue(s, w)) +
    row("family", familyValue(s)) +
    row("holders", holdersValue(s, sp)) +
    `</dl>`;

  const fl = flags(s, sp, ids);
  const flagList = fl.length
    ? `<ul class="flags">${fl.map((f) => `<li><a href="${esc(f.href)}"><i class="${SEV[f.level]}"></i>${esc(f.text)}</a></li>`).join("")}</ul>`
    : "";

  const promo =
    overall.stars !== null && overall.stars >= 4
      ? `<aside class="promo" aria-label="Sponsored, separate from ratings"><span class="t3">sponsored · separate from ratings · payment never changes a sticker</span>` +
        `${ext(external.solanaviewPromote(ctx, s.mint), "SolanaView listing ↗")}</aside>`
      : "";

  const details =
    `<details class="more" id="more"><summary>details ↓</summary><div class="dt">` +
    ratingsBlock(s) +
    familyBlock(ctx, s, w) +
    holdersBlock(s, sp, w) +
    marketBlock(s) +
    notesBlock(s, w, ids) +
    shareBlock(ctx, s) +
    promo +
    `<p class="dis">${esc(s.disclaimer)} Payment never changes a sticker.</p>` +
    `</div></details>`;

  return `<article id="sticker" data-mint="${esc(s.mint)}">${coinHeader(s, w)}${hero(s, w)}${rows}${flagList}${details}</article>`;
}
