/**
 * Small number guards and plain-language formatters shared by the engines.
 * Pure and deterministic (no locale lookups, no clocks).
 */

/** A finite number, or null. Guards every number that comes from outside the engines. */
export function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A finite number >= 0, or null. */
export function nonNegative(v: unknown): number | null {
  const n = finite(v);
  return n !== null && n >= 0 ? n : null;
}

/** A finite number > 0, or null. */
export function positive(v: unknown): number | null {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Round to `decimals` places; never returns -0. */
export function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r;
}

/** Percentages in the sticker are rounded to 2 decimals so text and numbers always agree. */
export function roundPct(v: number): number {
  return round(clamp(v, 0, 100), 2);
}

/** Sum of finite numbers. */
export function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function trim(n: number, decimals: number): string {
  return String(round(n, decimals));
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "12.5%", "0.4%", "<0.01%", "100%". */
export function fmtPct(v: number): string {
  if (v > 0 && v < 0.01) return "<0.01%";
  return `${trim(v, 2)}%`;
}

/** "1.5 SOL", "0.012 SOL", "<0.001 SOL". */
export function fmtSol(v: number): string {
  if (v > 0 && v < 0.001) return "<0.001 SOL";
  return `${trim(v, 3)} SOL`;
}

/** "$48,000", "$12.34", "$0.50". */
export function fmtUsd(v: number): string {
  if (v >= 100) return `$${group(String(Math.round(v)))}`;
  const [i, f] = round(v, 2).toFixed(2).split(".");
  return `$${group(i ?? "0")}.${f ?? "00"}`;
}

/** "under 1 minute", "4 minutes", "4.5 minutes", "3 hours", "6 days". */
export function fmtMinutes(min: number): string {
  if (min < 1) return "under 1 minute";
  if (min < 10) return plural(round(min, 1), "minute");
  if (min < 120) return plural(Math.round(min), "minute");
  if (min < 48 * 60) return plural(round(min / 60, 1), "hour");
  return plural(Math.round(min / (60 * 24)), "day");
}

/** "1 wallet", "3 wallets", "1.5 hours". */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** Short wallet form for titles: "Abcd...wxyz". Full addresses go in `evidence`. */
export function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

/** Deterministic string comparison (no locale). */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Unique, order-preserving, capped list of non-empty strings. */
export function uniqueList(items: Iterable<string | null | undefined>, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}
