/**
 * Helpers for self-contained SVG (badge, share card): text width estimates and star shapes.
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
