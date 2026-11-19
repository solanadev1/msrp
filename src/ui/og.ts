/**
 * Share card (1200x630 SVG) for Open Graph / link previews (docs/DESIGN.md): the big purple
 * sticker price on near-black with the coin name, and nothing else but the mark and one quiet
 * line. Self-contained: no fonts, images or scripts; widths are pinned with textLength.
 *
 * Note: X and Telegram only show PNG/JPEG previews. The Worker can serve this SVG as-is
 * (browsers, Discord, Slack) or convert it to PNG later.
 */
import type { Sticker } from "../types";
import { DISCLAIMER } from "../config";
import { cleanLabel, esc } from "./escape";
import { UNKNOWN, dateLong, pct, short, starLabel, usdShort } from "./format";
import { SVG_MONO, SVG_SANS, monoWidth, textWidth } from "./svg";
import { coinTitle } from "./sticker";

const W = 1200;
const H = 630;
const X = 88;
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
  opacity?: number;
}

/** <text> that never overflows `max` px: pinned with textLength when the estimate is wider. */
function text(x: number, y: number, t: string, size: number, o: TextOpts = {}): string {
  const est = o.mono ? monoWidth(t, size) : textWidth(t, size, o.weight === 500);
  const tracked = Math.ceil(est * (1 + (o.track ?? 0) * 0.55));
  const fit = o.max !== undefined && tracked > o.max ? ` textLength="${o.max}" lengthAdjust="spacingAndGlyphs"` : "";
  return (
    `<text x="${x}" y="${y}" font-size="${size}" fill="${o.fill ?? C.tx}"` +
    `${o.mono ? ` font-family="${SVG_MONO}"` : ""}${o.weight ? ` font-weight="${o.weight}"` : ""}` +
    `${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.track ? ` letter-spacing="${o.track}em"` : ""}` +
    `${o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : ""}${fit}>${esc(t)}</text>`
  );
}

function frame(inner: string, label: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">` +
    `<title>${esc(label)}</title><desc>${esc(DISCLAIMER)}</desc>` +
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>` +
    `<circle cx="${X + 7}" cy="94" r="7" fill="${C.acc}"/>` +
    `<g font-family="${SVG_SANS}">` +
    text(X + 26, 104, "msrp", 30, { mono: true, weight: 500 }) +
    inner +
    `<rect x="${X}" y="540" width="${MAXW}" height="1" fill="#1d1d21"/>` +
    text(X, 584, "public data · not financial advice", 20, { mono: true, fill: C.tx3 }) +
    `</g></svg>`
  );
}

export function renderOgSvg(sticker: Sticker): string {
  const h = sticker.headline;
  const name = cleanLabel(sticker.name, 40);
  const sym = cleanLabel(sticker.symbol, 14);
  const main = name ?? (sym ? `$${sym}` : "Unnamed coin");

  // Coin name, with the symbol in dim grey after it.
  const nameSize = 54;
  const nameW = Math.min(MAXW, Math.ceil(textWidth(main, nameSize, true) * 0.95));
  let inner = text(X, 236, main, nameSize, { weight: 500, track: -0.03, max: name && sym ? Math.round(MAXW * 0.72) : MAXW });
  if (name && sym) {
    const sx = X + Math.min(nameW, Math.round(MAXW * 0.72)) + 16;
    inner += text(sx, 236, `$${sym}`, nameSize, { weight: 500, track: -0.03, fill: C.tx3, max: Math.max(80, X + MAXW - sx) });
  }
  inner += text(W - X, 104, `checked ${dateLong(sticker.computedAt)}`, 22, { mono: true, fill: C.tx3, anchor: "end" });

  // The big number: sticker price / market cap, scaled down to fit one line.
  const price = h.stickerPriceUsd !== null ? usdShort(h.stickerPriceUsd) : UNKNOWN;
  const cap = h.marketCapUsd !== null ? `/ ${usdShort(h.marketCapUsd)}` : "";
  let size = 156;
  const widthAt = (s: number) => textWidth(price, s, true) * 0.96 + (cap ? 0.3 * s + textWidth(cap, s, true) * 0.96 : 0);
  if (widthAt(size) > MAXW) size = Math.floor((size * MAXW) / widthAt(size));
  const pw = Math.ceil(textWidth(price, size, true) * 0.96);
  inner += text(X, 430, price, size, { weight: 500, track: -0.045, fill: C.acc, opacity: h.stickerPriceUsd === null ? 0.55 : undefined, max: MAXW });
  if (cap) inner += text(X + pw + Math.round(0.3 * size), 430, cap, size, { weight: 500, track: -0.045, fill: C.tx3, max: Math.max(100, MAXW - pw) });

  const caption =
    h.stickerPriceUsd !== null
      ? `held by independent wallets${h.independentPct !== null ? `, ${pct(h.independentPct)} of circulating supply` : ""}`
      : h.marketCapUsd === null
        ? "no sticker price: no market cap reported"
        : "no sticker price: too many holders untraced";
  inner += text(X, 492, caption, 26, { fill: C.tx2, max: MAXW });

  const label =
    `MSRP window sticker for ${coinTitle(sticker.name, sticker.symbol)} (${short(sticker.mint)}): ` +
    `sticker price ${price}${cap ? ` of ${cap.slice(2)} market cap` : ""}, ${starLabel(sticker.ratings.overall.stars)} overall.`;
  return frame(inner, label);
}

/** Generic share card for pages that aren't a sticker. */
export function renderOgDefaultSvg(): string {
  const inner =
    text(X, 300, "Who made it.", 112, { weight: 500, track: -0.04 }) +
    text(X, 420, "Who holds it.", 112, { weight: 500, track: -0.04, fill: C.tx3 }) +
    text(X, 488, "The window sticker for any Solana meme coin.", 30, { fill: C.tx2, max: MAXW });
  return frame(inner, "MSRP: who made it, who holds it. The window sticker for Solana meme coins.");
}
