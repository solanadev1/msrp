/**
 * Every MSRP page. Pure functions: data in, a full HTML document out. No network, no clock.
 * Look follows docs/DESIGN.md ("simple"): one dark column, a title and terse rows. No prose.
 */
import { ENGINE_RULES } from "../engines/rules";
import type { MethodologyRule, PageContext, RecentSticker, Sticker } from "../types";
import { CACHE, DISCLAIMER, LIMITS, RATE_LIMITS, THRESHOLDS } from "../config";
import { cleanLabel, esc } from "./escape";
import { pct, short } from "./format";
import { addressForm, ext, page } from "./layout";
import { external, paths } from "./paths";
import { coinTitle, coverageLine, dots, independentShown, isExample, renderStickerBody } from "./sticker";

/** Terse two-column rows (label → value). Values must be escaped HTML. */
function rows(items: [string, string][], cls = ""): string {
  return `<dl class="rows${cls ? ` ${cls}` : ""}">${items.map(([k, v]) => `<div class="row"><dt>${esc(k)}</dt><dd class="v">${v}</dd></div>`).join("")}</dl>`;
}

/** Title + one mono subline, the same rhythm as a coin page. */
function head(title: string, sub: string): string {
  return `<header class="coin"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</header>`;
}

/** A small dim mono label above a group of rows (other pages only; never on the coin page). */
function label(text: string, id = ""): string {
  return `<h2 class="lb"${id ? ` id="${esc(id)}"` : ""}>${esc(text)}</h2>`;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

/**
 * Anyone can mint a coin, name it "claim msrp airdrop at evil.example" and check it once: the home
 * list must not repeat that to every visitor. Names that look like a link, a handle, a domain or a
 * call to claim something are replaced by the coin's short address there (the coin page still
 * shows the name, as data about the coin).
 */
const PROMO_TEXT = /https?:|www\.|\b[a-z0-9-]{2,}\.[a-z]{2,}\b|t\.me\/|@\w|\bmsrp\b|airdrop|claim|giveaway/i;
export function listLabel(text: string | null, max: number): string | null {
  const label = cleanLabel(text, max);
  return label && !PROMO_TEXT.test(label) ? label : null;
}

function recentRow(r: RecentSticker): string {
  const name = listLabel(r.name, 40);
  const sym = listLabel(r.symbol, 12);
  const main = name ?? (sym ? `$${sym}` : short(r.mint));
  const ind = r.independentPct;
  return (
    `<a class="rec" href="${esc(paths.coin(r.mint))}">` +
    `<span class="nm">${esc(main)}${name && sym ? ` <span class="sym">${esc(sym)}</span>` : ""}</span>` +
    dots(r.overallStars, true) +
    `<span class="pc${ind === null ? " t3" : ind < 20 ? " r" : ""}" title="Independent share of total supply">` +
    `${ind === null ? "—" : esc(pct(ind))}<span class="vh"> independent${ind === null ? ": unknown" : ""}</span></span>` +
    `</a>`
  );
}

export function renderHome(ctx: PageContext, recent: RecentSticker[]): string {
  const list = recent.slice(0, 12).map(recentRow);
  const body =
    `<section class="home"><h1>who made it · who holds it</h1>` +
    addressForm("", true) +
    `<nav class="recent" aria-label="Recently checked">` +
    (list.length ? list.join("") : `<a class="rec ex" href="${paths.example}"><span class="nm">example</span><span class="pc t3">→</span></a>`) +
    `</nav></section>`;
  return page(ctx, {
    title: "MSRP: the window sticker for Solana meme coins",
    description:
      "Paste a Solana coin address and get its window sticker: who made it, who really holds it, and the market cap held by independent wallets. Read-only, free.",
    path: paths.home,
    body,
    hideForm: true,
  });
}

// ---------------------------------------------------------------------------
// Sticker
// ---------------------------------------------------------------------------

export function renderSticker(ctx: PageContext, sticker: Sticker): string {
  const title = coinTitle(sticker.name, sticker.symbol);
  const stars = sticker.ratings.overall.stars;
  const bits = [stars === null ? "Not rated." : `${stars} of 5 overall.`];
  const ind = independentShown(sticker);
  if (ind !== null) bits.push(`${pct(ind)} of supply held by independent wallets.`);
  bits.push("Who made it and who holds it, from public Solana data.");
  const example = isExample(sticker);
  return page(ctx, {
    title: `${title} window sticker`,
    description: bits.join(" "),
    path: example ? paths.example : paths.coin(sticker.mint),
    ogImage: paths.og(sticker.mint),
    body: renderStickerBody(ctx, sticker),
    noindex: example,
    foot: coverageLine(sticker),
  });
}

// ---------------------------------------------------------------------------
// Waiting page
// ---------------------------------------------------------------------------

/** Steps shown while a sticker is computed. They tick off when the sticker is ready. */
export const PRINT_STEPS = ["creator", "family", "holders"] as const;

export function renderPrinting(ctx: PageContext, mint: string): string {
  // Without JavaScript the page moves on to the route that computes the sticker inline (?wait=1).
  const noJs = `${paths.coin(mint)}?wait=1`;
  const body =
    `<article class="wait" id="wait" data-api="${esc(paths.api(mint))}" data-next="${esc(paths.coin(mint))}">` +
    `<header class="coin"><h1>checking</h1><p class="sub"><span class="mint">${esc(mint)}</span></p></header>` +
    `<div class="hero"><div><span class="big unk" aria-hidden="true">…</span>` +
    `<p class="cap" id="wait-status" aria-live="polite">reading the chain · up to ${Math.round(LIMITS.DEADLINE_MS / 1000)}s</p></div></div>` +
    `<ol class="steps">` +
    PRINT_STEPS.map((s) => `<li><span>${esc(s)}</span><b class="ok">…</b></li>`).join("") +
    `</ol>` +
    `<p class="err" id="wait-error" role="alert" hidden></p>` +
    `<noscript><p class="cap"><a href="${esc(noJs)}">check now</a></p></noscript>` +
    `</article>`;
  return page(ctx, {
    title: "Checking a coin",
    description: "Reading the blockchain to print this coin's window sticker.",
    path: paths.coin(mint),
    body,
    noindex: true,
    head: `<noscript><meta http-equiv="refresh" content="${esc(`1;url=${noJs}`)}"></noscript>\n`,
  });
}

// ---------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------

const ENGINE_LABEL: Record<MethodologyRule["engine"], string> = {
  build: "who made it",
  crowd: "who holds it",
  market: "market",
  overall: "overall",
};

export function renderMethodology(ctx: PageContext, rules: MethodologyRule[]): string {
  const order: MethodologyRule["engine"][] = ["build", "crowd", "market", "overall"];
  const groups = order
    .filter((e) => rules.some((r) => r.engine === e))
    .map(
      (engine) =>
        label(ENGINE_LABEL[engine], engine) +
        `<div class="rules">` +
        rules
          .filter((r) => r.engine === engine)
          .map(
            (r) =>
              `<details class="rule" id="${esc(r.id)}"><summary><span>${esc(r.title)}</span><span class="t3">↓</span></summary>` +
              `<dl class="kv"><div><dt>rule</dt><dd>${esc(r.rule)}</dd></div><div><dt>why</dt><dd class="t2">${esc(r.why)}</dd></div>` +
              `<div><dt>limits</dt><dd class="t2">${esc(r.limits)}</dd></div></dl></details>`,
          )
          .join("") +
        `</div>`,
    )
    .join("");

  const body =
    head("how it works", "every rule · straight from the code") +
    rows([
      ["sticker price", "market cap × independent share of total supply"],
      ["independent", `top holder · traced · no link · ≤${ENGINE_RULES.DOMINANT_WALLET_PCT}% each`],
      ["linked", "creator · same funder · launch block · similar funding"],
      ["untraced", `outside top ${LIMITS.TOP_HOLDERS} or not traceable · never independent`],
      ["unknown", "shown as unknown · never 0"],
      ["ratings", "transparency of ownership · not price"],
      ["budget", esc(`${LIMITS.MAX_RPC_REQUESTS} calls · ${LIMITS.DEADLINE_MS / 1000}s · cached ${CACHE.STICKER_TTL_SEC / 60} min`)],
    ]) +
    groups;

  return page(ctx, {
    title: "How MSRP works",
    description:
      "Every rule behind an MSRP window sticker, with exact thresholds and limits: deployer funding, wallet families, linked holders, launch-block buyers and market data.",
    path: paths.methodology,
    body,
  });
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export function renderPricing(ctx: PageContext): string {
  const body =
    head("pricing", "free · ratings can&#39;t be bought") +
    rows([
      ["free", `$0 <span class="t3">· stickers · badge · api</span>`],
      ["pro", `soon <span class="t3">· api · alerts ·</span> ${ext(external.issues, "ask ↗")}`],
      ["listing", `4+ stars <span class="t3">· sponsored ·</span> ${ext(external.solanaview(ctx), "SolanaView ↗")}`],
    ]);
  return page(ctx, {
    title: "Pricing",
    description: "MSRP stickers, badges and the API are free. Pro API and alerts are coming. Ratings can't be bought.",
    path: paths.pricing,
    body,
  });
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

export function renderAbout(ctx: PageContext): string {
  const T = THRESHOLDS;
  const body =
    head("about", "who made it · who holds it") +
    rows([
      ["who made it", "creator ← funder · family · launches · fast sells"],
      ["who holds it", `top ${LIMITS.TOP_HOLDERS} · linked / pool / independent / untraced`],
      ["sticker price", "market cap × independent share"],
      ["read-only", "no wallet · no keys · no sign-up"],
      ["unknown", "shown as unknown · never 0"],
      ["links", "patterns, not proof of who controls a wallet"],
      ["ratings", "can&#39;t be bought · not a price prediction"],
    ]) +
    label("launch factory") +
    `<ol class="steps fac">` +
    [
      `fresh wallet funded ≤${T.FRESH_DEPLOYER_MIN}m before launch`,
      "creates the coin · buys in the same block",
      "rotates to sibling wallets · same funder",
      `sells within ${T.FAST_DEV_SELL_MIN}m`,
      "SOL sent back to the funder",
    ]
      .map((s) => `<li><span>${esc(s)}</span></li>`)
      .join("") +
    `</ol>` +
    label("api", "api") +
    rows(
      [
        ["sticker", `<span class="t2">GET /api/v1/sticker/&lt;address&gt;</span> <span class="t3">· json · HEAD 202 if not checked yet</span>`],
        ["badge", `<span class="t2">GET /badge/&lt;address&gt;.svg</span>`],
        ["share card", `<span class="t2">GET /og/&lt;address&gt;.svg</span>`],
        ["limit", esc(`${RATE_LIMITS.NEW_STICKERS_PER_IP_PER_HOUR} new stickers/h per visitor · cached ones free`)],
        ["source", `${ext(external.repo, "github ↗")} <span class="t3">·</span> ${ext(external.issues, "report a problem ↗")}`],
      ],
      "mono",
    ) +
    `<p class="note">${esc(DISCLAIMER)}</p>`;
  return page(ctx, {
    title: "About",
    description:
      "MSRP prints a window sticker for Solana meme coins: who made it, who holds it, and the market cap held by independent wallets. Read-only, no accounts.",
    path: paths.about,
    body,
  });
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function back(): string {
  return `<p class="links"><a href="${paths.home}">home</a><a href="${paths.example}">example</a></p>`;
}

export function renderNotFound(ctx: PageContext): string {
  return page(ctx, {
    title: "Not found",
    description: "This page doesn't exist.",
    path: "/404",
    noindex: true,
    body: head("not found", `404 · coin pages look like /coin/&lt;address&gt;`) + back(),
  });
}

export function renderError(ctx: PageContext, title: string, message: string, status: number): string {
  const code = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500;
  return page(ctx, {
    title,
    description: message,
    path: "/error",
    noindex: true,
    body: head(title, `${code} · ${esc(message)}`) + back(),
  });
}
