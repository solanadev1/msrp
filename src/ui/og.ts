/**
 * Share card (1200x630 SVG) for Open Graph / X previews: the sticker's headline numbers and
 * star rows on a printed label. Self-contained: no fonts, images or scripts.
 *
 * Note: X and Telegram only show PNG/JPEG previews. The Worker can serve this SVG as-is
 * (browsers, Discord, Slack) or convert it to PNG later.
 */
import type { Rating, Sticker } from "../types";
import { DISCLAIMER } from "../config";
import { esc } from "./escape";
import { UNKNOWN, dateLong, pct, short, starLabel, usdShort } from "./format";
import { starRow, textWidth } from "./svg";
import { coinTitle } from "./sticker";

const W = 1200;
const H = 630;
const X0 = 36;
const Y0 = 36;
const LW = W - 2 * X0;
const FONT = `font-family="Arial,Helvetica,sans-serif"`;
const MONO = `font-family="ui-monospace,Courier New,monospace"`;

/** <text> that never overflows `max` px: pinned with textLength when the estimate is wider. */
function text(x: number, y: number, t: string, size: number, opts: { bold?: boolean; max?: number; anchor?: "end" | "middle"; mono?: boolean } = {}): string {
  const est = opts.mono ? Math.ceil(t.length * size * 0.6) : textWidth(t, size, opts.bold);
  const fit = opts.max !== undefined && est > opts.max ? ` textLength="${opts.max}" lengthAdjust="spacingAndGlyphs"` : "";
  return (
    `<text x="${x}" y="${y}" font-size="${size}"${opts.bold ? ' font-weight="bold"' : ""}${opts.anchor ? ` text-anchor="${opts.anchor}"` : ""}` +
    `${opts.mono ? ` ${MONO}` : ""}${fit}>${esc(t)}</text>`
  );
}

function frame(inner: string, label: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">` +
    `<title>${esc(label)}</title><desc>${esc(DISCLAIMER)}</desc>` +
    `<rect width="${W}" height="${H}" fill="#fff"/>` +
    `<rect x="${X0}" y="${Y0}" width="${LW}" height="${H - 2 * Y0}" fill="#fff" stroke="#000" stroke-width="4"/>` +
    `<g ${FONT} fill="#000">${inner}</g></svg>`
  );
}

const hr = (y: number, w = 2) => `<rect x="${X0}" y="${y}" width="${LW}" height="${w}" fill="#000"/>`;

function ratingRow(x: number, y: number, label: string, r: Rating, bold = false): string {
  const stars =
    r.stars === null ? text(x + 250, y, "Not rated", 26) : `<g aria-hidden="true">${starRow(x + 250, y - 9, 13, r.stars, 5, 2)}</g>`;
  return text(x, y, label, 26, { bold }) + stars;
}

export function renderOgSvg(sticker: Sticker): string {
  const h = sticker.headline;
  const title = coinTitle(sticker.name, sticker.symbol);
  const L = X0 + 28;
  const col = LW / 3;

  const big = (i: number, label: string, value: number | null, fmt: (v: number) => string, sub: string) => {
    const x = X0 + i * col + 28;
    const v = value === null ? UNKNOWN : fmt(value);
    return (
      text(x, 250, label, 22, { max: col - 48 }) +
      text(x, 330, v, value === null ? 52 : 72, { bold: true, max: col - 48 }) +
      text(x, 368, sub, 20, { max: col - 48 })
    );
  };

  const inner =
    text(L, 84, "MSRP WINDOW STICKER", 22, { bold: true }) +
    text(X0 + LW - 28, 84, `Checked ${dateLong(sticker.computedAt)}`, 22, { anchor: "end" }) +
    text(L, 146, title, 54, { bold: true, max: LW - 56 }) +
    text(L, 184, sticker.mint, 20, { mono: true, max: LW - 56 }) +
    hr(206) +
    big(0, "Market cap", h.marketCapUsd, usdShort, h.marketCapUsd === null ? "no market data" : "DEX Screener") +
    `<rect x="${X0 + col}" y="208" width="1" height="180" fill="#000"/>` +
    big(1, "Sticker price", h.stickerPriceUsd, usdShort, "held by independent wallets") +
    `<rect x="${X0 + 2 * col}" y="208" width="1" height="180" fill="#000"/>` +
    big(2, "Independent share", h.independentPct, (v) => pct(v), "of circulating supply") +
    hr(388, 1) +
    ratingRow(L, 444, "Who made it", sticker.ratings.build) +
    ratingRow(L + LW / 2, 444, "Who holds it", sticker.ratings.crowd) +
    ratingRow(L, 500, "Market", sticker.ratings.market) +
    ratingRow(L + LW / 2, 500, "Overall", sticker.ratings.overall, true) +
    hr(530, 1) +
    text(L, 568, "Public blockchain data. Stars rate how open the ownership is, not the price. Not financial advice.", 18, {
      max: LW - 56,
    });

  const label =
    `MSRP window sticker for ${title} (${short(sticker.mint)}): ${starLabel(sticker.ratings.overall.stars)} overall, ` +
    `independent share ${h.independentPct === null ? "unknown" : pct(h.independentPct)}.`;
  return frame(inner, label);
}

/** Generic share card for pages that aren't a sticker. */
export function renderOgDefaultSvg(): string {
  const L = X0 + 28;
  const inner =
    text(L, 84, "MSRP WINDOW STICKER", 22, { bold: true }) +
    text(L, 236, "MSRP", 150, { bold: true }) +
    text(L, 300, "The window sticker for Solana meme coins.", 40) +
    hr(340, 1) +
    text(L, 400, "Who made it", 30, { bold: true }) +
    text(L + 340, 400, "Who holds it", 30, { bold: true }) +
    text(L + 680, 400, "Sticker price", 30, { bold: true }) +
    text(L, 440, "creator, funder, family", 22) +
    text(L + 340, 440, "insiders vs independent", 22) +
    text(L + 680, 440, "market cap held by", 22) +
    text(L + 680, 468, "independent wallets", 22) +
    hr(530, 1) +
    text(L, 568, "Read-only. Public blockchain data. Not financial advice.", 18);
  return frame(inner, "MSRP: the window sticker for Solana meme coins");
}
