/**
 * Every URL the UI prints, in one place, so the Worker's routes and the pages agree.
 * Paths are relative to the MSRP site; `abs()` makes them absolute for canonical/OG tags.
 */
import type { PageContext } from "../types";

const enc = encodeURIComponent;

export const paths = {
  home: "/",
  /** The address box submits here (GET, field name "mint"); the Worker redirects to `coin()`. */
  check: "/check",
  coin: (mint: string) => `/coin/${enc(mint)}`,
  example: "/example",
  methodology: "/methodology",
  pricing: "/pricing",
  about: "/about",
  api: (mint: string) => `/api/v1/sticker/${enc(mint)}`,
  badge: (mint: string) => `/badge/${enc(mint)}.svg`,
  og: (mint: string) => `/og/${enc(mint)}.svg`,
  ogDefault: "/og/default.svg",
  css: "/assets/msrp.css",
  js: "/assets/msrp.js",
  favicon: "/favicon.svg",
} as const;

export const external = {
  solscanAccount: (addr: string) => `https://solscan.io/account/${enc(addr)}`,
  solscanToken: (mint: string) => `https://solscan.io/token/${enc(mint)}`,
  solscanTx: (sig: string) => `https://solscan.io/tx/${enc(sig)}`,
  dexscreener: (mint: string) => `https://dexscreener.com/solana/${enc(mint)}`,
  issues: "https://github.com/solanadev1/msrp/issues",
  repo: "https://github.com/solanadev1/msrp",
  shareX: (text: string, url: string) => `https://x.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`,
  shareTelegram: (text: string, url: string) => `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`,
  solanaviewDev: (ctx: PageContext, wallet: string) => `${ctx.solanaviewUrl}/dev/${enc(wallet)}`,
  solanaviewPromote: (ctx: PageContext, mint: string) => `${ctx.solanaviewUrl}/promote?ref=msrp&mint=${enc(mint)}`,
  solanaview: (ctx: PageContext) => `${ctx.solanaviewUrl}/?ref=msrp`,
} as const;

/** Absolute URL on this site. */
export function abs(ctx: PageContext, path: string): string {
  return `${ctx.publicUrl.replace(/\/+$/, "")}${path}`;
}
