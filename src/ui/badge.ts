/**
 * The embeddable badge: a tiny printed label.
 *   [ MSRP ★★☆☆☆ 39% independent · 19 Nov ]
 * White, 1px black border, black text. Self-contained SVG: no fonts, links or scripts.
 */
import type { Sticker } from "../types";
import { DISCLAIMER } from "../config";
import { esc } from "./escape";
import { dateShort, pct, starLabel } from "./format";
import { starRow, starRowWidth, textWidth } from "./svg";
import { coinTitle } from "./sticker";

const H = 22;
const FONT = 12;
const PAD = 7;
const GAP = 6;
const BASE = 15.5;
const STAR_R = 5.2;
const STAR_GAP = 1.4;

export function renderBadgeSvg(sticker: Sticker | null, mint: string): string {
  const parts: string[] = [];
  let x = PAD;
  const text = (t: string, bold = false) => {
    const w = textWidth(t, FONT, bold);
    parts.push(
      `<text x="${x}" y="${BASE}"${bold ? ' font-weight="bold"' : ""} textLength="${w}" lengthAdjust="spacingAndGlyphs">${esc(t)}</text>`,
    );
    x += w + GAP;
  };

  text("MSRP", true);
  let label: string;
  if (!sticker) {
    text("· tap to check");
    label = `MSRP window sticker for ${mint}: not checked yet. Tap to check.`;
  } else {
    const stars = sticker.ratings.overall.stars;
    if (stars === null) text("Not rated");
    else {
      parts.push(`<g aria-hidden="true">${starRow(x, H / 2, STAR_R, stars, STAR_GAP, 1)}</g>`);
      x += starRowWidth(STAR_R, STAR_GAP) + GAP;
    }
    const ind = sticker.headline.independentPct;
    text(`${ind === null ? "independent share unknown" : `${pct(ind)} independent`} · ${dateShort(sticker.computedAt)}`);
    label =
      `MSRP window sticker for ${coinTitle(sticker.name, sticker.symbol)}: ${starLabel(stars)} overall, ` +
      `${ind === null ? "independent share unknown" : `${pct(ind)} of circulating supply held by independent wallets`}, checked ${dateShort(sticker.computedAt)}.`;
  }
  const width = Math.ceil(x - GAP + PAD);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(label)}">` +
    `<title>${esc(label)}</title><desc>${esc(DISCLAIMER)}</desc>` +
    `<rect x=".5" y=".5" width="${width - 1}" height="${H - 1}" fill="#fff" stroke="#000"/>` +
    `<g font-family="Arial,Helvetica,sans-serif" font-size="${FONT}" fill="#000">${parts.join("")}</g>` +
    `</svg>`
  );
}
