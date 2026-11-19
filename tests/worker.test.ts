/**
 * Worker / web app tests. Every dependency is a fake: no network, no real chain, no real UI.
 * Run: npx tsx --test tests/worker.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CACHE, DISCLAIMER, LIMITS } from "../src/config";
import type { AnalyzeOptions, Env, MethodologyRule, RpcClient, Sticker } from "../src/types";
import { createApp, HTML_CSP, isCrawler, renderSitemap, SVG_CSP, type AppDeps } from "../src/web/app";
import { createLimiter } from "../src/web/limits";
import { createStickerCache, type StickerCache } from "../src/web/store";
import { PUBLIC_RPC_URL } from "../src/web/validate";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
/** A valid, distinct 32-byte address for each k. */
const mintN = (k: number) => b58(Uint8Array.from({ length: 32 }, (_, i) => (k * 31 + i * 7 + 1) % 256));
const MINT = mintN(1);
const MINT2 = mintN(2);
const MINT3 = mintN(3);

function makeSticker(mint: string, computedAt: number, over: Partial<Sticker> = {}): Sticker {
  const r = (stars: 1 | 2 | 3 | 4 | 5 | null) => ({ stars, reason: "test" });
  return {
    version: 1,
    mint,
    name: "Test <Coin>",
    symbol: "TEST",
    imageUrl: null,
    computedAt,
    headline: { marketCapUsd: 1000, independentPct: 40, stickerPriceUsd: 400, insiderPct: 60 },
    ratings: { build: r(3), crowd: r(2), market: r(4), overall: r(3) },
    build: {
      launchpad: "pump.fun",
      deployer: null,
      funder: null,
      deployerFundedBeforeLaunchMin: null,
      devBuySol: null,
      deployerLaunchCount: 0,
      familySize: 1,
      familyLaunchCount: 0,
      familyFastDevSellCount: 0,
      sentBackToFunderSol: 0,
      family: [],
      mintAuthority: null,
      freezeAuthority: null,
      createdAt: null,
      curveProgressPct: null,
      graduated: null,
    },
    crowd: {
      holdersAnalyzed: 0,
      topHolders: [],
      clusters: [],
      creatorPct: null,
      bundlePct: null,
      clusteredPct: null,
      infrastructurePct: null,
      top10Pct: null,
    },
    market: null,
    findings: [],
    coverage: { rpcRequests: 3, dexRequests: 1, notes: [], complete: true, elapsedMs: 12 },
    disclaimer: DISCLAIMER,
    ...over,
  };
}

function namedError(name: string, message = name): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

class Clock {
  constructor(public t = Date.UTC(2026, 10, 19, 12, 0, 0)) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

interface Harness {
  app: ReturnType<typeof createApp>;
  clock: Clock;
  calls: { mint: string; opts: AnalyzeOptions }[];
  rpcEnvs: Env[];
  logs: { message: string; detail?: Record<string, unknown> }[];
  waitUntil: Promise<unknown>[];
  cache: StickerCache;
  /** Replace what analyze does. */
  setAnalyze(fn: (mint: string, opts: AnalyzeOptions) => Promise<Sticker>): void;
  get(path: string, init?: RequestInit & { ip?: string; ua?: string }, env?: Env): Promise<Response>;
}

const METHOD: MethodologyRule[] = [{ id: "r1", engine: "build", title: "Rule", rule: "x", why: "y", limits: "z" }];

function harness(opts: { perIp?: number; perDay?: number; cache?: StickerCache; render?: Partial<AppDeps["render"]> } = {}): Harness {
  const clock = new Clock();
  const calls: Harness["calls"] = [];
  const rpcEnvs: Env[] = [];
  const logs: Harness["logs"] = [];
  const waitUntil: Promise<unknown>[] = [];
  let analyzeImpl = async (mint: string) => makeSticker(mint, clock.now());
  const cache = opts.cache ?? createStickerCache({ now: clock.now, cache: () => null, log: () => {} });
  const fakeRpc: RpcClient = {
    call: async () => {
      throw new Error("no network in tests");
    },
    batch: async () => [],
    requests: 0,
  };
  const deps: AppDeps = {
    analyze: async (mint, o) => {
      calls.push({ mint, opts: o });
      return analyzeImpl(mint, o);
    },
    render: {
      home: (ctx, recent) => `<html>HOME ${ctx.publicUrl} [${recent.map((r) => r.mint).join(",")}]</html>`,
      sticker: (ctx, s) => `<html>STICKER ${s.mint} at ${s.computedAt} on ${ctx.publicUrl}</html>`,
      printing: (_ctx, mint) => `<html>PRINTING ${mint}</html>`,
      methodology: (_ctx, rules) => `<html>METHODOLOGY ${rules.length}</html>`,
      pricing: () => `<html>PRICING</html>`,
      about: () => `<html>ABOUT</html>`,
      notFound: () => `<html>NOT FOUND</html>`,
      error: (_ctx, title, message, status) => `<html>ERROR ${status} ${title} :: ${message}</html>`,
      badge: (s, mint) => `<svg>BADGE ${s ? `${s.mint} ${s.ratings.overall.stars}` : `unknown ${mint}`}</svg>`,
      og: (s) => `<svg>OG ${s ? s.mint : "default"}</svg>`,
      ...opts.render,
    },
    methodology: METHOD,
    sample: () => makeSticker("EXAMPLE", 0),
    rpcFactory: (env) => {
      rpcEnvs.push(env);
      return fakeRpc;
    },
    now: clock.now,
    cache,
    limiter: createLimiter({ perIpPerHour: opts.perIp ?? 100, perDay: opts.perDay ?? 1000, log: () => {} }),
    fetch: async () => {
      throw new Error("no network in tests");
    },
    version: "9.9.9-test",
    log: (message, detail) => logs.push({ message, detail }),
  };
  const app = createApp(deps);
  return {
    app,
    clock,
    calls,
    rpcEnvs,
    logs,
    waitUntil,
    cache,
    setAnalyze(fn) {
      analyzeImpl = fn;
    },
    get(path, init = {}, env = {}) {
      const headers = new Headers(init.headers);
      headers.set("cf-connecting-ip", init.ip ?? "203.0.113.7");
      if (init.ua) headers.set("user-agent", init.ua);
      const request = new Request(`https://msrp.test${path}`, { method: init.method ?? "GET", headers });
      const ctx = {
        waitUntil: (p: Promise<unknown>) => void waitUntil.push(p),
        passThroughOnException: () => {},
        props: {},
      } as unknown as ExecutionContext;
      return app.fetch(request, env, ctx);
    },
  };
}

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function assertHtmlSecurity(res: Response) {
  assert.equal(res.headers.get("content-security-policy"), HTML_CSP);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.ok(res.headers.get("permissions-policy"));
  assert.match(res.headers.get("content-type") ?? "", /^text\/html; charset=utf-8/);
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("route table", () => {
  it("serves the static pages with security headers", async () => {
    const h = harness();
    const expected: [string, RegExp][] = [
      ["/", /^<html>HOME/],
      ["/methodology", /METHODOLOGY 1/],
      ["/pricing", /PRICING/],
      ["/about", /ABOUT/],
      ["/example", /STICKER EXAMPLE/],
      ["/methodology/", /METHODOLOGY 1/],
    ];
    for (const [path, body] of expected) {
      const res = await h.get(path);
      assert.equal(res.status, 200, path);
      assertHtmlSecurity(res);
      assert.match(await res.text(), body, path);
    }
    assert.equal(h.calls.length, 0);
  });

  it("returns the not-found page with 404 and JSON 404 for unknown API routes", async () => {
    const h = harness();
    const res = await h.get("/nope/<script>");
    assert.equal(res.status, 404);
    assertHtmlSecurity(res);
    assert.equal(await res.text(), "<html>NOT FOUND</html>");
    const api = await h.get("/api/v2/whatever");
    assert.equal(api.status, 404);
    const body = await json(api);
    assert.equal(body.code, "no_route");
    assert.equal(body.disclaimer, DISCLAIMER);
  });

  it("serves the methodology as JSON with the disclaimer", async () => {
    const h = harness();
    const res = await h.get("/api/v1/methodology");
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.deepEqual(body.rules, METHOD);
    assert.equal(body.disclaimer, DISCLAIMER);
  });

  it("hands /assets/* and /favicon.svg to the ASSETS binding, 404 when it's missing", async () => {
    const h = harness();
    const seen: string[] = [];
    const env = {
      ASSETS: {
        fetch: async (req: Request) => {
          seen.push(new URL(req.url).pathname);
          return new Response("body{}", { headers: { "content-type": "text/css" } });
        },
      },
    } as unknown as Env;
    const css = await h.get("/assets/msrp.css", {}, env);
    assert.equal(css.status, 200);
    assert.equal(await css.text(), "body{}");
    await h.get("/favicon.svg", {}, env);
    assert.deepEqual(seen, ["/assets/msrp.css", "/favicon.svg"]);
    const missing = await h.get("/assets/msrp.css");
    assert.equal(missing.status, 404);
  });
});

describe("/check and address validation", () => {
  it("redirects a valid address (trimmed) to its coin page", async () => {
    const h = harness();
    const res = await h.get(`/check?mint=${encodeURIComponent(`  ${MINT}\n`)}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), `/coin/${MINT}`);
  });

  it("accepts a pasted coin link", async () => {
    const h = harness();
    const res = await h.get(`/check?mint=${encodeURIComponent(`https://pump.fun/coin/${MINT}`)}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), `/coin/${MINT}`);
  });

  it("shows a friendly 400 page for an invalid address without echoing it", async () => {
    const h = harness();
    const evil = `<script>alert(1)</script>`;
    const res = await h.get(`/check?mint=${encodeURIComponent(evil)}`);
    assert.equal(res.status, 400);
    assertHtmlSecurity(res);
    const text = await res.text();
    assert.match(text, /ERROR 400/);
    assert.ok(!text.includes("<script>"));
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("rejects right-length strings that don't decode to 32 bytes, and bad alphabet", async () => {
    const h = harness();
    for (const bad of ["z".repeat(44), "0".repeat(40), "O".repeat(40), mintN(5).slice(0, 31), "%E0%A4%A"]) {
      const res = await h.get(`/coin/${bad}`, { ua: GOOGLEBOT });
      assert.equal(res.status, 400, bad);
      const api = await h.get(`/api/v1/sticker/${bad}`);
      assert.equal(api.status, 400, bad);
      const body = await json(api);
      assert.equal(body.code, "invalid_mint");
      assert.equal(body.disclaimer, DISCLAIMER);
    }
    assert.equal(h.calls.length, 0);
  });

  it("sends an empty search back home", async () => {
    const h = harness();
    const res = await h.get(`/check?mint=`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");
  });
});

describe("/coin/<mint>", () => {
  it("gives browsers the waiting page without computing", async () => {
    const h = harness();
    const res = await h.get(`/coin/${MINT}`, { ua: BROWSER });
    assert.equal(res.status, 200);
    assertHtmlSecurity(res);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(await res.text(), `<html>PRINTING ${MINT}</html>`);
    assert.equal(h.calls.length, 0);
  });

  it("computes inline for crawlers and then serves from cache", async () => {
    const h = harness();
    for (const ua of [GOOGLEBOT, "Twitterbot/1.0", "facebookexternalhit/1.1", "TelegramBot (like TwitterBot)"]) {
      assert.ok(isCrawler(ua), ua);
    }
    assert.ok(!isCrawler(BROWSER));
    const res = await h.get(`/coin/${MINT}`, { ua: GOOGLEBOT });
    assert.equal(res.status, 200);
    assert.match(await res.text(), new RegExp(`STICKER ${MINT}`));
    assert.equal(h.calls.length, 1);
    // A browser now sees the fresh sticker, no recomputation.
    const again = await h.get(`/coin/${MINT}`, { ua: BROWSER });
    assert.match(await again.text(), new RegExp(`STICKER ${MINT}`));
    assert.equal(again.headers.get("x-msrp-cache"), "hit");
    assert.equal(h.calls.length, 1);
  });

  it("computes inline for ?wait=1 (pages without JavaScript)", async () => {
    const h = harness();
    const res = await h.get(`/coin/${MINT}?wait=1`, { ua: BROWSER });
    assert.match(await res.text(), /STICKER/);
    assert.equal(h.calls.length, 1);
  });

  it("recomputes a stale sticker for crawlers; browsers get the waiting page", async () => {
    const h = harness();
    await h.get(`/api/v1/sticker/${MINT}`);
    h.clock.advance(CACHE.STICKER_TTL_SEC * 1000 + 1);
    const browser = await h.get(`/coin/${MINT}`, { ua: BROWSER });
    assert.match(await browser.text(), /PRINTING/);
    assert.equal(h.calls.length, 1);
    const bot = await h.get(`/coin/${MINT}`, { ua: GOOGLEBOT });
    assert.match(await bot.text(), new RegExp(`at ${h.clock.now()}`));
    assert.equal(h.calls.length, 2);
  });

  it("shows the older sticker to a crawler when Solana is busy, and an error page otherwise", async () => {
    const h = harness();
    await h.get(`/api/v1/sticker/${MINT}`);
    const firstAt = h.clock.now();
    h.clock.advance(CACHE.STICKER_TTL_SEC * 1000 + 1);
    h.setAnalyze(async () => {
      throw namedError("ChainUnavailableError");
    });
    const stale = await h.get(`/coin/${MINT}`, { ua: GOOGLEBOT });
    assert.equal(stale.status, 200);
    assert.match(await stale.text(), new RegExp(`at ${firstAt}`));
    const none = await h.get(`/coin/${MINT2}`, { ua: GOOGLEBOT });
    assert.equal(none.status, 503);
    assert.equal(none.headers.get("retry-after"), "30");
    assertHtmlSecurity(none);
  });

  it("maps a missing coin to a 404 page", async () => {
    const h = harness();
    h.setAnalyze(async () => {
      throw namedError("NotFoundError");
    });
    const res = await h.get(`/coin/${MINT}`, { ua: GOOGLEBOT });
    assert.equal(res.status, 404);
    assert.match(await res.text(), /ERROR 404/);
  });
});

describe("/api/v1/sticker/<mint>", () => {
  it("returns the sticker JSON with CORS and the disclaimer, and caches it", async () => {
    const h = harness();
    const res = await h.get(`/api/v1/sticker/${MINT}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(res.headers.get("x-msrp-cache"), "miss");
    const body = await json(res);
    assert.equal(body.mint, MINT);
    assert.equal(body.disclaimer, DISCLAIMER);
    const again = await h.get(`/api/v1/sticker/${MINT}`);
    assert.equal(again.headers.get("x-msrp-cache"), "hit");
    assert.equal(h.calls.length, 1);
  });

  it("passes the request budget and deadline to analyze, and the env to the RPC factory", async () => {
    const h = harness();
    const env = { SOLANA_RPC_URL: "https://rpc.example/?api-key=SECRET" } as Env;
    await h.get(`/api/v1/sticker/${MINT}`, {}, env);
    const call = h.calls[0];
    assert.ok(call);
    assert.equal(call.mint, MINT);
    assert.equal(call.opts.maxRpcRequests, LIMITS.MAX_RPC_REQUESTS);
    assert.equal(call.opts.deadlineMs, LIMITS.DEADLINE_MS);
    assert.equal(typeof call.opts.now, "function");
    assert.equal(h.rpcEnvs[0], env);
  });

  it("shares one analysis between concurrent requests (single flight)", async () => {
    const h = harness();
    const gate = deferred<void>();
    h.setAnalyze(async (mint) => {
      await gate.promise;
      return makeSticker(mint, h.clock.now());
    });
    const a = h.get(`/api/v1/sticker/${MINT}`, { ip: "198.51.100.1" });
    const b = h.get(`/api/v1/sticker/${MINT}`, { ip: "198.51.100.2" });
    const c = h.get(`/coin/${MINT}`, { ua: GOOGLEBOT, ip: "198.51.100.3" });
    await new Promise((r) => setTimeout(r, 5));
    gate.resolve();
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    assert.equal(h.calls.length, 1);
    assert.equal(ra.status, 200);
    assert.equal(rb.status, 200);
    assert.equal(rc.status, 200);
    const sources = [ra, rb, rc].map((r) => r.headers.get("x-msrp-cache")).sort();
    assert.deepEqual(sources, ["joined", "joined", "miss"]);
    assert.ok(h.waitUntil.length >= 1, "the computation is registered with waitUntil");
  });

  it("rate limits new computations per IP with 429 + Retry-After; cached answers never count", async () => {
    const h = harness({ perIp: 2 });
    assert.equal((await h.get(`/api/v1/sticker/${MINT}`)).status, 200);
    assert.equal((await h.get(`/api/v1/sticker/${MINT2}`)).status, 200);
    // Cached: free, even when over the limit.
    for (let i = 0; i < 5; i++) assert.equal((await h.get(`/api/v1/sticker/${MINT}`)).status, 200);
    h.clock.advance(10 * 60 * 1000);
    const limited = await h.get(`/api/v1/sticker/${MINT3}`);
    assert.equal(limited.status, 429);
    const retry = Number(limited.headers.get("retry-after"));
    assert.ok(retry > 0 && retry <= 50 * 60, `retry-after ${retry}`);
    const body = await json(limited);
    assert.equal(body.code, "rate_limited");
    assert.equal(body.disclaimer, DISCLAIMER);
    assert.equal(typeof body.error, "string");
    // Another visitor is unaffected.
    assert.equal((await h.get(`/api/v1/sticker/${MINT3}`, { ip: "192.0.2.50" })).status, 200);
    assert.equal(h.calls.length, 3);
  });

  it("applies the site-wide daily limit", async () => {
    const h = harness({ perDay: 1 });
    assert.equal((await h.get(`/api/v1/sticker/${MINT}`, { ip: "192.0.2.1" })).status, 200);
    const res = await h.get(`/api/v1/sticker/${MINT2}`, { ip: "192.0.2.2" });
    assert.equal(res.status, 429);
    assert.equal((await json(res)).code, "daily_limit");
    assert.ok(Number(res.headers.get("retry-after")) > 0);
  });

  it("maps errors to statuses, never caches failures, and keeps the disclaimer", async () => {
    const cases: [string, number, string][] = [
      ["InvalidMintError", 400, "invalid_mint"],
      ["NotFoundError", 404, "not_found"],
      ["BudgetExceededError", 503, "chain_unavailable"],
      ["ChainUnavailableError", 503, "chain_unavailable"],
      ["TypeError", 500, "internal"],
    ];
    for (const [name, status, code] of cases) {
      const h = harness();
      h.setAnalyze(async () => {
        throw namedError(name, "boom at https://rpc.example/?api-key=SECRET");
      });
      const res = await h.get(`/api/v1/sticker/${MINT}`);
      assert.equal(res.status, status, name);
      const body = await json(res);
      assert.equal(body.code, code, name);
      assert.equal(body.disclaimer, DISCLAIMER, name);
      assert.ok(!JSON.stringify(body).includes("SECRET"), name);
      assert.ok(!JSON.stringify(body).includes("rpc.example"), name);
      if (status === 503) assert.equal(res.headers.get("retry-after"), "30");
      // Not cached: the next request tries again.
      await h.get(`/api/v1/sticker/${MINT}`);
      assert.equal(h.calls.length, 2, name);
      // Logs never contain the secret.
      assert.ok(!JSON.stringify(h.logs).includes("SECRET"), name);
      if (status >= 500) assert.ok(h.logs.length > 0, `${name} is logged`);
    }
  });

  it("rejects an analysis result for a different coin", async () => {
    const h = harness();
    h.setAnalyze(async () => makeSticker(MINT2, h.clock.now()));
    const res = await h.get(`/api/v1/sticker/${MINT}`);
    assert.equal(res.status, 500);
    assert.equal((await h.get(`/badge/${MINT}.svg`)).headers.get("cache-control"), "public, max-age=300");
  });
});

describe("badges and share cards", () => {
  it("never computes; unknown coins get the tap-to-check badge", async () => {
    const h = harness();
    const res = await h.get(`/badge/${MINT}.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/svg+xml; charset=utf-8");
    assert.equal(res.headers.get("content-security-policy"), SVG_CSP);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), null);
    assert.equal(await res.text(), `<svg>BADGE unknown ${MINT}</svg>`);
    assert.equal(h.calls.length, 0);
  });

  it("serves stored stickers, stale ones included, with the badge cache time", async () => {
    const h = harness();
    await h.get(`/api/v1/sticker/${MINT}`);
    h.clock.advance(CACHE.STICKER_TTL_SEC * 1000 * 5);
    const res = await h.get(`/badge/${MINT}.svg`);
    assert.equal(await res.text(), `<svg>BADGE ${MINT} 3</svg>`);
    assert.equal(res.headers.get("cache-control"), `public, max-age=${CACHE.BADGE_TTL_SEC}`);
    const og = await h.get(`/og/${MINT}.svg`);
    assert.equal(await og.text(), `<svg>OG ${MINT}</svg>`);
    assert.equal(h.calls.length, 1);
  });

  it("falls back to the generic share card", async () => {
    const h = harness();
    assert.equal(await (await h.get(`/og/${MINT}.svg`)).text(), "<svg>OG default</svg>");
    assert.equal(await (await h.get(`/og/default.svg`)).text(), "<svg>OG default</svg>");
    assert.equal((await h.get(`/og/not-a-mint.svg`)).status, 400);
    assert.equal((await h.get(`/badge/not-a-mint.svg`)).status, 400);
    assert.equal(h.calls.length, 0);
  });
});

describe("methods", () => {
  it("answers HEAD like GET without a body", async () => {
    const h = harness();
    const res = await h.get("/", { method: "HEAD" });
    assert.equal(res.status, 200);
    assertHtmlSecurity(res);
    assert.equal(await res.text(), "");
  });

  it("never starts a computation for HEAD", async () => {
    const h = harness();
    const api = await h.get(`/api/v1/sticker/${MINT}`, { method: "HEAD" });
    assert.equal(api.status, 202);
    assert.equal(await api.text(), "");
    const page = await h.get(`/coin/${MINT}`, { method: "HEAD", ua: GOOGLEBOT });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(h.calls.length, 0);
    await h.get(`/api/v1/sticker/${MINT}`);
    const cached = await h.get(`/api/v1/sticker/${MINT}`, { method: "HEAD" });
    assert.equal(cached.status, 200);
  });

  it("rejects other methods with 405 and Allow", async () => {
    const h = harness();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await h.get("/", { method });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get("allow"), "GET, HEAD");
    }
    const api = await h.get(`/api/v1/sticker/${MINT}`, { method: "POST" });
    assert.equal(api.status, 405);
    const body = await json(api);
    assert.equal(body.code, "method_not_allowed");
    assert.equal(body.disclaimer, DISCLAIMER);
    assert.equal(h.calls.length, 0);
  });

  it("answers CORS preflight on the API only", async () => {
    const h = harness();
    const res = await h.get(`/api/v1/sticker/${MINT}`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("access-control-allow-methods"), "GET, HEAD");
    assert.equal((await h.get("/", { method: "OPTIONS" })).status, 405);
  });
});

describe("/api/health", () => {
  it("reports storage and RPC kind without leaking the RPC address", async () => {
    const h = harness();
    const secretUrl = "https://mainnet.helius-rpc.example/?api-key=SUPER-SECRET-KEY";
    const res = await h.get("/api/health", {}, { SOLANA_RPC_URL: `  ${secretUrl} ` });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const text = await res.text();
    assert.ok(!text.includes("SUPER-SECRET-KEY"));
    assert.ok(!text.includes("helius"));
    const body = JSON.parse(text) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.version, "9.9.9-test");
    assert.equal(body.storage, "cache-only");
    assert.equal(body.rpc, "custom");
    assert.equal(body.disclaimer, DISCLAIMER);
    assert.ok(!text.includes(PUBLIC_RPC_URL));
  });

  it("says public for a missing or non-https RPC and d1 when a database is attached", async () => {
    const h = harness();
    const fakeDb = { prepare: () => ({}) } as unknown as D1Database;
    const a = await json(await h.get("/api/health", {}, { SOLANA_RPC_URL: "http://insecure.example" }));
    assert.equal(a.rpc, "public");
    const b = await json(await h.get("/api/health", {}, { DB: fakeDb }));
    assert.equal(b.rpc, "public");
    assert.equal(b.storage, "d1");
  });
});

describe("home, robots and sitemap", () => {
  it("lists recently printed coins on the home page (max 12, newest first)", async () => {
    const h = harness();
    for (let i = 1; i <= 14; i++) {
      await h.get(`/api/v1/sticker/${mintN(i)}`);
      h.clock.advance(1000);
    }
    h.clock.advance(60_000); // past the recent-list memo
    const text = await (await h.get("/")).text();
    const listed = /\[(.*)\]/.exec(text)?.[1]?.split(",") ?? [];
    assert.equal(listed.length, 12);
    assert.equal(listed[0], mintN(14));
  });

  it("uses MSRP_PUBLIC_URL for links, falling back to the request origin", async () => {
    const h = harness();
    const a = await (await h.get("/", {}, { MSRP_PUBLIC_URL: "https://msrp.example/" })).text();
    assert.match(a, /HOME https:\/\/msrp\.example \[/);
    const b = await (await h.get("/", {}, { MSRP_PUBLIC_URL: "javascript:alert(1)" })).text();
    assert.match(b, /HOME https:\/\/msrp\.test \[/);
  });

  it("serves robots.txt pointing at the sitemap", async () => {
    const h = harness();
    const res = await h.get("/robots.txt", {}, { MSRP_PUBLIC_URL: "https://msrp.example" });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /^User-agent: \*/);
    assert.match(text, /Disallow: \/api\//);
    assert.match(text, /Sitemap: https:\/\/msrp\.example\/sitemap\.xml/);
  });

  it("serves a well-formed, escaped sitemap with static pages and printed coins", async () => {
    const h = harness();
    await h.get(`/api/v1/sticker/${MINT}`);
    await h.get(`/api/v1/sticker/${MINT2}`);
    const res = await h.get("/sitemap.xml", {}, { MSRP_PUBLIC_URL: "https://msrp.example/a&b" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^application\/xml/);
    const xml = await res.text();
    assertWellFormedXml(xml);
    assert.ok(xml.includes("<loc>https://msrp.example/a&amp;b/</loc>"));
    assert.ok(xml.includes(`<loc>https://msrp.example/a&amp;b/coin/${MINT}</loc>`));
    assert.ok(xml.includes(`<loc>https://msrp.example/a&amp;b/methodology</loc>`));
    assert.ok(!xml.includes("/example<"));
    assert.match(xml, /<lastmod>2026-11-19T12:00:00\.000Z<\/lastmod>/);
  });

  it("renderSitemap skips invalid or duplicate mints and caps nothing it isn't given", () => {
    const xml = renderSitemap("https://x.example", ["/"], [
      { mint: MINT, name: null, symbol: null, imageUrl: null, overallStars: null, independentPct: null, computedAt: 0 },
      { mint: MINT, name: null, symbol: null, imageUrl: null, overallStars: null, independentPct: null, computedAt: 1 },
      { mint: "<bad&mint>", name: null, symbol: null, imageUrl: null, overallStars: null, independentPct: null, computedAt: 1 },
      { mint: MINT2, name: null, symbol: null, imageUrl: null, overallStars: null, independentPct: null, computedAt: Number.NaN },
    ]);
    assertWellFormedXml(xml);
    assert.equal(xml.split("<url>").length - 1, 3);
    assert.ok(!xml.includes("bad"));
    assert.ok(xml.includes(`<url><loc>https://x.example/coin/${MINT2}</loc></url>`));
  });
});

describe("failure handling", () => {
  it("turns a renderer crash into a 500 page, and an API crash into JSON", async () => {
    const h = harness({
      render: {
        about: () => {
          throw new Error("render bug at https://secret.example/?token=abc");
        },
      },
    });
    const res = await h.get("/about");
    assert.equal(res.status, 500);
    assertHtmlSecurity(res);
    assert.match(await res.text(), /ERROR 500/);
    assert.ok(!JSON.stringify(h.logs).includes("secret.example"));
    assert.ok(!JSON.stringify(h.logs).includes("abc"));
  });

  it("falls back to plain text if even the error page fails", async () => {
    const boom = () => {
      throw new Error("x");
    };
    const h = harness({ render: { about: boom, error: boom } });
    const res = await h.get("/about");
    assert.equal(res.status, 500);
    assert.match(await res.text(), /Something went wrong/);
  });
});

// ---------------------------------------------------------------------------
// Tiny XML well-formedness check (balanced tags, escaped text, declaration first)
// ---------------------------------------------------------------------------

function assertWellFormedXml(xml: string): void {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "XML declaration first");
  const body = xml.replace(/^<\?xml[^>]*\?>/, "");
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z_][\w.-]*)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = tag.exec(body))) {
    consumed += m[0].length;
    if (m[4] !== undefined) {
      // Text: every & must start an entity, no raw < or >.
      assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(m[4]), `unescaped & in ${JSON.stringify(m[4])}`);
      assert.ok(!m[4].includes(">"), "raw > in text");
      continue;
    }
    const [, close, name, rest] = m;
    if (close) assert.equal(stack.pop(), name, `closing ${name}`);
    else if (!(rest ?? "").trim().endsWith("/")) stack.push(name ?? "");
  }
  assert.equal(consumed, body.length, "only tags and text");
  assert.deepEqual(stack, [], "all tags closed");
}
