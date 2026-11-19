/**
 * END TO END: the real site (createApp with the real analyze(), engines and renderers, exactly as
 * src/worker.ts wires them through src/deps.ts) over recorded mainnet answers. Only the network is
 * replaced: the Solana client and DEX Screener read from tests/fixtures through the real HTTP layer.
 *
 * Run: npx tsx --test tests/e2e.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DISCLAIMER, LIMITS } from "../src/config";
import { realDeps } from "../src/deps";
import type { Env, Sticker } from "../src/types";
import { usdShort } from "../src/ui/format";
import { createApp, HTML_CSP } from "../src/web/app";
import { createLimiter } from "../src/web/limits";
import { createStickerCache } from "../src/web/store";
import { fixedNow, loadFixture, replayFetch, type Fixture } from "./helpers/replay";

const RPC = "https://rpc.replay.invalid";
const ENV: Env = { SOLANA_RPC_URL: RPC, MSRP_PUBLIC_URL: "https://msrp.example" };
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";
/** Cloudflare Free plan: outbound requests one visit may make. */
const CLOUDFLARE_SUBREQUESTS = 50;

const FIXTURES = ["curve-coin", "graduated-coin", "curve-coin-fee-sharing"] as const;

function site(f: Fixture) {
  const net = replayFetch(f, RPC);
  const now = fixedNow(f);
  const logs: string[] = [];
  const app = createApp(
    realDeps({
      fetch: net,
      now,
      cache: createStickerCache({ now, cache: () => null, log: () => {} }),
      limiter: createLimiter({ perIpPerHour: 100, perDay: 1000, log: () => {} }),
      log: (message) => logs.push(message),
    }),
  );
  const waits: Promise<unknown>[] = [];
  const get = (path: string, ua = BROWSER) =>
    app.fetch(
      new Request(`https://msrp.example${path}`, { headers: { "user-agent": ua, "cf-connecting-ip": "203.0.113.9" } }),
      ENV,
      { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext,
    );
  return { app, net, get, logs, waits };
}

/** The sticker article without the collapsed details block (what a visitor sees first). */
function mainView(html: string): string {
  const a = html.slice(html.indexOf('<article id="sticker"'), html.indexOf("</article>"));
  return a.slice(0, a.indexOf('<details class="more"'));
}

function visibleWords(html: string): string[] {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<span class="vh">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ")
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

for (const name of FIXTURES) {
  describe(`end to end: ${name}`, () => {
    it("a crawler gets the full sticker with real values; the API, badge, share card and home agree", async () => {
      const f = loadFixture(name);
      const { get, net, logs } = site(f);

      // Before anything is computed the badge never computes: "tap to check".
      const before = await get(`/badge/${f.mint}.svg`);
      assert.equal(before.status, 200);
      assert.match(await before.text(), /tap to check/);
      assert.equal(net.stats.httpRequests, 0, "a badge never touches the network");

      // A crawler (no JavaScript) gets the finished sticker in one answer.
      const page = await get(`/coin/${f.mint}`, GOOGLEBOT);
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("x-msrp-cache"), "miss");
      assert.equal(page.headers.get("content-security-policy"), HTML_CSP);
      const html = await page.text();
      assert.deepEqual(net.stats.misses, [], "every call was answered from the recording");

      // Budget: Solana requests within LIMITS, everything within Cloudflare's per-visit allowance.
      const api = await get(`/api/v1/sticker/${f.mint}`);
      assert.equal(api.status, 200);
      assert.equal(api.headers.get("x-msrp-cache"), "hit", "the API reuses the sticker the page computed");
      const s = (await api.json()) as Sticker;
      assert.ok(s.coverage.rpcRequests > 0 && s.coverage.rpcRequests <= LIMITS.MAX_RPC_REQUESTS, `${s.coverage.rpcRequests} Solana requests`);
      assert.equal(net.stats.httpRequests, s.coverage.rpcRequests + s.coverage.dexRequests, "no hidden requests");
      assert.ok(net.stats.httpRequests <= CLOUDFLARE_SUBREQUESTS);
      assert.equal(s.disclaimer, DISCLAIMER);
      assert.equal(s.computedAt, f.capturedAt);
      assert.equal(s.mint, f.mint);

      // Real values from the chain, and the page shows the same ones.
      assert.ok(s.name, "name read");
      assert.ok(s.build.deployer, "deployer found");
      assert.ok(s.crowd.holdersAnalyzed > 0, "holders read");
      assert.ok(s.headline.marketCapUsd !== null, "market cap from DEX Screener");
      assert.ok(html.includes(esc(s.name ?? "")), "coin name on the page");
      assert.ok(html.includes(`data-w="${s.build.deployer}"`), "deployer on the page, highlightable");
      assert.ok(html.includes(`href="https://solscan.io/account/${s.build.deployer}"`), "deployer links to its evidence");
      if (s.build.funder) assert.ok(html.includes(`data-w="${s.build.funder}"`), "funder on the page");
      const main = mainView(html);
      if (s.headline.stickerPriceUsd !== null) assert.ok(main.includes(`>${esc(usdShort(s.headline.stickerPriceUsd))}<`), "the big number is the sticker price");
      else assert.match(main, /class="big unk"/);
      if (s.headline.marketCapUsd !== null) assert.ok(main.includes(esc(usdShort(s.headline.marketCapUsd))), "market cap in the caption");
      const stars = s.ratings.overall.stars;
      if (stars === null) assert.ok(main.includes("not rated"));
      else assert.ok(main.includes(`aria-label="${stars} of 5"`), "rating dots match the API");
      for (const note of s.coverage.notes) assert.ok(html.includes(esc(note)), `coverage note shown: ${note}`);
      assert.ok(html.includes(esc(DISCLAIMER)), "full disclaimer inside details");
      assert.ok(!html.includes("example data"), "real coins are never marked as example");

      // The owner's design rule holds on real data too: almost no words on the main view.
      const words = visibleWords(main);
      assert.ok(words.length <= 50, `${words.length} words on the main view: ${words.join(" ")}`);
      assert.equal((html.match(/<details class="more"/g) ?? []).length, 1);
      assert.doesNotMatch(main, /<h2|<p>|<table/);

      // The badge now shows the stars and the independent share.
      const badge = await (await get(`/badge/${f.mint}.svg`)).text();
      assert.doesNotMatch(badge, /tap to check/);
      if (stars !== null) assert.match(badge, new RegExp(`${stars} of 5 stars overall`));
      else assert.match(badge, /not rated/);
      const og = await (await get(`/og/${f.mint}.svg`)).text();
      assert.ok(og.includes(esc(s.name ?? "")), "share card names the coin");

      // The home page lists it as recently checked; the sitemap links it.
      const home = await (await get("/")).text();
      assert.ok(home.includes(`/coin/${f.mint}`), "recently checked on the home page");
      const sitemap = await (await get("/sitemap.xml")).text();
      assert.ok(sitemap.includes(`https://msrp.example/coin/${f.mint}`));

      // Nothing was computed twice and nothing unexpected was logged.
      assert.equal(net.stats.httpRequests, s.coverage.rpcRequests + s.coverage.dexRequests);
      assert.deepEqual(logs, []);
    });

    it("a browser first sees the waiting page, its script's API call prints the sticker, the reload shows it", async () => {
      const f = loadFixture(name);
      const { get, net } = site(f);
      const waiting = await get(`/coin/${f.mint}`);
      assert.equal(waiting.status, 200);
      assert.equal(waiting.headers.get("x-robots-tag"), "noindex");
      const w = await waiting.text();
      assert.match(w, /checking/);
      assert.ok(w.includes(f.mint));
      assert.equal(net.stats.httpRequests, 0, "the waiting page answers at once");

      const api = await get(`/api/v1/sticker/${f.mint}`);
      assert.equal(api.status, 200);
      assert.equal(api.headers.get("x-msrp-cache"), "miss");
      const s = (await api.json()) as Sticker;

      const reload = await get(`/coin/${f.mint}`);
      assert.equal(reload.headers.get("x-msrp-cache"), "hit");
      const html = await reload.text();
      assert.ok(html.includes('<article id="sticker"'));
      assert.ok(html.includes(esc(s.name ?? "")));
      assert.equal(net.stats.httpRequests, s.coverage.rpcRequests + s.coverage.dexRequests, "computed once");
    });
  });
}

describe("end to end: what the fixtures show", () => {
  it("a browser without JavaScript follows the waiting page to a computed sticker (no endless reloads)", async () => {
    const f = loadFixture("curve-coin");
    const { get, net } = site(f);
    const waiting = await (await get(`/coin/${f.mint}`)).text();
    const refresh = /<noscript><meta http-equiv="refresh" content="1;url=([^"]+)"><\/noscript>/.exec(waiting)?.[1];
    const link = /<noscript><p class="cap"><a href="([^"]+)">/.exec(waiting)?.[1];
    assert.equal(refresh, `/coin/${f.mint}?wait=1`);
    assert.equal(link, refresh);
    assert.equal(net.stats.httpRequests, 0);
    const page = await get(refresh ?? "");
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("x-msrp-cache"), "miss", "computed inline");
    assert.ok((await page.text()).includes('<article id="sticker"'));
    assert.ok(net.stats.httpRequests > 0);
  });

  it("Wanted Lucia (graduated, crashed): factory signs, market capped, holders not invented", async () => {
    const f = loadFixture("graduated-coin");
    const { get } = site(f);
    const s = (await (await get(`/api/v1/sticker/${f.mint}`)).json()) as Sticker;
    assert.equal(s.build.deployer, "BvbAXpW8GQoxCUAooG3H816MRSh4UBvvFP7cjKFqvzsm");
    assert.equal(s.build.funder, "AZyfCKACS3nxzeBYLfXF2PKk6FbztboAqXWgCfKmeVvb");
    assert.equal(s.build.graduated, true);
    assert.ok((s.ratings.build.stars ?? 5) <= 2, "launch-factory signs lower the build rating");
    // Liquidity above market cap after the crash: an anomaly, never top market stars.
    assert.ok(s.market && s.market.liquidityUsd !== null && s.market.marketCapUsd !== null && s.market.liquidityUsd > s.market.marketCapUsd);
    assert.ok((s.ratings.market.stars ?? 0) <= 3);
    assert.ok(s.findings.some((x) => x.id === "market.liquidity-anomaly"));
    // The pool holds nearly everything: infrastructure, never counted as insider or independent.
    for (const h of s.crowd.topHolders) if (h.kind === "pool" || h.kind === "program") assert.equal(h.label, "infrastructure");
    // The creator sold out and is not in the top 20: unknown, not zero.
    assert.equal(s.crowd.creatorPct, null);
    // Four build flags outrank it on the main view; its one-line note sits inside details.
    const page = await (await get(`/coin/${f.mint}`, GOOGLEBOT)).text();
    assert.ok(page.includes('id="f-market.liquidity-anomaly"'));
    assert.equal((mainView(page).match(/<li>/g) ?? []).length, 4, "never more than four flags");
  });

  it("Lucia (on the curve): holders come from the capped fallback and the curve is infrastructure", async () => {
    const f = loadFixture("curve-coin");
    const { get } = site(f);
    const s = (await (await get(`/api/v1/sticker/${f.mint}`)).json()) as Sticker;
    assert.ok(s.coverage.notes.some((n) => /holders were read from all \d+ token accounts/.test(n)));
    assert.ok(s.crowd.holdersAnalyzed > 0);
    const curve = s.crowd.topHolders.find((h) => h.kind === "bonding-curve");
    assert.equal(curve?.label, "infrastructure");
    const creator = s.crowd.topHolders.find((h) => h.kind === "creator");
    assert.equal(creator?.label, "insider");
    assert.ok(s.headline.insiderPct !== null && s.headline.independentPct !== null);
    assert.ok(Math.abs(s.headline.insiderPct + s.headline.independentPct - 100) < 0.05, "shares of circulating supply add up");
    assert.equal(s.ratings.market.stars, null, "no pool yet: market not rated rather than guessed");
  });
});
