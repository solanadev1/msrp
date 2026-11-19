/**
 * Every MSRP page. Pure functions: data in, a full HTML document out. No network, no clock.
 * Look follows docs/DESIGN.md ("ultra minimal"): one quiet column, a big title, then plain
 * sections separated by hairlines. Copy: short plain sentences, numbers first, no advice.
 */
import type { MethodologyRule, PageContext, RecentSticker, Sticker } from "../types";
import { CACHE, LIMITS, RATE_LIMITS, THRESHOLDS } from "../config";
import { cleanLabel, esc } from "./escape";
import { dayTime, iso, pct, starText } from "./format";
import { addressForm, ext, page } from "./layout";
import { external, paths } from "./paths";
import { coinTitle, coverageLine, dots, isExample, renderStickerBody } from "./sticker";

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function recentRow(r: RecentSticker): string {
  const name = cleanLabel(r.name, 40);
  const sym = cleanLabel(r.symbol, 12);
  const label = name ?? (sym ? `$${sym}` : "Unnamed coin");
  const ind = r.independentPct;
  return (
    `<a class="rec" href="${esc(paths.coin(r.mint))}">` +
    `<span class="nm">${esc(label)}${name && sym ? ` <span class="m faint">$${esc(sym)}</span>` : ""}</span>` +
    `<span class="r">${dots(r.overallStars)}</span>` +
    `<span class="r${ind !== null && ind < 20 ? " red" : ind === null ? " faint" : ""}" title="Independent share of circulating supply">` +
    `${ind === null ? "—" : esc(pct(ind))}<span class="vh"> independent</span></span>` +
    `<span class="r faint hide"><time datetime="${iso(r.computedAt)}" data-ago>${esc(dayTime(r.computedAt).replace(" UTC", ""))}</time></span>` +
    `</a>`
  );
}

export function renderHome(ctx: PageContext, recent: RecentSticker[]): string {
  const rows = recent.slice(0, 15).map(recentRow);
  const recentBlock =
    `<section class="recent"><h2>Recently checked</h2>` +
    (rows.length
      ? rows.join("")
      : `<p class="fine">Nothing checked yet. Paste an address above, or open the <a class="lnk" href="${paths.example}">example sticker</a>.</p>`) +
    `</section>`;

  const what: [string, string][] = [
    ["Who made it", "The creator wallet, the wallet that paid it, the other wallets that funder paid, and every coin they launched."],
    ["Who holds it", `The top ${LIMITS.TOP_HOLDERS} holders, split into pools, linked wallets and independent wallets.`],
    ["Sticker price", "Market cap × the share held by independent wallets: the part of the price that isn't the creator's own circle."],
  ];

  const body =
    `<section class="homehero"><h1>Who made it.<br><span>Who holds it.</span></h1>` +
    `<p>Paste any Solana coin. We trace the creator's money, its other wallets and everything they've launched, then show how much of the coin strangers really own.</p>` +
    addressForm("", true) +
    `<p class="try">Read-only, free, no wallet. <a class="lnk" href="${paths.example}">See an example</a></p>` +
    `</section>` +
    recentBlock +
    `<section class="what"><h2>On every sticker</h2>` +
    what.map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span>${esc(v)}</span></div>`).join("") +
    `</section>`;

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
  const h = sticker.headline;
  const bits = [`${starText(sticker.ratings.overall.stars)} overall.`];
  if (h.independentPct !== null) bits.push(`${pct(h.independentPct)} of circulating supply held by independent wallets.`);
  if (h.insiderPct !== null) bits.push(`Linked wallets hold ${pct(h.insiderPct)}.`);
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
export const PRINT_STEPS = [
  "Reading the coin",
  "Finding who made it",
  "Tracing who funded the creator",
  "Looking for other wallets with the same funder",
  "Counting the coins they launched",
  "Reading the largest holders",
  "Tracing who funded the holders",
  "Checking who bought in the launch block",
  "Getting market data from DEX Screener",
] as const;

export function renderPrinting(ctx: PageContext, mint: string): string {
  const body =
    `<section class="wait" id="wait" data-api="${esc(paths.api(mint))}" data-next="${esc(paths.coin(mint))}">` +
    `<header class="coin"><h1>Checking <span>this coin</span></h1>` +
    `<p class="meta"><span class="m">${esc(mint)}</span></p></header>` +
    `<p class="say">Nobody has checked this coin in the last ${Math.round(CACHE.STICKER_TTL_SEC / 60)} minutes, so we're reading the blockchain now. ` +
    `It usually takes 5 to ${Math.round(LIMITS.DEADLINE_MS / 1000)} seconds, and the sticker opens here by itself.</p>` +
    `<ol class="steps">` +
    PRINT_STEPS.map((s) => `<li><span>${esc(s.charAt(0).toLowerCase() + s.slice(1))}</span><i aria-hidden="true"></i><b class="ok">…</b></li>`).join("") +
    `</ol>` +
    `<p class="status" id="wait-status" aria-live="polite">working</p>` +
    `<p class="err" id="wait-error" role="alert" hidden></p>` +
    `<noscript><p class="fine">JavaScript is off, so this page reloads by itself every 10 seconds. You can also <a class="lnk" href="${esc(paths.coin(mint))}">reload now</a>.</p></noscript>` +
    `</section>`;
  return page(ctx, {
    title: "Checking a coin",
    description: "Reading the blockchain to print this coin's window sticker.",
    path: paths.coin(mint),
    body,
    noindex: true,
    head: `<noscript><meta http-equiv="refresh" content="10"></noscript>\n`,
  });
}

// ---------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------

const ENGINE_TITLES: Record<MethodologyRule["engine"], string> = {
  build: "Who made it",
  crowd: "Who holds it",
  market: "Market",
  overall: "Overall",
};

/** Plain list rows with a small grey dot, separated by hairlines. Items must be escaped HTML. */
function plainList(items: string[]): string {
  return `<ul class="notes plain">${items.map((t) => `<li class="i"><i></i><div><p>${t}</p></div></li>`).join("")}</ul>`;
}

export function renderMethodology(ctx: PageContext, rules: MethodologyRule[]): string {
  const order: MethodologyRule["engine"][] = ["build", "crowd", "market", "overall"];
  const present = order.filter((e) => rules.some((r) => r.engine === e));
  const toc = present.map((e) => `<a href="#${e}">${esc(ENGINE_TITLES[e])}</a>`).join("");
  const sections = present
    .map((engine) => {
      const list = rules.filter((r) => r.engine === engine);
      return (
        `<section id="${engine}"><h2>${esc(ENGINE_TITLES[engine])}</h2>` +
        list
          .map(
            (r) =>
              `<div class="rule" id="${esc(r.id)}"><h3>${esc(r.title)} <a class="pl" href="#${esc(r.id)}" aria-label="Link to this rule">#</a></h3>` +
              `<dl><dt>Rule</dt><dd>${esc(r.rule)}</dd><dt>Why</dt><dd>${esc(r.why)}</dd><dt>Limits</dt><dd>${esc(r.limits)}</dd></dl></div>`,
          )
          .join("") +
        `</section>`
      );
    })
    .join("");

  const body =
    `<header class="pg"><h1>How MSRP reads a coin</h1>` +
    `<p>Every rule MSRP applies, with the exact numbers. This page is generated from the same code that prints the stickers, so it can't drift out of date.</p>` +
    `<nav class="toc" aria-label="Sections">${toc}</nav></header>` +
    `<section><h2>Ground rules</h2>` +
    plainList([
      "Read-only. MSRP reads public Solana data and DEX Screener. It never asks for a wallet, a key or a signature.",
      "Unknown is not zero. Anything we couldn't check is printed as Unknown, with the reason.",
      "Ratings measure how open the ownership is. They are not a price prediction and not advice.",
      "Wallet links are patterns, not proof of who controls a wallet.",
      "Payment never changes a sticker. SolanaView listings are separate and never affect a rating.",
      esc(
        `Each sticker uses at most ${LIMITS.MAX_RPC_REQUESTS} Solana requests and stops after ${LIMITS.DEADLINE_MS / 1000} seconds, then shows what it found. Stickers are reused for ${CACHE.STICKER_TTL_SEC / 60} minutes.`,
      ),
    ]) +
    `</section>` +
    `<section id="price"><h2>Sticker price</h2>` +
    `<p class="lead">Sticker price = market cap × the share of total supply held by independent wallets.</p>` +
    `<p class="fine">Independent wallets are top holders we traced and found no link to the creator, to each other or to the launch block. ` +
    `Pools, the bonding curve, burned coins, wallets we couldn't trace and wallets outside the top ${LIMITS.TOP_HOLDERS} are not counted as independent. ` +
    `The independent and linked percentages on a sticker are shares of the supply outside the curve, pools and burn.</p></section>` +
    sections;

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

function plan(name: string, price: string, items: string[], foot: string): string {
  return (
    `<section class="plan"><h2><span>${esc(name)}</span><span class="pr">${esc(price)}</span></h2>` +
    plainList(items) +
    `<p class="fine">${foot}</p></section>`
  );
}

export function renderPricing(ctx: PageContext): string {
  const body =
    `<header class="pg"><h1>Pricing</h1>` +
    `<p><b>Ratings can't be bought.</b> No plan, listing or payment changes what a sticker says.</p></header>` +
    plan(
      "Free",
      "$0",
      [
        "Unlimited stickers on this site.",
        "The embeddable badge for your site or Telegram.",
        esc(
          `The JSON API, with a fair-use limit of ${RATE_LIMITS.NEW_STICKERS_PER_IP_PER_HOUR} new stickers an hour per visitor. Stickers someone already checked in the last ${CACHE.STICKER_TTL_SEC / 60} minutes don't count.`,
        ),
      ],
      `<a class="lnk" href="${paths.home}">Check a coin</a>`,
    ) +
    plan(
      "Pro API and alerts",
      "Coming soon",
      ["Higher API limits and bulk checks for bots, terminals and call groups.", "Family Watch: an alert when a wallet family you follow launches another coin."],
      `${ext(external.issues, "Tell us you want it ↗", 'class="lnk"')} (opens a GitHub issue)`,
    ) +
    plan(
      "Teams",
      "Get your coin seen",
      [
        "Coins with 4 or more stars overall can buy a listing on SolanaView, a separate site run by the same team.",
        "A listing is labelled Sponsored there. It never changes the MSRP sticker.",
      ],
      ext(external.solanaview(ctx), "SolanaView listings ↗", 'class="lnk"'),
    );
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

/** How an automated launch operation works, and what the sticker looks for at each step. */
function factoryStory(): string {
  const steps: [string, string][] = [
    [
      "A master wallet sends SOL to a brand-new wallet minutes before launch.",
      `"Creator's first SOL". We flag a creator funded ${THRESHOLDS.FRESH_DEPLOYER_MIN} minutes or less before launch.`,
    ],
    [
      "The new wallet creates the coin and buys its own supply in the same transaction, sometimes with other wallets buying in the same block.",
      `"Creator's buy at launch" and the launch-block buyers in "Who holds it".`,
    ],
    [
      "After a few launches the operator switches to another fresh wallet paid by the same master wallet.",
      "The family tree: every wallet the funder paid, and how many coins each launched.",
    ],
    [
      `If nobody else buys, the bag is sold about ${THRESHOLDS.FAST_DEV_SELL_MIN} minutes later.`,
      `"sold <${THRESHOLDS.FAST_DEV_SELL_MIN}m", counted across the whole family.`,
    ],
    ["The SOL is swept back to the master wallet, ready for the next launch.", `"SOL sent back to the funder".`],
  ];
  return (
    `<ol class="notes plain">` +
    steps.map(([a, b]) => `<li class="i"><i></i><div><p>${esc(a)}</p><small>On the sticker: ${esc(b)}</small></div></li>`).join("") +
    `</ol>` +
    `<p class="fine">Plenty of honest people also use new wallets or sell early. One sign alone proves nothing; the sticker shows all of them side by side so you can judge.</p>`
  );
}

export function renderAbout(ctx: PageContext): string {
  const api: [string, string][] = [
    ["GET /api/v1/sticker/<address>", "The full sticker as JSON. Returns 202 while it's being checked."],
    ["GET /badge/<address>.svg", "The small badge for your site. Never starts a new check."],
    ["GET /og/<address>.svg", "The share card: the sticker price on near-black."],
  ];
  const body =
    `<header class="pg"><h1>About MSRP</h1>` +
    `<p>Every new car has a sticker in the window: where it was built, what's in it and what it costs. Nobody trusts the salesman; everybody reads the sticker. MSRP prints that sticker for Solana meme coins.</p></header>` +
    `<section><h2>What you see</h2>` +
    plainList([
      "<b>Who made it.</b> We trace the creator wallet back to the wallet that paid it, find the other wallets that same funder paid, and count every coin that family launched and how fast it sold.",
      "<b>Who holds it.</b> We split the top holders into pools, linked wallets (the creator, wallets linked to it or to each other, launch-block buyers) and independent wallets.",
      "<b>The sticker price.</b> The market cap times the share held by independent wallets: the part of the price that isn't the creator's own circle.",
    ]) +
    `</section>` +
    `<section><h2>How a launch factory works</h2>${factoryStory()}</section>` +
    `<section><h2>Promises</h2>` +
    plainList([
      "Read-only. MSRP never asks you to connect a wallet, never asks for a key and never sends a transaction.",
      "No accounts and no sign-up.",
      "Unknown is printed as Unknown, never as zero.",
      "We describe patterns (&quot;funded by the same wallet&quot;), not people. A link between wallets is not proof of who controls them.",
      "Ratings can't be bought. SolanaView, a listing site run by the same team, is kept separate and never changes a sticker.",
      "Not financial advice and not a price prediction.",
    ]) +
    `</section>` +
    `<section id="api"><h2>API</h2><div class="kvs">` +
    api.map(([k, v]) => `<div class="kv"><span class="m">${esc(k)}</span><span>${esc(v)}</span></div>`).join("") +
    `</div><p class="fine">Free, with a fair-use limit of ${RATE_LIMITS.NEW_STICKERS_PER_IP_PER_HOUR} new stickers an hour per visitor. Every response carries the disclaimer.</p></section>` +
    `<section><h2>Source</h2><p class="fine">The code is public: ${ext(external.repo, "github.com/solanadev1/msrp ↗", 'class="lnk"')}. Found a mistake? ${ext(external.issues, "Open an issue ↗", 'class="lnk"')}.</p></section>`;
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

export function renderNotFound(ctx: PageContext): string {
  return page(ctx, {
    title: "Not found",
    description: "This page doesn't exist.",
    path: "/404",
    noindex: true,
    body:
      `<header class="pg"><small class="code">404</small><h1>No page here</h1>` +
      `<p>Check the address, or paste a coin address in the field above. Coin pages look like <span class="m">/coin/&lt;address&gt;</span>.</p>` +
      `<p class="try"><a class="lnk" href="${paths.home}">Home</a><a class="lnk" href="${paths.example}">Example sticker</a></p></header>`,
  });
}

export function renderError(ctx: PageContext, title: string, message: string, status: number): string {
  const code = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500;
  return page(ctx, {
    title,
    description: message,
    path: "/error",
    noindex: true,
    body:
      `<header class="pg"><small class="code">Error ${code}</small><h1>${esc(title)}</h1>` +
      `<p>${esc(message)}</p><p class="try"><a class="lnk" href="${paths.home}">Home</a><a class="lnk" href="${paths.example}">Example sticker</a></p></header>`,
  });
}
