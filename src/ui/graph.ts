/**
 * The small hairline wallet graph beside "Who made it" (docs/DESIGN.md).
 *
 *   funder (yellow) in the middle, the wallets it paid around it, the coin (purple) below.
 *   creator = white, linked wallets = red, other family wallets = dark grey.
 *   grey lines = "funded by", purple lines = "holds this coin", dashed purple = "created it".
 *
 * The layout is fixed slots on two ellipses, filled in the order the engines list wallets, so
 * the same sticker always draws the same picture. Every node links to Solscan, has a <title>
 * tooltip, and carries the highlighter attributes (data-w / data-g) like every other wallet.
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

interface Node {
  addr: string;
  x: number;
  y: number;
  r: number;
  fill: string;
  label: string;
  token?: boolean;
}

type EdgeKind = "fund" | "hold" | "made";
interface Edge {
  a: { x: number; y: number };
  b: { x: number; y: number };
  kind: EdgeKind;
}

export const GRAPH = { width: 200, height: 170 } as const;

const COLOR = { funder: "#e5c07b", coin: "#a78bfa", creator: "#ececef", linked: "#f2555a", other: "#3a3a41" } as const;
const HUB = { x: 100, y: 62 };
const COIN = { x: 100, y: 150 };
const CREATOR_ANGLE = 216;

/** Holders sit below the hub, either side of the coin, nearest slots first. Degrees, y axis down. */
const HOLD_SLOTS = [124, 56, 140, 40, 108, 72, 156, 24];
/** The rest of the family sits above and beside the hub, skipping the creator's corner. */
const OTHER_SLOTS = [172, 186, 242, 256, 270, 284, 298, 312, 326, 340, 354, 368];

const r1 = (n: number) => Math.round(n * 10) / 10;

function at(rx: number, ry: number, deg: number, c = HUB): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: r1(c.x + rx * Math.cos(a)), y: r1(c.y + ry * Math.sin(a)) };
}

/** `n` slots out of `slots`, spread evenly so a small family doesn't bunch up on one side. */
function spread(slots: number[], n: number): number[] {
  if (n <= 0) return [];
  if (n >= slots.length) return slots.slice();
  if (n === 1) return [slots[Math.floor(slots.length / 2)] ?? 270];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(slots[Math.round((i * (slots.length - 1)) / (n - 1))] ?? 270);
  return out;
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
  const hub = { ...HUB };
  const coin: Node = { addr: s.mint, ...COIN, r: 6.5, fill: COLOR.coin, label: "This coin", token: true };

  // Hub: the funder, or the creator itself when the funder is unknown.
  let creator: Node | null = null;
  if (b.funder) {
    nodes.push({ addr: b.funder, ...hub, r: 5, fill: COLOR.funder, label: "Funder: sent the creator its first SOL" });
    if (b.deployer) {
      creator = { addr: b.deployer, ...at(58, 56, CREATOR_ANGLE), r: 3.5, fill: COLOR.creator, label: "Creator of this coin" };
      edges.push({ a: hub, b: creator, kind: "fund" });
    }
  } else if (b.deployer) {
    creator = { addr: b.deployer, ...hub, r: 4.5, fill: COLOR.creator, label: "Creator of this coin (funder unknown)" };
  }
  if (creator) {
    nodes.push(creator);
    edges.push({ a: creator, b: coin, kind: "made" });
  }

  // Wallets that hold this coin and are linked: the funder's other wallets first, then the rest of the linked holders.
  const siblings = b.family.filter((m) => m.role === "sibling");
  const familySet = new Set(siblings.map((m) => m.wallet));
  const holders = [...holding.keys()].sort((x, y) => Number(familySet.has(y)) - Number(familySet.has(x)));
  const shownHolders = holders.slice(0, HOLD_SLOTS.length);
  HOLD_SLOTS.slice(0, shownHolders.length).forEach((deg, i) => {
    const addr = shownHolders[i] ?? "";
    const p = holding.get(addr) ?? 0;
    const node: Node = { addr, ...at(66, 50, deg), r: Math.min(5, 3 + p / 4), fill: COLOR.linked, label: `Linked wallet, holds ${pct(p)}` };
    nodes.push(node);
    edges.push({ a: node, b: coin, kind: "hold" });
    if (b.funder && (familySet.has(addr) || funderOf.get(addr) === b.funder)) edges.push({ a: hub, b: node, kind: "fund" });
  });

  // The rest of the family: red when it launched coins, dark grey when we saw nothing from it.
  const shown = new Set(shownHolders);
  const others = b.funder ? siblings.filter((m) => !shown.has(m.wallet) && m.wallet !== b.deployer) : [];
  others.sort((x, y) => Number(y.launches > 0) - Number(x.launches > 0));
  const shownOthers = others.slice(0, OTHER_SLOTS.length);
  spread(OTHER_SLOTS, shownOthers.length).forEach((deg, i) => {
    const m = shownOthers[i];
    if (!m) return;
    const scale = i % 2 ? 0.78 : 1;
    const active = m.launches > 0;
    const node: Node = {
      addr: m.wallet,
      ...at(84 * scale, 52 * scale, deg),
      r: active ? 3 : 2.5,
      fill: active ? COLOR.linked : COLOR.other,
      label: `Same funder, ${active ? `launched ${plural(m.launches, "coin")}` : "no launches seen"}`,
    };
    nodes.push(node);
    edges.push({ a: hub, b: node, kind: "fund" });
  });
  nodes.push(coin);

  const line = (e: Edge) =>
    `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}"${e.kind === "made" ? ' stroke-dasharray="2 3"' : ""}/>`;
  const group = (kinds: EdgeKind[], stroke: string) => {
    const list = edges.filter((e) => kinds.includes(e.kind));
    return list.length ? `<g stroke="${stroke}" stroke-width="1">${list.map(line).join("")}</g>` : "";
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
    `Wallet family graph: ${b.funder ? "the funder, " : ""}${b.deployer ? "the creator, " : ""}` +
    `${plural(shownHolders.length, "linked holder")} and ${plural(shownOthers.length, "other family wallet")}` +
    `${hidden > 0 ? ` (${hidden} more not drawn)` : ""}.`;

  return (
    `<svg class="graph" viewBox="0 0 ${GRAPH.width} ${GRAPH.height}" width="${GRAPH.width}" height="${GRAPH.height}" aria-label="${esc(summary)}">` +
    `<title>${esc(summary)}</title>` +
    group(["fund"], "#26262b") +
    group(["hold", "made"], "rgba(167,139,250,.5)") +
    nodes.map(node).join("") +
    `</svg>`
  );
}
