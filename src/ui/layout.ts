/**
 * The page shell every MSRP page shares: head tags (title, description, canonical, Open Graph),
 * the top line (mark + address field), and the one-line monospace footer.
 *
 * Look (docs/DESIGN.md, "ultra minimal"): one dark 680px column, hairlines only, no boxes.
 * No inline scripts anywhere: the one script is /assets/msrp.js, so a strict CSP works.
 * Fonts come from Google Fonts (allowed by the CSP) with system fallbacks.
 */
import type { PageContext } from "../types";
import { esc } from "./escape";
import { abs, external, paths } from "./paths";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap";

export interface PageOptions {
  /** Shown in the browser tab; " · MSRP" is added unless it already starts with "MSRP". */
  title: string;
  description: string;
  /** Site path for the canonical URL, e.g. "/coin/<mint>". */
  path: string;
  /** Site path of the share image. Defaults to the generic card. */
  ogImage?: string;
  body: string;
  /** Prefill for the address field. */
  query?: string;
  /** Hide the small address field (the home page draws its own, bigger one). */
  hideForm?: boolean;
  /** Extra tags for <head> (already escaped). */
  head?: string;
  /** Ask search engines not to index (error pages, waiting page). */
  noindex?: boolean;
  bodyAttrs?: string;
  /** Left half of the monospace footer line (already escaped). Defaults to the read-only line. */
  foot?: string;
}

/**
 * The address field: an underline, a monospace placeholder and a "/" hint. Submits with Enter
 * (GET /check?mint=...), so it works without JavaScript; msrp.js adds "/" to focus and paste-to-open.
 */
export function addressForm(query = "", big = false): string {
  return (
    `<form class="${big ? "big" : "q"}" action="${paths.check}" method="get" role="search">` +
    `<label class="vh" for="q">Solana coin address</label>` +
    `<input id="q" name="mint" value="${esc(query)}" placeholder="paste a coin address" autocomplete="off" ` +
    `autocapitalize="off" spellcheck="false" maxlength="64" aria-keyshortcuts="/" required>` +
    `<kbd title="Press / to jump here">/</kbd><button class="vh" type="submit">Check</button>` +
    `</form>`
  );
}

const DEFAULT_FOOT = "read-only · no wallet · no sign-up";

export function page(ctx: PageContext, o: PageOptions): string {
  const fullTitle = o.title.startsWith("MSRP") ? o.title : `${o.title} · MSRP`;
  const canonical = abs(ctx, o.path);
  const image = abs(ctx, o.ogImage ?? paths.ogDefault);
  const right = o.hideForm
    ? `<nav class="nav" aria-label="Site"><a href="${paths.methodology}">Method</a><a href="${paths.about}#api">API</a></nav>`
    : addressForm(o.query);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0c0c0e">
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(FONTS)}">
<link rel="stylesheet" href="${paths.css}">
<script src="${paths.js}" defer></script>
${o.head ?? ""}</head>
<body${o.bodyAttrs ? ` ${o.bodyAttrs}` : ""}><div class="w">
<header class="top"><a class="mark" href="${paths.home}" aria-label="MSRP home"><i></i>msrp</a>${right}</header>
<main id="main">
${o.body}
</main>
<footer class="foot"><p><span>${o.foot ?? DEFAULT_FOOT}</span><span>public data · not financial advice</span></p>
<nav aria-label="More"><a href="${paths.methodology}">method</a><a href="${paths.pricing}">pricing</a><a href="${paths.about}">about</a><a href="${paths.example}">example</a>${ext(external.repo, "source")}${ext(external.issues, "report a problem")}</nav></footer>
</div></body></html>`;
}

/** An external link: always new tab, never passes our page as opener, never endorses the target. `text` must be escaped. */
export function ext(href: string, text: string, attrs = ""): string {
  return `<a href="${esc(href)}" rel="noopener nofollow" target="_blank"${attrs ? ` ${attrs}` : ""}>${text}</a>`;
}
