/**
 * Every MSRP page. Pure functions: data in, a full HTML document out. No network, no clock.
 * Look and copy follow docs/DESIGN.md: a printed form, short blunt sentences, numbers first.
 */
import type { MethodologyRule, PageContext, RecentSticker, Sticker } from "../types";
import { CACHE, LIMITS, RATE_LIMITS, THRESHOLDS } from "../config";
import { esc } from "./escape";
import { dateTime, iso, pct, starLabel, starText } from "./format";
import { addressForm, ext, page } from "./layout";
import { external, paths } from "./paths";
import { coinTitle, isExample, renderStickerBody } from "./sticker";

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export function renderHome(ctx: PageContext, recent: RecentSticker[]): string {
  const rows = recent.slice(0, 15).map(
    (r) =>
      `<tr><td><a href="${esc(paths.coin(r.mint))}">${esc(coinTitle(r.name, r.symbol))}</a></td>` +
      `<td class="sc">${r.overallStars === null ? `<span class="st nr">Not rated</span>` : `<span class="st" role="img" aria-label="${starLabel(r.overallStars)}">${starText(r.overallStars)}</span>`}</td>` +
      `<td class="n">${r.independentPct === null ? `<span class="mob">Independent share: </span>Unknown` : `${esc(pct(r.independentPct))}<span class="mob"> independent</span>`}</td>` +
      `<td class="n"><time datetime="${iso(r.computedAt)}">${esc(dateTime(r.computedAt).replace(/ \d{4} /, " ").replace(" UTC", ""))}</time></td></tr>`,
  );
  const recentBlock = rows.length
    ? `<h2>Recently checked</h2><table class="recent"><thead><tr><th scope="col">Coin</th><th scope="col">Overall</th>` +
      `<th scope="col" class="n">Independent</th><th scope="col" class="n">Checked (UTC)</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
    : `<h2>Recently checked</h2><p>Nothing yet. Paste an address above, or open the <a href="${paths.example}">example sticker</a>.</p>`;

  const body =
    `<h1 class="vh">MSRP: window stickers for Solana meme coins</h1>` +
    addressForm("", true) +
    `<p class="lede">MSRP prints a window sticker for any Solana meme coin, like the one on a new car. ` +
    `It shows <b>who made the coin</b> (the creator wallet, the wallet that funded it, and every other coin that family launched), ` +
    `<b>who really holds it</b> (insiders, pools and independent wallets) and the <b>sticker price</b>: the part of the market cap held by independent wallets. ` +
    `Read-only. No wallet connection, no sign-up.</p>` +
    `<p class="links"><a href="${paths.example}">See an example sticker</a><a href="${paths.methodology}">How it works</a><a href="${paths.pricing}">Pricing</a><a href="${paths.about}">About</a></p>` +
    `<div class="cols"><div>` +
    recentBlock +
    `</div><div>` +
    `<h2>What's on a sticker</h2>` +
    `<dl class="what">` +
    `<dt>Who made it</dt><dd>The creator wallet, where its SOL came from, the other wallets that same funder paid, how many coins they launched and how fast they sold.</dd>` +
    `<dt>Who holds it</dt><dd>The top ${LIMITS.TOP_HOLDERS} holders, split into pools, insiders (the creator, linked wallets, launch-block buyers) and independent wallets.</dd>` +
    `<dt>Sticker price</dt><dd>Market cap × the share of supply held by independent wallets. The part of the price that isn't the creator's own money.</dd>` +
    `</dl></div></div>` +
    factoryStory();

  return page(ctx, {
    title: "MSRP: the window sticker for Solana meme coins",
    description:
      "Paste a Solana coin address and get its window sticker: who made it, who really holds it, and the market cap held by independent wallets. Read-only, free.",
    path: paths.home,
    body,
    hideForm: true,
  });
}

/** Educational: how an automated launch operation works, and what the sticker looks for at each step. */
function factoryStory(): string {
  const steps: [string, string][] = [
    [
      "A master wallet sends SOL to a brand-new wallet minutes before launch.",
      `"Funded by" and "First SOL arrived". We flag a creator funded ${THRESHOLDS.FRESH_DEPLOYER_MIN} minutes or less before launch.`,
    ],
    [
      "The new wallet creates the coin and buys its own supply in the same transaction, sometimes with other wallets buying in the same block.",
      `"Creator's buy at launch" and the launch-block buyers in "Who holds it".`,
    ],
    [
      "After a few launches the operator switches to another fresh wallet paid by the same master wallet.",
      `The family tree: every wallet the funder paid, and how many coins each launched.`,
    ],
    [
      `If nobody else buys, the bag is sold about ${THRESHOLDS.FAST_DEV_SELL_MIN} minutes later.`,
      `"Creator sold within ${THRESHOLDS.FAST_DEV_SELL_MIN} min of launch", counted across the whole family.`,
    ],
    ["The SOL is swept back to the master wallet, ready for the next launch.", `"SOL sent back to the funder".`],
  ];
  return (
    `<h2>How a launch factory works, and what the sticker checks</h2>` +
    `<ol class="story">` +
    steps
      .map(([a, b]) => `<li>${esc(a)}<br><small>On the sticker: ${esc(b)}</small></li>`)
      .join("") +
    `</ol>` +
    `<p class="fine">Plenty of honest people also use new wallets or sell early. One sign alone proves nothing; the sticker shows all of them side by side so you can judge.</p>`
  );
}

// ---------------------------------------------------------------------------
// Sticker
// ---------------------------------------------------------------------------

export function renderSticker(ctx: PageContext, sticker: Sticker): string {
  const title = coinTitle(sticker.name, sticker.symbol);
  const h = sticker.headline;
  const bits = [`${starText(sticker.ratings.overall.stars)} overall.`];
  if (h.independentPct !== null) bits.push(`${pct(h.independentPct)} of circulating supply held by independent wallets.`);
  if (h.insiderPct !== null) bits.push(`Insiders hold ${pct(h.insiderPct)}.`);
  bits.push("Who made it and who holds it, from public Solana data.");
  const example = isExample(sticker);
  return page(ctx, {
    title: `${title} window sticker`,
    description: bits.join(" "),
    path: example ? paths.example : paths.coin(sticker.mint),
    ogImage: paths.og(sticker.mint),
    body: renderStickerBody(ctx, sticker),
    query: example ? "" : sticker.mint,
    noindex: example,
  });
}

// ---------------------------------------------------------------------------
// Waiting page ("printing")
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
    `<section class="label wait" id="wait" data-api="${esc(paths.api(mint))}" data-next="${esc(paths.coin(mint))}">` +
    `<div class="sec"><h2>Printing a new sticker</h2>` +
    `<h1 class="m mint">${esc(mint)}</h1>` +
    `<p>Nobody has checked this coin in the last ${Math.round(CACHE.STICKER_TTL_SEC / 60)} minutes, so we're reading the blockchain now. ` +
    `It usually takes 5 to ${Math.round(LIMITS.DEADLINE_MS / 1000)} seconds. The sticker appears here when it's done.</p></div>` +
    `<div class="sec"><ol class="steps m">` +
    PRINT_STEPS.map((s) => `<li>${esc(s)}…<span class="ok"></span></li>`).join("") +
    `</ol>` +
    `<p class="status m" id="wait-status" aria-live="polite">Working.</p>` +
    `<p class="red" id="wait-error" role="alert" hidden></p>` +
    `<noscript><p>JavaScript is off, so this page reloads by itself every 10 seconds. You can also <a href="${esc(paths.coin(mint))}">reload now</a>.</p></noscript>` +
    `</div></section>`;
  return page(ctx, {
    title: "Printing a sticker",
    description: "Reading the blockchain to print this coin's window sticker.",
    path: paths.coin(mint),
    body,
    query: mint,
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

export function renderMethodology(ctx: PageContext, rules: MethodologyRule[]): string {
  const order: MethodologyRule["engine"][] = ["build", "crowd", "market", "overall"];
  const toc = order
    .filter((e) => rules.some((r) => r.engine === e))
    .map((e) => `<a href="#${e}">${esc(ENGINE_TITLES[e])}</a>`)
    .join("");
  const sections = order
    .map((engine) => {
      const list = rules.filter((r) => r.engine === engine);
      if (!list.length) return "";
      return (
        `<section class="sec" id="${engine}"><h2>${esc(ENGINE_TITLES[engine])}</h2>` +
        list
          .map(
            (r) =>
              `<div class="rule" id="${esc(r.id)}"><h3>${esc(r.title)} <a class="pl" href="#${esc(r.id)}" aria-label="Link to this rule">#</a></h3>` +
              `<dl><dt>Rule</dt><dd>${esc(r.rule)}</dd><dt>Why it matters</dt><dd>${esc(r.why)}</dd><dt>What it can't tell you</dt><dd>${esc(r.limits)}</dd></dl></div>`,
          )
          .join("") +
        `</section>`
      );
    })
    .join("");

  const body =
    `<h1>How MSRP reads a coin</h1>` +
    `<p class="lede">Every rule MSRP applies, with the exact numbers. This page is generated from the same code that prints the stickers, so it can't drift out of date.</p>` +
    `<div class="label">` +
    `<section class="sec"><h2>Ground rules</h2><ul>` +
    `<li>Read-only. MSRP reads public Solana data and DEX Screener. It never asks for a wallet, a key or a signature.</li>` +
    `<li>Unknown is not zero. Anything we couldn't check is printed as Unknown, with the reason.</li>` +
    `<li>Stars measure how open the ownership is. They are not a price prediction and not advice.</li>` +
    `<li>Wallet links are patterns, not proof of who controls a wallet.</li>` +
    `<li>Payment never changes a sticker. SolanaView listings are separate and never affect a rating.</li>` +
    `<li>Each sticker uses at most ${LIMITS.MAX_RPC_REQUESTS} Solana requests and stops after ${LIMITS.DEADLINE_MS / 1000} seconds, then shows what it found. Stickers are reused for ${CACHE.STICKER_TTL_SEC / 60} minutes.</li>` +
    `</ul></section>` +
    `<section class="sec"><h2>Sticker price</h2><p><b>Sticker price = market cap × share of total supply held by independent wallets.</b> ` +
    `Independent wallets are top holders we traced and found no link to the creator, to each other or to the launch block. ` +
    `Pools, the bonding curve, burned coins, wallets we couldn't trace and wallets outside the top ${LIMITS.TOP_HOLDERS} are not counted as independent.</p></section>` +
    `<section class="sec"><h2>Sections</h2><p class="links">${toc}</p></section>` +
    sections +
    `</div>`;

  return page(ctx, {
    title: "How MSRP works",
    description: "Every rule behind an MSRP window sticker, with exact thresholds and limits: deployer funding, wallet families, linked holders, launch-block buyers and market data.",
    path: paths.methodology,
    body,
  });
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export function renderPricing(ctx: PageContext): string {
  const body =
    `<h1>Pricing</h1>` +
    `<p class="lede"><b>Ratings can't be bought.</b> No plan, listing or payment changes what a sticker says.</p>` +
    `<div class="label plans">` +
    `<section class="sec"><h2>Free</h2><p class="price">$0</p><ul>` +
    `<li>Unlimited stickers on this site.</li>` +
    `<li>The embeddable badge for your site or Telegram.</li>` +
    `<li>The JSON API, with a fair-use limit of ${RATE_LIMITS.NEW_STICKERS_PER_IP_PER_HOUR} new stickers an hour per visitor. Stickers someone already printed in the last ${CACHE.STICKER_TTL_SEC / 60} minutes don't count.</li>` +
    `</ul><p><a href="${paths.home}">Check a coin</a></p></section>` +
    `<section class="sec"><h2>Pro API and alerts</h2><p class="price">Coming soon</p><ul>` +
    `<li>Higher API limits and bulk checks for bots, terminals and call groups.</li>` +
    `<li>Family Watch: an alert when a wallet family you follow launches another coin.</li>` +
    `</ul><p>${ext(external.issues, "Tell us you want it")} (opens a GitHub issue).</p></section>` +
    `<section class="sec"><h2>Teams</h2><p class="price">Get your coin seen</p><ul>` +
    `<li>Coins with 4 or more stars overall can buy a listing on SolanaView, a separate site run by the same team.</li>` +
    `<li>A listing is labeled Sponsored there. It never changes the MSRP sticker.</li>` +
    `</ul><p>${ext(external.solanaview(ctx), "SolanaView listings")}</p></section>` +
    `</div>`;
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
  const body =
    `<h1>About MSRP</h1>` +
    `<div class="prose">` +
    `<p>Every new car has a sticker in the window: where it was built, what's in it and what it costs. Nobody trusts the salesman; everybody reads the sticker.</p>` +
    `<p>MSRP prints that sticker for Solana meme coins. Paste an address and in about ten seconds you see three things:</p>` +
    `<ol><li><b>Who made it.</b> We trace the creator wallet back to the wallet that paid it, find the other wallets that same funder paid, and count every coin that family launched and how fast it sold.</li>` +
    `<li><b>Who holds it.</b> We split the top holders into pools, insiders (the creator, wallets linked to it or to each other, launch-block buyers) and independent wallets.</li>` +
    `<li><b>The sticker price.</b> The market cap times the share held by independent wallets: the part of the price that isn't the creator's own money.</li></ol>` +
    `<p>The checks come from people who know how launch operations work from the inside: a master wallet funds a fresh wallet just before launch, the coin is created with a buy in the same transaction, wallets rotate every few launches, unsold bags are sold after about ${THRESHOLDS.FAST_DEV_SELL_MIN} minutes and the SOL goes back to the master wallet. Each of those steps leaves a trace on-chain. MSRP reads the traces.</p>` +
    `<h2>Promises</h2><ul>` +
    `<li>Read-only. MSRP never asks you to connect a wallet, never asks for a key and never sends a transaction.</li>` +
    `<li>No accounts and no sign-up.</li>` +
    `<li>Unknown is printed as Unknown, never as zero.</li>` +
    `<li>We describe patterns ("funded by the same wallet"), not people. A link between wallets is not proof of who controls them.</li>` +
    `<li>Ratings can't be bought. SolanaView, a listing site run by the same team, is kept separate and never changes a sticker.</li>` +
    `<li>Not financial advice and not a price prediction.</li></ul>` +
    `<p>The code is public: ${ext(external.repo, "github.com/solanadev1/msrp")}. Found a mistake? ${ext(external.issues, "Open an issue")}.</p>` +
    `</div>`;
  return page(ctx, {
    title: "About",
    description: "MSRP prints a window sticker for Solana meme coins: who made it, who holds it, and the market cap held by independent wallets. Read-only, no accounts.",
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
      `<div class="label"><section class="sec"><h2>404</h2><h1>No page here</h1>` +
      `<p>Check the address, or paste a coin address in the box above. Coin pages look like <span class="m">/coin/&lt;address&gt;</span>.</p>` +
      `<p><a href="${paths.home}">Home</a> · <a href="${paths.example}">Example sticker</a></p></section></div>`,
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
      `<div class="label"><section class="sec"><h2>Error ${code}</h2><h1>${esc(title)}</h1>` +
      `<p>${esc(message)}</p><p><a href="${paths.home}">Home</a> · <a href="${paths.example}">Example sticker</a></p></section></div>`,
  });
}
