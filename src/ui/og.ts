/**
 * Share card (1200x630 SVG) for Open Graph / link previews (docs/DESIGN.md): near-black, the
 * coin name and the big purple sticker price with its short mono caption. Nothing else but the
 * mark and one quiet line. Self-contained: no fonts, images or scripts; widths pinned with textLength.
 *
 * Note: X and Telegram only show PNG/JPEG previews. The Worker can serve this SVG as-is
 * (browsers, Discord, Slack) or convert it to PNG later.
 */
import type { Sticker } from "../types";
import { DISCLAIMER } from "../config";
import { cleanLabel, esc } from "./escape";
import { dayTime, short, starLabel, usdShort } from "./format";
import { SVG_MONO, SVG_SANS, monoWidth, textWidth } from "./svg";
import { coinTitle } from "./sticker";

const W = 1200;
const H = 630;
const X = 96;
const MAXW = W - 2 * X;
const C = { bg: "#0c0c0e", tx: "#ececef", tx2: "#8d8d96", tx3: "#55555d", acc: "#a78bfa" } as const;

interface TextOpts {
  fill?: string;
  mono?: boolean;
  weight?: 500;
  anchor?: "end";
  max?: number;
  /** Tight tracking for big headings (letter-spacing in em). */
  track?: number;
}

/** <text> that never overflows `max` px: pinned with textLength when the estimate is wider. */
function text(x: number, y: number, t: string, size: number, o: TextOpts = {}): string {
  const est = o.mono ? monoWidth(t, size) : textWidth(t, size, o.weight === 500);
  const tracked = Math.ceil(est * (1 + (o.track ?? 0) * 0.55));
  const fit = o.max !== undefined && tracked > o.max ? ` textLength="${o.max}" lengthAdjust="spacingAndGlyphs"` : "";
  return (
    `<text x="${x}" y="${y}" font-size="${size}" fill="${o.fill ?? C.tx}"` +
    `${o.mono ? ` font-family="${SVG_MONO}"` : ""}${o.weight ? ` font-weight="${o.weight}"` : ""}` +
    `${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.track ? ` letter-spacing="${o.track}em"` : ""}${fit}>${esc(t)}</text>`
  );
}

function frame(inner: string, label: string, left: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">` +
    `<title>${esc(label)}</title><desc>${esc(DISCLAIMER)}</desc>` +
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>` +
    `<circle cx="${X + 7}" cy="92" r="7" fill="${C.acc}"/>` +
    `<g font-family="${SVG_SANS}">` +
    text(X + 26, 102, "msrp", 30, { mono: true }) +
    inner +
    (left ? text(X, 566, left, 20, { mono: true, fill: C.tx3 }) : "") +
    text(W - X, 566, "not financial advice", 20, { mono: true, fill: C.tx3, anchor: "end" }) +
    `</g></svg>`
  );
}

export function renderOgSvg(sticker: Sticker): string {
  const h = sticker.headline;
  const name = cleanLabel(sticker.name, 40);
  const sym = cleanLabel(sticker.symbol, 14);
  const main = name ?? (sym ? `$${sym}` : "Unnamed coin");

  // Coin name, with the symbol in dim grey after it.
  const nameSize = 52;
  const nameMax = name && sym ? Math.round(MAXW * 0.7) : MAXW;
  const nameW = Math.min(nameMax, Math.ceil(textWidth(main, nameSize, true) * 0.95));
  let inner = text(X, 236, main, nameSize, { weight: 500, track: -0.025, max: nameMax });
  if (name && sym) {
    const sx = X + nameW + 16;
    inner += text(sx, 236, `$${sym}`, nameSize, { weight: 500, track: -0.025, fill: C.tx3, max: Math.max(80, X + MAXW - sx) });
  }

  // The one big number: the sticker price, or a dim dash when it's unknown.
  const known = h.stickerPriceUsd !== null;
  const price = known ? usdShort(h.stickerPriceUsd) : "—";
  let size = known ? 200 : 140;
  const widthAt = (s: number) => textWidth(price, s, true) * 0.95;
  if (widthAt(size) > MAXW) size = Math.floor((size * MAXW) / widthAt(size));
  inner += text(X - 6, 430, price, size, { weight: 500, track: -0.05, fill: known ? C.acc : C.tx3, max: MAXW });

  const caption = known
    ? h.marketCapUsd !== null
      ? `independent of ${usdShort(h.marketCapUsd)}`
      : "independent"
    : h.marketCapUsd === null
      ? "market cap unknown"
      : sticker.crowd.topHolders.length === 0
        ? "holders unknown"
        : "holders untraced";
  inner += text(X, 500, caption, 26, { mono: true, fill: C.tx2, max: MAXW });

  const label =
    `MSRP window sticker for ${coinTitle(sticker.name, sticker.symbol)} (${short(sticker.mint)}): ` +
    `sticker price ${known ? price : "unknown"}${h.marketCapUsd !== null ? ` of ${usdShort(h.marketCapUsd)} market cap` : ""}, ` +
    `${starLabel(sticker.ratings.overall.stars)} overall, checked ${dayTime(sticker.computedAt)}.`;
  // The check date sits in the quiet bottom line, so an old card never passes for a fresh one.
  return frame(inner, label, `${short(sticker.mint)} · checked ${dayTime(sticker.computedAt)}`);
}

/** Generic share card for pages that aren't a sticker. */
export function renderOgDefaultSvg(): string {
  const inner =
    text(X - 4, 330, "who made it.", 104, { weight: 500, track: -0.04 }) +
    text(X - 4, 440, "who holds it.", 104, { weight: 500, track: -0.04, fill: C.tx3 }) +
    text(X, 500, "the window sticker for any solana coin", 26, { mono: true, fill: C.tx2, max: MAXW });
  return frame(inner, "MSRP: who made it, who holds it. The window sticker for Solana meme coins.", "");
}
