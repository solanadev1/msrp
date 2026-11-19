/**
 * Limits on NEW stickers (each one costs up to LIMITS.MAX_RPC_REQUESTS Solana requests).
 * Stickers that are already printed never count.
 *
 * - Per visitor (CF-Connecting-IP): RATE_LIMITS.NEW_STICKERS_PER_IP_PER_HOUR in any rolling hour.
 *   An IPv6 visitor is counted by its /64 network (one home or phone gets a whole /64, so changing the
 *   last part of the address doesn't buy a fresh allowance). Kept in memory per Worker instance, so it
 *   is best effort (Cloudflare can run several).
 * - Site-wide: RATE_LIMITS.NEW_STICKERS_PER_DAY per UTC day, counted in D1 (shared by every instance).
 *   Without a database each instance can only count itself, so it allows just
 *   RATE_LIMITS.NEW_STICKERS_PER_DAY_PER_INSTANCE_WITHOUT_DB a day.
 *
 * If the database counter fails we let the request through (the per-visitor limit still holds)
 * and log it, so a database hiccup never takes the site down.
 */
import { RATE_LIMITS } from "../config";
import type { Env } from "../types";
import { describeError } from "./errors";
import { dbOf, withSchema } from "./store";

export type LimitDecision = { ok: true } | { ok: false; scope: "ip" | "daily"; retryAfterSec: number };

export interface Limiter {
  /**
   * Reserve one new sticker computation for this visitor. Call it only right before starting a
   * computation (never for cached answers). Never throws.
   */
  take(env: Env, ip: string, now: number): Promise<LimitDecision>;
}

export interface LimiterOptions {
  perIpPerHour?: number;
  perDay?: number;
  /** Daily limit per Worker instance when there is no database (much smaller than perDay). */
  perDayWithoutDb?: number;
  /** Forget the oldest visitors when tracking more than this many (memory guard). */
  maxTrackedIps?: number;
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

const HOUR_MS = 60 * 60 * 1000;
export const DAILY_METRIC = "new_sticker";
/** Distinct visitors remembered per Worker instance before old entries are dropped. */
export const MAX_TRACKED_IPS = 5_000;

/** UTC day as YYYY-MM-DD. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Whole seconds until the next UTC midnight (at least 1). */
export function secondsUntilUtcMidnight(now: number): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

/**
 * The key a visitor is counted under: an IPv4 address as is, an IPv6 address by its /64 network
 * ("2001:db8:1:2::/64"), "unknown" outside Cloudflare (e.g. local dev).
 */
export function clientIp(request: Request): string {
  const ip = (request.headers.get("cf-connecting-ip") ?? "").trim().slice(0, 64);
  if (!ip) return "unknown";
  return ip.includes(":") ? (ipv6Prefix64(ip) ?? ip) : ip;
}

/**
 * The first four groups of an IPv6 address ("/64" network), the IPv4 address inside an IPv4-mapped
 * one, or null when it doesn't parse.
 */
export function ipv6Prefix64(ip: string): string | null {
  const text = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  // An IPv4-mapped address ("::ffff:1.2.3.4") is one IPv4 visitor: count it by that address.
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4?.[1]) return v4[1];
  if (text.includes(".")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * Increment today's counter only while it is below the limit, in one statement.
 * Returns the new count, or null when the limit was already reached (no row updated).
 */
const SQL_TAKE =
  "INSERT INTO usage (day, metric, count) VALUES (?1, ?2, 1) " +
  "ON CONFLICT(day, metric) DO UPDATE SET count = count + 1 WHERE usage.count < ?3 " +
  "RETURNING count";

export function createLimiter(options: LimiterOptions = {}): Limiter {
  const perIp = Math.max(1, options.perIpPerHour ?? RATE_LIMITS.NEW_STICKERS_PER_IP_PER_HOUR);
  const perDay = Math.max(1, options.perDay ?? RATE_LIMITS.NEW_STICKERS_PER_DAY);
  const perDayLocal = Math.max(1, Math.min(perDay, options.perDayWithoutDb ?? RATE_LIMITS.NEW_STICKERS_PER_DAY_PER_INSTANCE_WITHOUT_DB));
  const maxIps = Math.max(1, options.maxTrackedIps ?? MAX_TRACKED_IPS);
  const log = options.log ?? ((message, detail) => console.error(message, detail ?? ""));

  /** ip -> times (ms) of that visitor's new stickers in the last hour, oldest first. */
  const visitors = new Map<string, number[]>();
  /** Per-instance daily count, used when there is no database. */
  let localDay = "";
  let localCount = 0;

  function recentFor(ip: string, now: number): number[] {
    const times = (visitors.get(ip) ?? []).filter((t) => now - t < HOUR_MS && t <= now + HOUR_MS);
    if (times.length) visitors.set(ip, times);
    else visitors.delete(ip);
    return times;
  }

  function record(ip: string, now: number): void {
    const times = visitors.get(ip) ?? [];
    times.push(now);
    visitors.delete(ip); // re-insert so the Map keeps most-recent visitors last
    visitors.set(ip, times);
    if (visitors.size > maxIps) {
      for (const [key, list] of visitors) {
        if (visitors.size <= maxIps) break;
        if (!list.some((t) => now - t < HOUR_MS)) visitors.delete(key);
      }
      while (visitors.size > maxIps) {
        const oldest = visitors.keys().next();
        if (oldest.done) break;
        visitors.delete(oldest.value);
      }
    }
  }

  async function takeDaily(env: Env, now: number): Promise<boolean> {
    const day = utcDay(now);
    const db = dbOf(env);
    if (db) {
      try {
        const row = await withSchema(db, () => db.prepare(SQL_TAKE).bind(day, DAILY_METRIC, perDay).first<{ count?: unknown }>());
        return row !== null && row !== undefined;
      } catch (error) {
        log("msrp: daily counter failed, allowing this request", { error: describeError(error) });
        return true;
      }
    }
    if (localDay !== day) {
      localDay = day;
      localCount = 0;
    }
    if (localCount >= perDayLocal) return false;
    localCount++;
    return true;
  }

  return {
    async take(env, ip, now) {
      const times = recentFor(ip, now);
      if (times.length >= perIp) {
        const oldest = times[times.length - perIp] ?? times[0] ?? now;
        return { ok: false, scope: "ip", retryAfterSec: Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 1000)) };
      }
      if (!(await takeDaily(env, now))) {
        return { ok: false, scope: "daily", retryAfterSec: secondsUntilUtcMidnight(now) };
      }
      record(ip, now);
      return { ok: true };
    },
  };
}
