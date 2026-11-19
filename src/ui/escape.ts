/**
 * Escaping for everything MSRP prints. Token names, symbols and image URLs come from
 * untrusted on-chain metadata, so EVERY dynamic string goes through one of these
 * before it reaches HTML or SVG.
 *
 * - `esc` is safe for HTML/SVG text and for quoted attribute values (it escapes & < > " ').
 * - `cleanText` removes characters that can corrupt a page or fool a reader:
 *   control characters (invalid in XML, so they would break SVG), lone surrogates and
 *   bidirectional overrides (which can make "SAFE" display as "EFAS").
 * - `safeUrl` only lets absolute http/https URLs through. Everything else
 *   (javascript:, data:, vbscript:, relative tricks) becomes null.
 */

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Characters we drop: C0 controls except tab/newline/CR, DEL, C1 controls, bidi embeddings,
 * overrides and isolates, lone surrogates, and the XML non-characters U+FFFE / U+FFFF.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Remove characters that are invalid in XML or that can reorder text visually. */
export function cleanText(value: string): string {
  return value.replace(UNSAFE_CHARS, "");
}

/** Escape for HTML or SVG text and for quoted attribute values. Accepts anything; null/undefined become "". */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return cleanText(String(value)).replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

/** Alias kept for readability where the value lands inside an attribute. */
export const escAttr = esc;

/**
 * A token name or symbol from metadata: cleaned, whitespace collapsed, capped in length.
 * Returns null when nothing printable is left. The result still needs `esc` when printed.
 */
export function cleanLabel(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = cleanText(value).replace(/\s+/g, " ").trim();
  if (!s) return null;
  // Cap by code points so we never cut an emoji in half.
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : s;
}

/**
 * An absolute http(s) URL, normalised by the URL parser, or null.
 * Use for every URL that came from outside MSRP (image URLs, DEX pair URLs).
 */
export function safeUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = cleanText(value).trim();
  if (!raw || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname) return null;
  // No credentials in links we print.
  if (url.username || url.password) return null;
  return url.href;
}

/** Solana addresses and signatures are base58: no 0, O, I or l. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** True for strings that look like a Solana address (32-44 base58 chars). */
export function isAddress(value: string): boolean {
  return value.length >= 32 && value.length <= 44 && BASE58.test(value);
}

/** True for strings that look like a transaction signature (64 bytes in base58: 86-88 chars). */
export function isSignature(value: string): boolean {
  return value.length >= 80 && value.length <= 90 && BASE58.test(value);
}
