/**
 * The embeddable badge (docs/DESIGN.md): a dark pill with a purple dot, "msrp", five rating
 * dots and the independent share.
 *
 *   ( • msrp  ●○○○○  34.5% )
 *
 * Self-contained SVG: no fonts, links, images or scripts. Widths are pinned with textLength.
 */
import type { Sticker } from "../types";
import { DISCLAIMER } from "../config";
import { esc } from "./escape";
import { dateShort, pct, starLabel } from "./format";
import { SVG_MONO, dotRow, dotRowWidth, monoWidth } from "./svg";
import { coinTitle, independentShown } from "./sticker";

const H = 20;
const FONT = 11;
const BASE = 13.8;
const PAD = 9;
const GAP = 8;
const DOT_R = 2.4;
const DOT_GAP = 2.2;

export function renderBadgeSvg(sticker: Sticker | null, mint: string): string {
  const parts: string[] = [];
  parts.push(`<circle cx="${PAD + 2.5}" cy="${H / 2}" r="2.5" fill="#a78bfa"/>`);
  let x = PAD + 10;

  const text = (t: string, fill: string) => {
    const w = monoWidth(t, FONT);
    parts.push(`<text x="${x}" y="${BASE}" fill="${fill}" textLength="${w}" lengthAdjust="spacingAndGlyphs">${esc(t)}</text>`);
    x += w + GAP;
  };
  text("msrp", "#ececef");

  let label: string;
  if (!sticker) {
    text("tap to check", "#8d8d96");
    label = `MSRP window sticker for ${mint}: not checked yet. Tap to check.`;
  } else {
    const stars = sticker.ratings.overall.stars;
    if (stars === null) text("not rated ·", "#8d8d96");
    else {
      parts.push(`<g aria-hidden="true">${dotRow(x, H / 2, DOT_R, DOT_GAP, stars)}</g>`);
      x += dotRowWidth(DOT_R, DOT_GAP) + GAP;
    }
    const ind = independentShown(sticker);
    if (ind === null) text("share unknown", "#8d8d96");
    else text(pct(ind), "#ececef");
    label =
      `MSRP window sticker for ${coinTitle(sticker.name, sticker.symbol)}: ${starLabel(stars)} overall, ` +
      `${ind === null ? "independent share unknown" : `${pct(ind)} of supply held by independent wallets`}, checked ${dateShort(sticker.computedAt)}.`;
  }
  const width = Math.ceil(x - GAP + PAD);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(label)}">` +
    `<title>${esc(label)}</title><desc>${esc(DISCLAIMER)}</desc>` +
    `<rect x=".5" y=".5" width="${width - 1}" height="${H - 1}" rx="${(H - 1) / 2}" fill="#0c0c0e" stroke="#26262b"/>` +
    `<g font-family="${SVG_MONO}" font-size="${FONT}">${parts.join("")}</g>` +
    `</svg>`
  );
}
