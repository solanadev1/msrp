/**
 * Helpers for self-contained SVG (badge, share card): text width estimates, rating dots and (legacy) star shapes.
 * No external fonts: widths are estimated from Arial/Helvetica metrics and pinned with
 * `textLength`, so the label never overflows even when a fallback font is used.
 */

/** Helvetica/Arial advance widths for ASCII 32..126, in 1/1000 em. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Estimated rendered width of `text` in px at `size` px (bold adds ~6%). Non-ASCII counts as a wide glyph. */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    units += c >= 32 && c <= 126 ? (WIDTHS[c - 32] ?? 556) : c === 0x2026 ? 1000 : 700;
  }
  return Math.ceil((units / 1000) * size * (bold ? 1.06 : 1));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Points of a five-pointed star centred on (cx, cy) with outer radius `R`. */
export function starPoints(cx: number, cy: number, R: number): string {
  const inner = R * 0.42;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${r2(cx + rad * Math.cos(a))},${r2(cy + rad * Math.sin(a))}`);
  }
  return pts.join(" ");
}

/** Five stars as polygons: `filled` solid, the rest outlined. */
export function starRow(x: number, cy: number, R: number, filled: number, gap: number, stroke: number): string {
  let out = "";
  for (let i = 0; i < 5; i++) {
    const cx = x + R + i * (2 * R + gap);
    out +=
      i < filled
        ? `<polygon points="${starPoints(cx, cy, R)}" fill="#000"/>`
        : `<polygon points="${starPoints(cx, cy, R - stroke / 2)}" fill="none" stroke="#000" stroke-width="${stroke}" stroke-linejoin="round"/>`;
  }
  return out;
}

/** Width taken by `starRow` for the same R and gap. */
export function starRowWidth(R: number, gap: number): number {
  return 5 * 2 * R + 4 * gap;
}

/** Width of monospace text (JetBrains Mono / Menlo advance is 0.6 em). Counts code points. */
export function monoWidth(text: string, size: number): number {
  return Math.ceil(Array.from(text).length * size * 0.6);
}

/** Shared SVG font stacks: no web fonts in self-contained SVG, so widths are pinned with textLength. */
export const SVG_SANS = "Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif";
export const SVG_MONO = "JetBrains Mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/** Five rating dots (filled purple for the score, #26262b for the rest) starting at x, centred on cy. */
export function dotRow(x: number, cy: number, r: number, gap: number, filled: number): string {
  let out = "";
  for (let i = 0; i < 5; i++) {
    const cx = Math.round((x + r + i * (2 * r + gap)) * 100) / 100;
    out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${i < filled ? "#a78bfa" : "#26262b"}"/>`;
  }
  return out;
}

/** Width taken by `dotRow` for the same r and gap. */
export function dotRowWidth(r: number, gap: number): number {
  return 5 * 2 * r + 4 * gap;
}
