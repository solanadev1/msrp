/**
 * Display formatting for the UI. Deterministic: no locale lookups, no clock.
 * Every formatter takes `number | null` and prints "Unknown" for null; never 0.
 */
import type { Stars } from "../types";

export const UNKNOWN = "Unknown";

function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Three significant figures, trailing zeros kept only where they carry precision ("48.0" -> "48"). */
function sig3(v: number): string {
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 100) / 100);
}

/** "$48K", "$6.96K", "$1.84M", "$960", "$0.50". */
export function usdShort(v: number | null | undefined): string {
  if (!isNum(v)) return UNKNOWN;
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${sig3(a / 1e9)}B`;
  if (a >= 1e6) return `${sign}$${sig3(a / 1e6)}M`;
  if (a >= 1e3) return `${sign}$${sig3(a / 1e3)}K`;
  if (a >= 1) return `${sign}$${group(String(Math.round(a)))}`;
  return `${sign}$${a.toFixed(2)}`;
}

/** Full dollars for tables: "$48,000", "$12.34". */
export function usdFull(v: number | null | undefined): string {
  if (!isNum(v)) return UNKNOWN;
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 100) return `${sign}$${group(String(Math.round(a)))}`;
  return `${sign}$${a.toFixed(2)}`;
}

/** Token prices are often tiny: "$0.0000480", "$1.23". Three significant digits. */
export function usdPrice(v: number | null | undefined): string {
  if (!isNum(v)) return UNKNOWN;
  if (v === 0) return "$0";
  if (Math.abs(v) >= 1) return usdFull(v);
  const digits = Math.min(12, Math.max(2, 2 - Math.floor(Math.log10(Math.abs(v)))));
  return `$${v.toFixed(digits)}`;
}

/** "34.5%", "<0.1%", "100%". One decimal; whole numbers drop the ".0". */
export function pct(v: number | null | undefined): string {
  if (!isNum(v)) return UNKNOWN;
  if (v > 0 && v < 0.1) return "<0.1%";
  const r = Math.round(v * 10) / 10;
  return `${r === 0 ? 0 : r}%`;
}

/** "+3.2%" / "-12.5%" for changes. */
export function pctChange(v: number | null | undefined): string {
  if (!isNum(v)) return UNKNOWN;
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? "+" : ""}${r === 0 ? 0 : r}%`;
}

/** "1.2 SOL", "0.012 SOL", "<0.001 SOL". */
export function sol(v: number | null | undefined): string {
  if (!isNum(v)) return UNKNOWN;
  if (v > 0 && v < 0.001) return "<0.001 SOL";
  return `${Math.round(v * 1000) / 1000} SOL`;
}

/** "under 1 min", "4 min", "3.5 hours", "6 days". */
export function minutes(v: number | null | undefined): string {
  if (!isNum(v)) return UNKNOWN;
  if (v < 1) return "under 1 min";
  if (v < 120) return `${Math.round(v)} min`;
  if (v < 48 * 60) return `${Math.round((v / 60) * 10) / 10} hours`;
  return `${Math.round(v / 1440)} days`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "14 Oct 2026 18:00 UTC". */
export function dateTime(ms: number | null | undefined): string {
  if (!isNum(ms)) return UNKNOWN;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/** "14 Oct 2026". */
export function dateLong(ms: number | null | undefined): string {
  if (!isNum(ms)) return UNKNOWN;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()}`;
}

/** "14 Oct" (badge). */
export function dateShort(ms: number | null | undefined): string {
  if (!isNum(ms)) return UNKNOWN;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""}`;
}

/** ISO 8601 for <time datetime>. */
export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** "★★☆☆☆" or "Not rated". */
export function starText(stars: Stars): string {
  if (stars === null) return "Not rated";
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

/** Screen-reader text: "2 of 5 stars" or "Not rated". */
export function starLabel(stars: Stars): string {
  return stars === null ? "Not rated" : `${stars} of 5 stars`;
}

/**
 * Shortens addresses for display ("7xKp…Qe2D") while keeping every address on one page
 * distinguishable: when two addresses would print the same, both keep more of their start.
 */
export function makeShortener(addresses: Iterable<string>): (addr: string) => string {
  const all = Array.from(new Set(addresses));
  const cache = new Map<string, string>();
  const TAIL = 4;
  return (addr: string) => {
    const hit = cache.get(addr);
    if (hit !== undefined) return hit;
    let out = addr;
    if (addr.length > 12) {
      const tail = addr.slice(-TAIL);
      const rivals = all.filter((b) => b !== addr && b.slice(-TAIL) === tail);
      let head = 4;
      while (head < addr.length - TAIL - 1 && rivals.some((b) => b.slice(0, head) === addr.slice(0, head))) head++;
      out = head >= addr.length - TAIL - 1 ? addr : `${addr.slice(0, head)}…${tail}`;
    }
    cache.set(addr, out);
    return out;
  };
}

/** Plain short form without uniqueness checks ("7xKp…Qe2D"). */
export function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}
