/**
 * The page shell every MSRP page shares: head tags (title, description, canonical, Open Graph),
 * the top bar, the address box and the footer. No inline scripts anywhere: the one script is
 * /assets/msrp.js, so a strict Content-Security-Policy works.
 */
import type { PageContext } from "../types";
import { esc } from "./escape";
import { abs, external, paths } from "./paths";

export interface PageOptions {
  /** Shown in the browser tab; " · MSRP" is added unless it already starts with "MSRP". */
  title: string;
  description: string;
  /** Site path for the canonical URL, e.g. "/coin/<mint>". */
  path: string;
  /** Site path of the share image. Defaults to the generic card. */
  ogImage?: string;
  body: string;
  /** Prefill for the address box. */
  query?: string;
  /** Hide the address box (the home page draws its own, bigger one). */
  hideForm?: boolean;
  /** Extra tags for <head> (already escaped). */
  head?: string;
  /** Ask search engines not to index (error pages, waiting page). */
  noindex?: boolean;
  bodyAttrs?: string;
}

export function addressForm(query = "", big = false): string {
  return (
    `<form class="q${big ? " qb" : ""}" action="${paths.check}" method="get" role="search">` +
    `<label for="q">Paste a Solana coin address:</label>` +
    `<span class="qrow"><input id="q" name="mint" value="${esc(query)}" autocomplete="off" autocapitalize="off" ` +
    `spellcheck="false" inputmode="text" maxlength="64" placeholder="e.g. 7xKp…pump" required>` +
    `<button type="submit">Check</button></span>` +
    `<small class="hint">Press <kbd>/</kbd> to jump here. Pasting an address checks it.</small>` +
    `</form>`
  );
}

export function page(ctx: PageContext, o: PageOptions): string {
  const fullTitle = o.title.startsWith("MSRP") ? o.title : `${o.title} · MSRP`;
  const canonical = abs(ctx, o.path);
  const image = abs(ctx, o.ogImage ?? paths.ogDefault);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#ffffff">
${o.noindex ? '<meta name="robots" content="noindex">\n' : ""}<meta property="og:site_name" content="MSRP">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${paths.favicon}" type="image/svg+xml">
<link rel="stylesheet" href="${paths.css}">
<script src="${paths.js}" defer></script>
${o.head ?? ""}</head>
<body${o.bodyAttrs ? ` ${o.bodyAttrs}` : ""}><div class="wrap">
<header class="top"><a class="brand" href="${paths.home}"><b>MSRP</b> <span>window stickers for Solana coins</span></a>
<nav><a href="${paths.methodology}">how it works</a><a href="${paths.pricing}">pricing</a><a href="${paths.about}">about</a></nav></header>
${o.hideForm ? "" : addressForm(o.query)}
<main id="main">
${o.body}
</main>
<footer class="foot">Read-only. MSRP never asks for a wallet, a key or a signature. Public blockchain data only. Not financial advice.
<br><a href="${paths.example}">example sticker</a> <a href="${paths.methodology}">methodology</a> <a href="${esc(external.repo)}" rel="noopener nofollow" target="_blank">source code</a> <a href="${esc(external.issues)}" rel="noopener nofollow" target="_blank">report a problem</a></footer>
</div></body></html>`;
}

/** An external link: always new tab, never passes our page as opener, never endorses the target. */
export function ext(href: string, text: string, attrs = ""): string {
  return `<a href="${esc(href)}" rel="noopener nofollow" target="_blank"${attrs ? ` ${attrs}` : ""}>${text}</a>`;
}
