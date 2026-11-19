/**
 * The small hairline wallet-family graph beside the big number (docs/DESIGN.md).
 *
 *   funder (yellow) near the top, the wallets it paid around it, the coin (purple, largest) below.
 *   creator = white, linked wallets = red, other family wallets = dark grey.
 *   grey hairlines = "funded by", purple hairlines = "holds this coin".
 *
 * The layout is fixed slots, filled in the order the engines list wallets, so the same sticker
 * always draws the same picture. Every node links to Solscan, has a <title> tooltip, and carries
 * the highlighter attributes (data-w / data-g) like every other wallet on the page.
 */
import type { Sticker } from "../types";
import { esc } from "./escape";
import { pct, plural } from "./format";
import { external } from "./paths";

/** What the graph needs from the page's wallet registry (sticker.ts). */
export interface WalletRef {
  attrs(addr: string): string;
  short(addr: string): string;
}

interface Pt {
  x: number;
  y: number;
}

interface Node extends Pt {
  addr: string;
  r: number;
  fill: string;
  label: string;
  token?: boolean;
}

interface Edge {
  a: Pt;
  b: Pt;
  hold: boolean;
}

export const GRAPH = { width: 170, height: 140 } as const;

const COLOR = { funder: "#e5c07b", coin: "#a78bfa", creator: "#ececef", linked: "#f2555a", other: "#3a3a41" } as const;
const HUB: Pt = { x: 85, y: 44 };
const COIN: Pt = { x: 85, y: 124 };

/** Linked holders sit on an arc above the coin, nearest slots first. Degrees, y axis down. */
const HOLD_SLOTS = [226, 314, 198, 342, 254, 286, 172, 8];
/** The rest of the family fans out around the funder, away from the coin. */
const OTHER_SLOTS = [300, 330, 8, 172, 240, 352, 190, 270, 318, 222, 20, 160];
const CREATOR_SLOT = 212;

const r1 = (n: number) => Math.round(n * 10) / 10;

function at(c: Pt, rx: number, ry: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return { x: r1(c.x + rx * Math.cos(a)), y: r1(c.y + ry * Math.sin(a)) };
}

/**
 * The graph as inline SVG, or "" when we don't know enough (no creator and no funder).
 * Pure and deterministic.
 */
export function walletGraph(s: Sticker, w: WalletRef): string {
  const b = s.build;
  if (!b.deployer && !b.funder) return "";

  const holding = new Map<string, number>();
  for (const h of s.crowd.topHolders) if (h.label === "insider" && h.owner !== b.deployer) holding.set(h.owner, h.pctSupply);
  const funderOf = new Map<string, string | null>();
  for (const h of s.crowd.topHolders) funderOf.set(h.owner, h.funder);

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const coin: Node = { addr: s.mint, ...COIN, r: 7, fill: COLOR.coin, label: "This coin", token: true };

  // Hub: the funder, or the creator itself when the funder is unknown.
  if (b.funder) {
    nodes.push({ addr: b.funder, ...HUB, r: 5, fill: COLOR.funder, label: "Funder: sent the creator its first SOL" });
    edges.push({ a: HUB, b: COIN, hold: false });
    if (b.deployer) {
      const creator: Node = { addr: b.deployer, ...at(HUB, 48, 28, CREATOR_SLOT), r: 3.5, fill: COLOR.creator, label: "Creator of this coin" };
      nodes.push(creator);
      edges.push({ a: HUB, b: creator, hold: false });
    }
  } else if (b.deployer) {
    nodes.push({ addr: b.deployer, ...HUB, r: 4.5, fill: COLOR.creator, label: "Creator of this coin (funder unknown)" });
    edges.push({ a: HUB, b: COIN, hold: false });
  }

  // Linked wallets that hold this coin: the funder's other wallets first, then the rest.
  const siblings = b.family.filter((m) => m.role === "sibling");
  const familySet = new Set(siblings.map((m) => m.wallet));
  const holders = [...holding.keys()].sort((x, y) => Number(familySet.has(y)) - Number(familySet.has(x)));
  const shownHolders = holders.slice(0, HOLD_SLOTS.length);
  shownHolders.forEach((addr, i) => {
    const p = holding.get(addr) ?? 0;
    const pos = at(COIN, 44, 36, HOLD_SLOTS[i] ?? 270);
    const node: Node = { addr, ...pos, r: r1(Math.min(4.5, 2.6 + p / 4)), fill: COLOR.linked, label: `Linked wallet, holds ${pct(p)}` };
    nodes.push(node);
    edges.push({ a: node, b: COIN, hold: true });
    if (b.funder && (familySet.has(addr) || funderOf.get(addr) === b.funder)) edges.push({ a: HUB, b: node, hold: false });
  });

  // The rest of the family: red when it launched coins, dark grey when we saw nothing from it.
  const shown = new Set(shownHolders);
  const others = b.funder ? siblings.filter((m) => !shown.has(m.wallet) && m.wallet !== b.deployer) : [];
  others.sort((x, y) => Number(y.launches > 0) - Number(x.launches > 0));
  const shownOthers = others.slice(0, OTHER_SLOTS.length);
  shownOthers.forEach((m, i) => {
    const near = i % 2 === 1;
    const active = m.launches > 0;
    const node: Node = {
      addr: m.wallet,
      ...at(HUB, near ? 56 : 72, near ? 30 : 26, OTHER_SLOTS[i] ?? 270),
      r: active ? 3 : 2.5,
      fill: active ? COLOR.linked : COLOR.other,
      label: `Same funder, ${active ? `launched ${plural(m.launches, "coin")}` : "no launches seen"}`,
    };
    nodes.push(node);
    edges.push({ a: HUB, b: node, hold: false });
  });
  nodes.push(coin);

  const line = (e: Edge) => `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}"/>`;
  const group = (hold: boolean, stroke: string) => {
    const list = edges.filter((e) => e.hold === hold);
    return list.length ? `<g stroke="${stroke}">${list.map(line).join("")}</g>` : "";
  };
  const node = (n: Node) => {
    const href = n.token ? external.solscanToken(n.addr) : external.solscanAccount(n.addr);
    const tip = `${n.label} · ${w.short(n.addr)}`;
    return (
      `<a href="${esc(href)}" rel="noopener nofollow" target="_blank" aria-label="${esc(tip)}"${w.attrs(n.addr)}>` +
      `<title>${esc(tip)}</title><circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.fill}"/></a>`
    );
  };

  const hidden = holders.length - shownHolders.length + (others.length - shownOthers.length);
  const summary =
    `Wallet family: ${b.funder ? "funder, " : ""}${b.deployer ? "creator, " : ""}` +
    `${plural(shownHolders.length, "linked holder")} and ${plural(shownOthers.length, "other family wallet")}` +
    `${hidden > 0 ? ` (${hidden} more not drawn)` : ""}`;

  return (
    `<svg class="graph" viewBox="0 0 ${GRAPH.width} ${GRAPH.height}" width="${GRAPH.width}" height="${GRAPH.height}" role="group" aria-label="${esc(summary)}">` +
    `<title>${esc(summary)}</title>` +
    group(false, "#26262b") +
    group(true, "rgba(167,139,250,.45)") +
    nodes.map(node).join("") +
    `</svg>`
  );
}
