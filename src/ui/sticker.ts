/**
 * THE STICKER: a printed window label for one coin.
 *
 * Design rules (docs/DESIGN.md): white paper, black ink, 1px rules, blue links, red only for
 * warnings. Every number links to its evidence ("receipts", dotted underline). Every wallet
 * carries data-w / data-g attributes so msrp.js can highlight it, and every wallet linked to it,
 * across the whole page. Unknown values say "Unknown" and why; never 0.
 */
import type { Cluster, ClusterReason, Finding, HolderView, PageContext, Rating, Severity, Sticker } from "../types";
import { LIMITS, THRESHOLDS } from "../config";
import { cleanLabel, esc, isSignature, safeUrl } from "./escape";
import {
  UNKNOWN,
  dateTime,
  iso,
  makeShortener,
  minutes,
  pct,
  pctChange,
  plural,
  sol,
  starLabel,
  starText,
  usdFull,
  usdPrice,
  usdShort,
} from "./format";
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

/** "Unknown" plus a short reason, so a missing number is never mistaken for zero. */
function unknown(reason: string): string {
  return `<span class="u">${UNKNOWN}</span> <small class="why">${esc(reason)}</small>`;
}

/** Plain stars, never bold; screen readers hear "2 of 5 stars". */
export function stars(r: Rating): string {
  const text = starText(r.stars);
  return r.stars === null
    ? `<span class="st nr">${text}</span>`
    : `<span class="st" role="img" aria-label="${starLabel(r.stars)}">${text}</span>`;
}

/** A dotted-underlined number that links to the evidence behind it. `text` must be escaped. */
function receipt(href: string, text: string, title: string): string {
  const external = /^https?:/.test(href);
  return external
    ? `<a class="r" href="${esc(href)}" rel="noopener nofollow" target="_blank" title="${esc(title)}">${text}</a>`
    : `<a class="r" href="${esc(href)}" title="${esc(title)}">${text}</a>`;
}

/** Key/value row with a dotted leader, like a printed price list. `value` is HTML. */
function kv(label: string, value: string, opts: { red?: boolean; note?: string } = {}): string {
  return `<div class="kv${opts.red ? " red" : ""}"><span class="k">${esc(label)}</span><i></i><span class="v">${value}${opts.note ?? ""}</span></div>`;
}

const SEVERITY_WORD: Record<Severity, string> = {
  danger: "Danger",
  warning: "Warning",
  caution: "Caution",
  info: "Info",
  good: "Good",
  unknown: "Unknown",
};

const isRed = (sev: Severity | undefined) => sev === "danger" || sev === "warning";

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
 * Knows every address on the page, how to shorten it unambiguously, and which
 * highlighter groups it belongs to. Only links the engines established become groups:
 * a cluster ("c:<id>") or the deployer's funding family ("f:<funder>").
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

  /** A wallet (or mint) linked to Solscan, shortened, highlightable. */
  link(addr: string, extraClass = ""): string {
    return (
      `<a class="w${extraClass ? ` ${extraClass}` : ""}" href="${esc(external.solscanAccount(addr))}" rel="noopener nofollow" ` +
      `target="_blank" title="${esc(addr)}"${this.attrs(addr)}><span>${esc(this.short(addr))}</span></a>`
    );
  }

  /** A transaction signature linked to Solscan. */
  tx(sig: string): string {
    return (
      `<a class="w" href="${esc(external.solscanTx(sig))}" rel="noopener nofollow" target="_blank" title="${esc(sig)}">` +
      `<span>tx ${esc(this.short(sig))}</span></a>`
    );
  }
}

// ---------------------------------------------------------------------------
// Note marks: numbers next to figures that point at the matching note
// ---------------------------------------------------------------------------

class Notes {
  private byId = new Map<string, { n: number; f: Finding }>();
  constructor(findings: Finding[]) {
    findings.forEach((f, i) => this.byId.set(f.id, { n: i + 1, f }));
  }
  /** Superscript link to the note with this finding id, or "". */
  mark(id: string): string {
    const hit = this.byId.get(id);
    return hit ? ` <sup><a class="nm" href="#n${hit.n}" title="${esc(hit.f.title)}">${hit.n}</a></sup>` : "";
  }
  severity(id: string): Severity | undefined {
    return this.byId.get(id)?.f.severity;
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function headSection(ctx: PageContext, s: Sticker, notes: Notes): string {
  const b = s.build;
  let where: string;
  if (b.launchpad === "pump.fun") {
    if (b.graduated === true) where = "pump.fun, graduated from the bonding curve";
    else if (b.graduated === false)
      where = `pump.fun, still on the bonding curve${b.curveProgressPct !== null ? ` (${pct(b.curveProgressPct)} complete)` : ""}`;
    else where = "pump.fun";
  } else where = "Launchpad unknown";
  return (
    `<section class="sec head">` +
    (isExample(s) ? `<span class="ex">example data</span>` : "") +
    `<h2>MSRP window sticker</h2>` +
    `<h1>${esc(coinTitle(s.name, s.symbol))}</h1>` +
    `<p class="mint"><span class="m" title="Coin address (mint)">${esc(s.mint)}</span> ` +
    `<button type="button" class="copy" hidden data-copy="${esc(s.mint)}">copy address</button> ` +
    ext(external.solscanToken(s.mint), "Solscan") +
    `</p>` +
    `<p class="sub">${esc(where)}${notes.mark("market.bonding-curve")}. ` +
    `Created ${b.createdAt !== null ? `<time datetime="${iso(b.createdAt)}">${dateTime(b.createdAt)}</time>` : "at an unknown time"}. ` +
    `Checked <time datetime="${iso(s.computedAt)}">${dateTime(s.computedAt)}</time>.</p>` +
    `<p class="url m">${esc(abs(ctx, paths.coin(s.mint)))}</p>` +
    `</section>`
  );
}

function bigSection(s: Sticker): string {
  const h = s.headline;
  const pairUrl = safeUrl(s.market?.pairUrl) ?? external.dexscreener(s.mint);
  const cap =
    h.marketCapUsd !== null
      ? receipt(pairUrl, esc(usdShort(h.marketCapUsd)), "Market cap from DEX Screener")
      : `<span class="u">${UNKNOWN}</span>`;
  const capWhy = h.marketCapUsd !== null ? "from DEX Screener" : "no market data found";

  const share = independentOfTotal(s);
  const price =
    h.stickerPriceUsd !== null
      ? receipt("#holders", esc(usdShort(h.stickerPriceUsd)), "Market cap × share of supply held by independent wallets")
      : `<span class="u">${UNKNOWN}</span>`;
  const priceWhy =
    h.stickerPriceUsd !== null
      ? share !== null
        ? `market cap × ${pct(share)} of supply`
        : "market cap × independent share of supply"
      : h.marketCapUsd === null
        ? "needs the market cap"
        : "needs the holder check";

  const ind =
    h.independentPct !== null
      ? receipt("#holders", esc(pct(h.independentPct)), "Share of circulating supply held by independent wallets")
      : `<span class="u">${UNKNOWN}</span>`;
  const indWhy = h.independentPct !== null ? "of circulating supply" : "holders couldn't be checked";

  return (
    `<section class="sec big">` +
    `<div><small>Market cap</small><strong>${cap}</strong><small>${esc(capWhy)}</small></div>` +
    `<div class="sp"><small>Sticker price: held by independent wallets</small><strong>${price}</strong><small>${esc(priceWhy)}</small></div>` +
    `<div><small>Independent share</small><strong>${ind}</strong><small>${esc(indWhy)}</small></div>` +
    `</section>`
  );
}

function ratingsSection(s: Sticker): string {
  const row = (label: string, r: Rating, strong = false) =>
    `<tr${strong ? ' class="ov"' : ""}><th scope="row">${strong ? `<b>${esc(label)}</b>` : esc(label)}</th>` +
    `<td class="sc">${stars(r)}</td><td class="rs">${esc(r.reason)}</td></tr>`;
  return (
    `<section class="sec" id="ratings"><h2>Ratings (out of 5)</h2>` +
    `<table class="rt"><tbody>` +
    row("Who made it", s.ratings.build) +
    row("Who holds it", s.ratings.crowd) +
    row("Market", s.ratings.market) +
    row("Overall", s.ratings.overall, true) +
    `</tbody></table>` +
    `<p class="fine">Stars measure how open the ownership is, not where the price goes. ` +
    `<a href="${paths.methodology}">How stars are given</a>.</p>` +
    `</section>`
  );
}

function buildSection(ctx: PageContext, s: Sticker, w: Wallets, notes: Notes): string {
  const b = s.build;
  const rows: string[] = [];
  rows.push(
    kv(
      "Creator wallet",
      b.deployer ? w.link(b.deployer) : unknown("couldn't find the transaction that created the coin"),
    ),
  );
  rows.push(
    kv(
      "Funded by",
      b.funder
        ? w.link(b.funder)
        : b.deployer
          ? unknown("its first SOL was beyond the transactions we read")
          : unknown("needs the creator wallet"),
    ),
  );
  rows.push(
    kv(
      "First SOL arrived",
      b.deployerFundedBeforeLaunchMin !== null && b.deployer
        ? receipt(
            external.solscanAccount(b.deployer),
            esc(`${minutes(b.deployerFundedBeforeLaunchMin)} before launch`),
            "The creator wallet's first incoming SOL, on Solscan",
          )
        : unknown("funding time not found"),
      { note: notes.mark("build.fresh-deployer"), red: isRed(notes.severity("build.fresh-deployer")) },
    ),
  );
  rows.push(
    kv(
      "Creator's buy at launch",
      b.devBuySol !== null && b.deployer
        ? receipt(external.solscanAccount(b.deployer), esc(sol(b.devBuySol)), "Buy inside the creation transaction")
        : unknown("not visible in the creation transaction"),
      { note: notes.mark("build.dev-buy") },
    ),
  );

  const siblings = b.family.filter((m) => m.role === "sibling").length;
  const familyKnown = b.deployer !== null;
  rows.push(
    kv(
      "Coins this creator launched",
      familyKnown ? receipt("#family", esc(String(b.deployerLaunchCount)), "Launches seen from the creator wallet") : unknown("needs the creator wallet"),
    ),
  );
  rows.push(
    kv(
      "Other wallets with the same funder",
      b.funder ? receipt("#family", esc(String(Math.max(siblings, b.familySize - 1))), "Wallets the same funder paid") : unknown("needs the funder"),
    ),
  );
  rows.push(
    kv(
      "Coins launched by these wallets",
      familyKnown ? receipt("#family", esc(String(b.familyLaunchCount)), "Launches by the creator and same-funder wallets") : unknown("needs the creator wallet"),
      { note: notes.mark("build.factory-pattern"), red: isRed(notes.severity("build.factory-pattern")) },
    ),
  );
  rows.push(
    kv(
      `Creator sold within ${THRESHOLDS.FAST_DEV_SELL_MIN} min of launch`,
      familyKnown
        ? receipt("#family", esc(`${b.familyFastDevSellCount} of ${b.familyLaunchCount}`), "Launches where the creator wallet sold quickly")
        : unknown("needs the creator wallet"),
      { note: notes.mark("build.fast-dev-sells"), red: isRed(notes.severity("build.fast-dev-sells")) },
    ),
  );
  rows.push(
    kv(
      "SOL sent back to the funder",
      b.funder ? receipt(external.solscanAccount(b.funder), esc(sol(b.sentBackToFunderSol)), "The funder wallet on Solscan") : unknown("needs the funder"),
      { note: notes.mark("build.sweep"), red: isRed(notes.severity("build.sweep")) },
    ),
  );
  rows.push(kv("Mint authority", authority(b.mintAuthority, w, "more coins can be created"), {
    note: notes.mark("build.mint-authority"),
    red: typeof b.mintAuthority === "string" && b.mintAuthority !== "unknown",
  }));
  rows.push(kv("Freeze authority", authority(b.freezeAuthority, w, "holders' coins can be frozen"), {
    note: notes.mark("build.freeze-authority"),
    red: typeof b.freezeAuthority === "string" && b.freezeAuthority !== "unknown",
  }));

  const extra = b.deployer ? `<p class="fine">${ext(external.solanaviewDev(ctx, b.deployer), "Deployer history on SolanaView")}</p>` : "";

  return (
    `<section class="sec" id="build"><h2>Who made it</h2>` +
    rows.join("") +
    familyTree(s, w) +
    extra +
    `</section>`
  );
}

function authority(v: string | null | "unknown", w: Wallets, effect: string): string {
  if (v === null) return "removed";
  if (v === "unknown") return unknown("couldn't read the coin's settings");
  return `still set (${esc(effect)}): ${w.link(v)}`;
}

/** The family as a plain monospace tree, like a file listing. */
function familyTree(s: Sticker, w: Wallets): string {
  const b = s.build;
  const fam = b.family;
  const funder = fam.find((m) => m.role === "funder");
  const deployer = fam.find((m) => m.role === "deployer");
  const siblings = fam.filter((m) => m.role === "sibling");
  if (!b.deployer && !funder) return "";

  const stats = (launches: number, fast: number, back: number): string => {
    if (launches === 0 && back === 0) return "no launches seen";
    const parts: string[] = [];
    parts.push(plural(launches, "launch", "launches"));
    if (launches > 0) parts.push(`${fast} sold within ${THRESHOLDS.FAST_DEV_SELL_MIN} min`);
    if (back > 0) parts.push(`${sol(back)} back`);
    return parts.join(", ");
  };

  const line = (branch: string, addrHtml: string, role: string, stat: string, cls = "") =>
    `<div class="tl${cls}"><span class="ad"><span class="br">${branch}</span>${addrHtml}</span><span class="ro">${esc(role)}</span><span class="ts">${esc(stat)}</span></div>`;

  const lines: string[] = [];
  const children: { addr: string; role: string; stat: string }[] = [];
  const deployerAddr = deployer?.wallet ?? b.deployer;
  if (deployerAddr) {
    children.push({
      addr: deployerAddr,
      role: "creator of this coin",
      stat: deployer ? stats(deployer.launches, deployer.launchesWithFastDevSell, deployer.sentBackSol) : "",
    });
  }
  for (const m of siblings) children.push({ addr: m.wallet, role: "", stat: stats(m.launches, m.launchesWithFastDevSell, m.sentBackSol) });

  if (funder || b.funder) {
    const f = funder?.wallet ?? b.funder ?? "";
    lines.push(line("", w.link(f), "funder", ""));
    children.forEach((c, i) => {
      const last = i === children.length - 1;
      lines.push(line(last ? "└─ " : "├─ ", w.link(c.addr), c.role, c.stat, c.role ? " me" : ""));
    });
  } else {
    lines.push(line("?  ", `<span class="u">funder unknown</span>`, "", ""));
    children.forEach((c) => lines.push(line("└─ ", w.link(c.addr), c.role, c.stat, " me")));
  }

  const sampled = b.funder
    ? `Wallets the funder paid, from up to ${LIMITS.FUNDER_TX_SAMPLE} of its transactions (at most ${LIMITS.MAX_SIBLINGS} checked). Launch counts come from each wallet's recent ${LIMITS.LAUNCH_SIGNATURE_SAMPLE} transactions.`
    : "We couldn't find the creator's funder, so we couldn't look for other wallets it paid.";
  return (
    `<h3 id="family">Family tree</h3>` +
    `<div class="tree m">${lines.join("")}</div>` +
    `<p class="fine">${esc(sampled)}</p>`
  );
}

interface Split {
  infra: number;
  insider: number;
  independent: number;
  untraced: number;
  outside: number;
}

/** Shares of TOTAL supply, from the holders table itself, so the rows always add up. */
function splitSupply(s: Sticker): Split | null {
  const t = s.crowd.topHolders;
  if (t.length === 0) return null;
  const sum = (label: HolderView["label"]) => t.filter((h) => h.label === label).reduce((a, h) => a + h.pctSupply, 0);
  const infra = sum("infrastructure");
  const insider = sum("insider");
  const independent = sum("independent");
  const untraced = sum("unknown");
  const outside = Math.max(0, 100 - infra - insider - independent - untraced);
  return { infra, insider, independent, untraced, outside };
}

function independentOfTotal(s: Sticker): number | null {
  const split = splitSupply(s);
  return split ? split.independent : null;
}

function kindLabel(h: HolderView, groupOf: Map<string, string>): string {
  const group = h.clusterId ? groupOf.get(h.clusterId) : undefined;
  switch (h.kind) {
    case "bonding-curve":
      return "bonding curve";
    case "pool":
      return "pool";
    case "burn":
      return "burned";
    case "program":
      return "program account";
    case "creator":
      return group ? `creator, ${group}` : "creator";
    default:
      if (h.label === "insider") return group ? `linked, ${group}` : "linked (launch-block buyer)";
      if (h.label === "independent") return "independent";
      if (h.label === "infrastructure") return "pool or program";
      return "couldn't trace";
  }
}

function holdersSection(s: Sticker, w: Wallets, notes: Notes): string {
  const c = s.crowd;
  const split = splitSupply(s);
  const groupOf = new Map<string, string>();
  c.clusters.forEach((cl, i) => groupOf.set(cl.id, groupName(i)));

  if (!split) {
    return (
      `<section class="sec" id="holders"><h2>Who holds it</h2>` +
      kv("Holders checked", unknown("we couldn't read the largest holders")) +
      `</section>`
    );
  }

  const insiderRed = isRed(notes.severity("crowd.insiders"));
  const n = c.topHolders.length;
  const rows =
    kv("Bonding curve, pools and burn", esc(pct(split.infra)), { note: notes.mark("crowd.infrastructure") }) +
    kv("Creator and wallets linked to it", esc(pct(split.insider)), { red: insiderRed, note: notes.mark("crowd.insiders") }) +
    kv("Independent wallets", esc(pct(split.independent))) +
    kv("Couldn't trace", esc(pct(split.untraced)), { note: notes.mark("crowd.untraced") }) +
    kv(`Outside the top ${n} (not checked)`, esc(pct(split.outside)), { note: notes.mark("crowd.long-tail") });

  const bar = supplyBar([
    ["Linked", split.insider, FILL.ins],
    ["Pools and curve", split.infra, FILL.inf],
    ["Independent", split.independent, FILL.ind],
    ["Not checked", split.untraced + split.outside, FILL.unk],
  ]);

  const h = s.headline;
  const circ =
    h.insiderPct !== null || h.independentPct !== null
      ? `<p class="fine keep">Shares of total supply. Leaving out the bonding curve and pools, insiders hold ${esc(pct(h.insiderPct))} and independent wallets ${esc(pct(h.independentPct))} of what's left.</p>`
      : `<p class="fine keep">Shares of total supply.</p>`;

  const groups = c.clusters.length
    ? `<h3>Linked groups</h3><ul class="groups">${c.clusters.map((cl, i) => clusterItem(cl, i, w, notes)).join("")}</ul>`
    : `<h3>Linked groups</h3><p>None found among the top ${n} holders.</p>`;

  const table =
    `<h3>Top ${n} holders</h3>` +
    `<table class="ht"><thead><tr><th scope="col" class="rk">#</th><th scope="col">Wallet</th><th scope="col" class="n">Supply</th><th scope="col">What it is</th><th scope="col">First SOL from</th></tr></thead><tbody>` +
    c.topHolders
      .map((hv, i) => {
        const infra = hv.label === "infrastructure";
        const cls = hv.label === "insider" ? "ins" : infra ? "inf" : hv.label === "unknown" ? "unk" : "ind";
        const funder = hv.funder ? w.link(hv.funder) : infra ? "" : `<span class="dim">${hv.label === "unknown" ? "not found" : "long history"}</span>`;
        return (
          `<tr class="${cls}"><td class="rk">${i + 1}</td><td>${w.link(hv.owner)}</td>` +
          `<td class="n">${receipt(external.solscanAccount(hv.owner), esc(pct(hv.pctSupply)), "Wallet on Solscan")}</td>` +
          `<td class="lb">${esc(kindLabel(hv, groupOf))}</td><td class="fd">${funder}</td></tr>`
        );
      })
      .join("") +
    `</tbody></table>` +
    `<p class="fine">"Long history" wallets have ${LIMITS.VETERAN_SIGNATURES}+ transactions; we don't trace them and count them as independent unless they bought in the launch block.</p>`;

  return `<section class="sec" id="holders"><h2>Who holds it (top ${n})</h2>${rows}${bar}${circ}${groups}${table}</section>`;
}

/** Bar fills: black = linked, grey = pools, white = independent, hatched = not checked. */
const FILL = { ins: "#000", inf: "#999", ind: "#fff", unk: "url(#msrp-hatch)" } as const;

/**
 * One thin printed-style stacked bar as inline SVG (prints without "background graphics"
 * and needs no inline styles), plus its key.
 */
function supplyBar(parts: [string, number, string][]): string {
  // Percentage coordinates and no viewBox: the bar stretches to any width without distorting the hatching.
  let x = 0;
  const rects: string[] = [];
  const total = parts.reduce((a, [, v]) => a + Math.max(0, v), 0) || 1;
  const p = (n: number) => `${Math.round(n * 100) / 100}%`;
  for (const [name, v, fill] of parts) {
    if (v <= 0) continue;
    const w = (Math.max(0, v) / total) * 100;
    rects.push(`<rect x="${p(x)}" y="0" width="${p(w)}" height="12" fill="${fill}"><title>${esc(`${name}: ${pct(v)}`)}</title></rect>`);
    if (x > 0) rects.push(`<line x1="${p(x)}" y1="0" x2="${p(x)}" y2="12" stroke="#000"/>`);
    x += w;
  }
  const label = parts.map(([name, v]) => `${pct(v)} ${name.toLowerCase()}`).join(", ");
  const swatch = (fill: string) =>
    `<svg class="kk" width="11" height="11" aria-hidden="true"><rect x=".5" y=".5" width="10" height="10" fill="${fill}" stroke="#000"/></svg>`;
  return (
    `<svg class="bar" width="100%" height="12" role="img" aria-label="${esc(`Total supply: ${label}`)}">` +
    `<defs><pattern id="msrp-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="4" height="4" fill="#fff"/><line x1="0" y1="0" x2="0" y2="4" stroke="#000" stroke-width="1.4"/></pattern></defs>` +
    rects.join("") +
    `<rect x="0.5" y="0.5" width="99.9%" height="11" fill="none" stroke="#000"/></svg>` +
    `<p class="key">${parts.map(([name, , fill]) => `<span>${swatch(fill)} ${esc(name.toLowerCase())}</span>`).join("")}</p>`
  );
}

function clusterItem(cl: Cluster, i: number, w: Wallets, notes: Notes): string {
  const reasons = cl.reasons.map((r) => {
    if (r === "shared-funder" && cl.funder) return `${esc(REASON_TEXT[r])} (${w.link(cl.funder)})`;
    return esc(REASON_TEXT[r]);
  });
  return (
    `<li><b>${esc(groupName(i))}</b>: ${esc(plural(cl.wallets.length, "wallet"))} holding ${esc(pct(cl.pctSupply))}` +
    `${notes.mark(`crowd.cluster.${cl.id}`)}. ${reasons.length ? `Linked by: ${reasons.join("; ")}.` : ""}` +
    `<br><span class="ws">${cl.wallets.map((a) => w.link(a)).join(" ")}</span></li>`
  );
}

function marketSection(s: Sticker, notes: Notes): string {
  const m = s.market;
  if (!m) {
    return (
      `<section class="sec" id="market"><h2>Market</h2>` +
      kv("Trading", unknown("DEX Screener had no trading pair for this coin when we checked")) +
      `</section>`
    );
  }
  const pair = safeUrl(m.pairUrl) ?? external.dexscreener(s.mint);
  const money = (v: number | null, fmt: (n: number | null) => string, title: string) =>
    v !== null ? receipt(pair, esc(fmt(v)), title) : unknown("not reported");
  const ratio =
    m.liquidityUsd !== null && m.marketCapUsd !== null && m.marketCapUsd > 0
      ? ` <small class="why">${esc(pct((m.liquidityUsd / m.marketCapUsd) * 100))} of market cap</small>`
      : "";
  const dex = cleanLabel(m.dex, 32);
  return (
    `<section class="sec" id="market"><h2>Market</h2>` +
    kv("Price", money(m.priceUsd, usdPrice, "Price on DEX Screener")) +
    kv("Market cap", money(m.marketCapUsd, usdFull, "Market cap on DEX Screener")) +
    kv("Liquidity", money(m.liquidityUsd, usdFull, "Liquidity on DEX Screener") + ratio, {
      note: notes.mark("market.liquidity"),
      red: isRed(notes.severity("market.liquidity")),
    }) +
    kv("Volume, last 24 hours", money(m.volume24hUsd, usdFull, "24-hour volume on DEX Screener"), { note: notes.mark("market.volume") }) +
    kv("Price change, last 24 hours", m.priceChange24hPct !== null ? esc(pctChange(m.priceChange24hPct)) : unknown("not reported")) +
    kv("Trading on", dex ? ext(pair, esc(dex)) : unknown("not reported")) +
    kv("Pair created", m.pairCreatedAt !== null ? esc(dateTime(m.pairCreatedAt)) : unknown("not reported")) +
    `<p class="fine">Market numbers come from DEX Screener and can lag by a minute or two.</p>` +
    `</section>`
  );
}

function notesSection(s: Sticker, w: Wallets): string {
  if (s.findings.length === 0) {
    return `<section class="sec" id="notes"><h2>Notes</h2><p>No notes. That can also mean we couldn't check much; see below.</p></section>`;
  }
  const MAX_EVIDENCE = 6;
  const evidence = (ev: string[]) => {
    if (ev.length === 0) return "";
    const fmt = (e: string) => (isSignature(e) ? w.tx(e) : w.link(e));
    const head = ev.slice(0, MAX_EVIDENCE).map(fmt).join(" ");
    const rest = ev.slice(MAX_EVIDENCE);
    return (
      `<br><small class="evd">Evidence: ${head}` +
      (rest.length ? ` <details><summary>${rest.length} more</summary>${rest.map(fmt).join(" ")}</details>` : "") +
      `</small>`
    );
  };
  return (
    `<section class="sec" id="notes"><h2>Notes</h2><ol class="notes">` +
    s.findings
      .map(
        (f, i) =>
          `<li id="n${i + 1}" class="sv-${esc(f.severity)}${isRed(f.severity) ? " red" : ""}">` +
          `<span class="nn">${i + 1}</span><span class="sw">${SEVERITY_WORD[f.severity] ?? "Note"}</span>` +
          `<span class="nt">${esc(f.title)}<br><small>${esc(f.detail)}</small>${evidence(f.evidence)}</span></li>`,
      )
      .join("") +
    `</ol></section>`
  );
}

function gapsSection(s: Sticker): string {
  const cv = s.coverage;
  const items = cv.notes.map((n) => `<li>${esc(n)}</li>`);
  if (!cv.complete) items.unshift(`<li>Some steps didn't finish in time. Anything marked Unknown above is why.</li>`);
  const list = items.length ? `<ul>${items.join("")}</ul>` : `<p>Every step finished. Each check still has limits; they're on the <a href="${paths.methodology}">methodology</a> page.</p>`;
  const work =
    `Work done: ${plural(cv.rpcRequests, "Solana request")}, ${plural(cv.dexRequests, "DEX Screener request")}` +
    `, ${Math.round(cv.elapsedMs / 100) / 10} s.`;
  return `<section class="sec" id="gaps"><h2>What we couldn't check</h2>${list}<p class="fine">${esc(work)}</p></section>`;
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

/** The sticker itself plus the share/embed row and (for 4+ stars) the SolanaView box. */
export function renderStickerBody(ctx: PageContext, s: Sticker): string {
  const w = new Wallets(s);
  const notes = new Notes(s.findings);
  const url = abs(ctx, paths.coin(s.mint));
  const badgeUrl = abs(ctx, paths.badge(s.mint));
  const text = shareText(s);
  const embed = `<a href="${esc(url)}"><img src="${esc(badgeUrl)}" alt="MSRP window sticker" height="22"></a>`;

  const label =
    `<article class="label" id="sticker" data-mint="${esc(s.mint)}">` +
    headSection(ctx, s, notes) +
    bigSection(s) +
    ratingsSection(s) +
    buildSection(ctx, s, w, notes) +
    holdersSection(s, w, notes) +
    marketSection(s, notes) +
    notesSection(s, w) +
    gapsSection(s) +
    `<section class="sec fine dis"><p>${esc(s.disclaimer)}</p><p>Payment never changes a sticker. <a href="${paths.methodology}">How MSRP decides</a>.</p></section>` +
    `</article>`;

  const links =
    `<p class="links">` +
    `<button type="button" class="copy" hidden data-copy="${esc(url)}">copy link</button>` +
    ext(external.shareX(text, url), "share on X") +
    ext(external.shareTelegram(text, url), "Telegram") +
    `<a href="${esc(paths.api(s.mint))}">JSON API</a>` +
    `</p>` +
    `<details class="embed" id="embed"><summary>Embed this sticker</summary>` +
    `<p>Put this badge on your site. It always shows the latest sticker.</p>` +
    `<p><img src="${esc(paths.badge(s.mint))}" alt="MSRP badge preview" height="22"></p>` +
    `<textarea id="embed-code" readonly rows="3" aria-label="Badge HTML">${esc(embed)}</textarea>` +
    `<button type="button" class="copy" hidden data-copy-from="embed-code">copy code</button>` +
    `</details>`;

  const promo =
    s.ratings.overall.stars !== null && s.ratings.overall.stars >= 4
      ? `<aside class="promo"><h2>Get your coin seen: SolanaView listings</h2>` +
        `<p><b>Sponsored listings are separate from MSRP ratings — payment never changes a sticker.</b> ` +
        `SolanaView is run by the same team as MSRP. This box only appears on stickers with 4 or more stars overall.</p>` +
        `<p>${ext(external.solanaviewPromote(ctx, s.mint), "See SolanaView listing options")}</p></aside>`
      : "";

  return label + links + promo;
}
