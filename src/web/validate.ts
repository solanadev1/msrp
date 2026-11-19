/**
 * Input checks for the Worker. Small and local on purpose (no dependency on src/chain).
 *
 * A Solana address is 32 bytes written in base58: 32 to 44 characters from the alphabet
 * below (no 0, O, I or l). We decode it to make sure it really is 32 bytes, so typos that
 * happen to be the right length are still caught.
 */
import type { Env } from "../types";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = (() => {
  const map = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) map[ALPHABET.charCodeAt(i)] = i;
  return map;
})();

/** Public mainnet RPC used when no custom one is configured. */
export const PUBLIC_RPC_URL = "https://api.mainnet-beta.solana.com";

/** Default SolanaView address when the variable is missing (same value as wrangler.jsonc). */
export const DEFAULT_SOLANAVIEW_URL = "https://solanaview.dev";

/** Number of bytes a base58 string decodes to, or null if it is not base58. */
export function base58ByteLength(value: string): number | null {
  if (value.length === 0) return 0;
  // Big-endian base-256 digits, built up one base58 character at a time.
  const bytes: number[] = [];
  let zeros = 0;
  let leading = true;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const digit = code < 128 ? (INDEX[code] ?? -1) : -1;
    if (digit < 0) return null;
    if (leading && digit === 0) {
      zeros++;
      continue;
    }
    leading = false;
    let carry = digit;
    for (let j = bytes.length - 1; j >= 0; j--) {
      carry += (bytes[j] ?? 0) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.unshift(carry & 0xff);
      carry >>= 8;
    }
  }
  return zeros + bytes.length;
}

/** True for a well-formed Solana address (mint, wallet or program). */
export function isValidMint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 32 || value.length > 44) return false;
  return base58ByteLength(value) === 32;
}

/** Longest input we bother looking at (anything longer is not an address or a coin link). */
const MAX_INPUT = 512;

/**
 * Turn what a visitor typed or pasted into a mint address, or null.
 * Accepts the bare address (spaces and quotes around it are ignored) or a link that contains
 * it, for example a pump.fun, Solscan or Birdeye coin page.
 */
export function normalizeMintInput(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.slice(0, MAX_INPUT).trim().replace(/^["'`<([]+|["'`>)\].,;]+$/g, "").trim();
  if (!text) return null;
  if (isValidMint(text)) return text;
  // A pasted link: look for an address in the path (last segment first), then in the query.
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    const segments = url.pathname.split("/").filter(Boolean).reverse();
    for (const segment of segments) {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        continue;
      }
      if (isValidMint(decoded)) return decoded;
    }
    for (const value of url.searchParams.values()) {
      const v = value.trim();
      if (isValidMint(v)) return v;
    }
  }
  return null;
}

/** Decode one URL path segment; null when the encoding is broken. */
export function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** An absolute http(s) base URL without a trailing slash, or null. */
export function cleanBaseUrl(value: string | null | undefined, httpsOnly = false): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && (httpsOnly || url.protocol !== "http:")) return null;
  if (url.username || url.password) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Which Solana RPC to use. The custom URL is a Cloudflare secret that usually contains an API
 * key, so callers must never print `url`; show `kind` instead.
 */
export function rpcFromEnv(env: Pick<Env, "SOLANA_RPC_URL">): { url: string; kind: "custom" | "public" } {
  const raw = typeof env.SOLANA_RPC_URL === "string" ? env.SOLANA_RPC_URL.trim() : "";
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" && url.hostname) return { url: raw, kind: "custom" };
    } catch {
      // fall through to the public RPC
    }
  }
  return { url: PUBLIC_RPC_URL, kind: "public" };
}
