/**
 * MSRP's web app: routes, caching, limits and HTTP details. Everything it needs is passed in
 * (`createApp(deps)`), so tests can use fakes and src/worker.ts wires the real modules.
 *
 * Routes (GET and HEAD; HEAD never starts a new computation):
 *   /                         home + recently checked
 *   /check?mint=<x>           302 -> /coin/<mint> (accepts a pasted link that contains the address)
 *   /coin/<mint>              fresh sticker -> page; older saved sticker -> that page at once, re-checked in the
 *                             background; nothing saved: crawler (or ?wait=1, the no-JavaScript route) -> compute
 *                             now; browser -> waiting page
 *   /api/v1/sticker/<mint>    JSON sticker (computes if needed; only NEW computations are rate limited; when busy
 *                             or over the limit, an older saved sticker is returned with x-msrp-cache: stale)
 *   /api/v1/methodology       JSON rules
 *   /api/health               {ok, version, storage, rpc} (never the RPC address; storage "memory-only" on a
 *                             *.workers.dev address without D1, where Cloudflare's cache does nothing)
 *   /badge/<mint>.svg         badge from storage only (never computes)
 *   /og/<mint>.svg            share card from storage only (generic card otherwise)
 *   /example /methodology /pricing /about /robots.txt /sitemap.xml
 *   /assets/*, /favicon.svg   static files (env.ASSETS)
 */
import { CACHE, DISCLAIMER, LIMITS } from "../config";
import type { AnalyzeOptions, Env, FetchLike, MethodologyRule, PageContext, RecentSticker, RpcClient, Sticker } from "../types";
import { describeError, invalidMintError, isExpectedError, publicError, RateLimitedError, type PublicError } from "./errors";
import { clientIp, type Limiter } from "./limits";
import { looksLikeSticker, type StickerCache } from "./store";
import { cleanBaseUrl, decodeSegment, DEFAULT_SOLANAVIEW_URL, isValidMint, normalizeMintInput, rpcFromEnv } from "./validate";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface Renderers {
  home(ctx: PageContext, recent: RecentSticker[]): string;
  sticker(ctx: PageContext, sticker: Sticker): string;
  printing(ctx: PageContext, mint: string): string;
  methodology(ctx: PageContext, rules: MethodologyRule[]): string;
  pricing(ctx: PageContext): string;
  about(ctx: PageContext): string;
  notFound(ctx: PageContext): string;
  error(ctx: PageContext, title: string, message: string, status: number): string;
  badge(sticker: Sticker | null, mint: string): string;
  /** Share card for a sticker, or the generic card when null. */
  og(sticker: Sticker | null): string;
}

export interface AppDeps {
  analyze(mint: string, opts: AnalyzeOptions): Promise<Sticker>;
  render: Renderers;
  methodology: MethodologyRule[];
  sample(): Sticker;
  rpcFactory(env: Env): RpcClient;
  now(): number;
  cache: StickerCache;
  limiter: Limiter;
  /** Used for DEX Screener (defaults to the global fetch). */
  fetch?: FetchLike;
  /** Shown by /api/health. */
  version?: string;
  /** Error log, without secrets (defaults to console.error). */
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

export interface App {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HTML_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";
export const JSON_CSP = "default-src 'none'; frame-ancestors 'none'";
export const PERMISSIONS_POLICY = "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()";

export const CRAWLER_RE = /bot|crawler|spider|slurp|facebookexternalhit|twitterbot|discordbot|telegrambot|slackbot|linkedinbot/i;

/** Coins listed on the home page. */
export const HOME_RECENT = 12;
/** Coin pages listed in the sitemap. */
export const SITEMAP_MAX = 1000;
/** Browsers may reuse a sticker page / API answer this long. */
export const STICKER_PAGE_MAX_AGE_SEC = 60;
/** Static pages (methodology, pricing, about, example). */
export const STATIC_MAX_AGE_SEC = 60 * 60;
/** The "tap to check" badge for a coin we haven't printed yet: short, so it updates soon. */
export const UNKNOWN_BADGE_MAX_AGE_SEC = Math.min(5 * 60, CACHE.BADGE_TTL_SEC);
/** Per Solana HTTP request; leaves room for a retry inside the sticker's overall deadline. */
export const RPC_TIMEOUT_MS = Math.round(LIMITS.DEADLINE_MS / 2.5);
export const DEFAULT_VERSION = "0.1.0";

export function isCrawler(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && CRAWLER_RE.test(userAgent);
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

type Headers_ = Record<string, string>;

const SECURITY: Headers_ = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export function htmlResponse(body: string, status: number, cacheControl: string, extra: Headers_ = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": cacheControl,
      "content-security-policy": HTML_CSP,
      "permissions-policy": PERMISSIONS_POLICY,
      "x-frame-options": "DENY",
      ...SECURITY,
      ...extra,
    },
  });
}

export function jsonResponse(value: unknown, status: number, cacheControl: string, extra: Headers_ = {}): Response {
  const body = JSON.stringify(withDisclaimer(value));
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
      "content-security-policy": JSON_CSP,
      "access-control-allow-origin": "*",
      "x-robots-tag": "noindex",
      ...SECURITY,
      ...extra,
    },
  });
}

function withDisclaimer(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return typeof v.disclaimer === "string" && v.disclaimer ? v : { ...v, disclaimer: DISCLAIMER };
  }
  return { data: value, disclaimer: DISCLAIMER };
}

export function svgResponse(body: string, status: number, cacheControl: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": cacheControl,
      "content-security-policy": SVG_CSP,
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      ...SECURITY,
    },
  });
}

function textResponse(body: string, status: number, cacheControl: string, contentType = "text/plain; charset=utf-8", extra: Headers_ = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType, "cache-control": cacheControl, ...SECURITY, ...extra },
  });
}

function jsonError(e: PublicError): Response {
  const extra: Headers_ = e.retryAfterSec ? { "retry-after": String(e.retryAfterSec) } : {};
  const body: Record<string, unknown> = { error: e.message, code: e.code };
  if (e.retryAfterSec) body.retryAfterSec = e.retryAfterSec;
  return jsonResponse(body, e.status, "no-store", extra);
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location, "cache-control": "no-store", ...SECURITY } });
}

const publicCache = (sec: number) => `public, max-age=${Math.max(0, Math.floor(sec))}`;

// ---------------------------------------------------------------------------
// Sitemap / robots
// ---------------------------------------------------------------------------

export function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}

export function renderSitemap(publicUrl: string, staticPaths: string[], recent: RecentSticker[]): string {
  const base = publicUrl.replace(/\/+$/, "");
  const urls: string[] = staticPaths.map((p) => `<url><loc>${xmlEscape(base + p)}</loc></url>`);
  const seen = new Set<string>();
  for (const r of recent) {
    if (!isValidMint(r.mint) || seen.has(r.mint)) continue;
    seen.add(r.mint);
    const d = new Date(r.computedAt);
    const lastmod = Number.isFinite(d.getTime()) ? `<lastmod>${d.toISOString()}</lastmod>` : "";
    urls.push(`<url><loc>${xmlEscape(`${base}/coin/${encodeURIComponent(r.mint)}`)}</loc>${lastmod}</url>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`
  );
}

export function renderRobots(publicUrl: string): string {
  return `User-agent: *\nDisallow: /api/\nDisallow: /check\nAllow: /\n\nSitemap: ${publicUrl.replace(/\/+$/, "")}/sitemap.xml\n`;
}

const STATIC_PATHS = ["/", "/methodology", "/pricing", "/about"];

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

export function pageContext(request: Request, env: Env): PageContext {
  const origin = new URL(request.url).origin;
  return {
    publicUrl: cleanBaseUrl(env.MSRP_PUBLIC_URL) ?? origin,
    solanaviewUrl: cleanBaseUrl(env.SOLANAVIEW_URL) ?? DEFAULT_SOLANAVIEW_URL,
  };
}

type Source = "hit" | "miss" | "joined";

export function createApp(deps: AppDeps): App {
  const log = deps.log ?? ((message, detail) => console.error(message, detail ?? ""));
  const fetchFn: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
  const version = deps.version ?? DEFAULT_VERSION;
  const ttlMs = CACHE.STICKER_TTL_SEC * 1000;
  /** Single flight: one analysis per mint per Worker instance at a time. */
  const inflight = new Map<string, Promise<Sticker>>();

  const isFresh = (s: Sticker) => deps.now() - s.computedAt < ttlMs;

  async function runAnalysis(env: Env, mint: string): Promise<Sticker> {
    const opts: AnalyzeOptions = {
      rpc: deps.rpcFactory(env),
      fetch: fetchFn,
      now: deps.now,
      maxRpcRequests: LIMITS.MAX_RPC_REQUESTS,
      deadlineMs: LIMITS.DEADLINE_MS,
    };
    const sticker = await deps.analyze(mint, opts);
    if (!looksLikeSticker(sticker, mint)) throw new Error("analysis returned something that is not a sticker");
    await deps.cache.put(env, sticker); // only successes are stored
    return sticker;
  }

  /** Start (or join) a computation. Throws RateLimitedError or the analysis error. */
  async function compute(env: Env, ctx: ExecutionContext, mint: string, ip: string): Promise<{ sticker: Sticker; source: Source }> {
    const running = inflight.get(mint);
    if (running) return { sticker: await running, source: "joined" };
    const decision = await deps.limiter.take(env, ip, deps.now());
    const startedMeanwhile = inflight.get(mint);
    if (startedMeanwhile) return { sticker: await startedMeanwhile, source: "joined" };
    if (!decision.ok) throw new RateLimitedError(decision.scope, decision.retryAfterSec);
    const job = runAnalysis(env, mint);
    inflight.set(mint, job);
    const done = () => {
      if (inflight.get(mint) === job) inflight.delete(mint);
    };
    job.then(done, done);
    // Let it finish (and be saved) even if this visitor leaves.
    ctx.waitUntil(job.then(() => undefined, () => undefined));
    return { sticker: await job, source: "miss" };
  }

  function logFailure(error: unknown, mint: string): void {
    if (!isExpectedError(error)) log("msrp: sticker failed", { mint, error: describeError(error) });
  }

  /** Re-check an older sticker after the visitor already has it (same limits as any new sticker). */
  function refreshLater(env: Env, ctx: ExecutionContext, mint: string, ip: string): void {
    ctx.waitUntil(compute(env, ctx, mint, ip).then(() => undefined, (error: unknown) => logFailure(error, mint)));
  }

  function errorPage(pc: PageContext, e: PublicError): Response {
    const extra: Headers_ = { "x-robots-tag": "noindex" };
    if (e.retryAfterSec) extra["retry-after"] = String(e.retryAfterSec);
    return htmlResponse(deps.render.error(pc, e.title, e.message, e.status), e.status, "no-store", extra);
  }

  function invalidMintPage(pc: PageContext): Response {
    return errorPage(pc, invalidMintError());
  }

  // --- route handlers -------------------------------------------------------

  async function home(pc: PageContext, env: Env): Promise<Response> {
    const recent = await deps.cache.recent(env, HOME_RECENT);
    return htmlResponse(deps.render.home(pc, recent.slice(0, HOME_RECENT)), 200, publicCache(STICKER_PAGE_MAX_AGE_SEC));
  }

  function check(pc: PageContext, url: URL): Response {
    const raw = url.searchParams.get("mint") ?? url.searchParams.get("q");
    if (raw === null || raw.trim() === "") return redirect("/");
    const mint = normalizeMintInput(raw);
    if (!mint) return invalidMintPage(pc);
    return redirect(`/coin/${encodeURIComponent(mint)}`);
  }

  async function coin(request: Request, env: Env, ctx: ExecutionContext, pc: PageContext, url: URL, segment: string, head: boolean): Promise<Response> {
    const mint = decodeSegment(segment);
    if (!isValidMint(mint)) return invalidMintPage(pc);
    const saved = await deps.cache.get(env, mint);
    if (saved && isFresh(saved)) {
      return htmlResponse(deps.render.sticker(pc, saved), 200, publicCache(STICKER_PAGE_MAX_AGE_SEC), { "x-msrp-cache": "hit" });
    }
    if (saved) {
      // An older sticker (it shows its own date): show it now and re-check in the background, so a busy
      // network or a used-up limit never turns a coin we already printed into an error or a wait.
      if (!head) refreshLater(env, ctx, mint, clientIp(request));
      return htmlResponse(deps.render.sticker(pc, saved), 200, "no-store", { "x-msrp-cache": "stale" });
    }
    const inline = isCrawler(request.headers.get("user-agent")) || url.searchParams.get("wait") === "1";
    if (head || !inline) {
      // Browsers get the waiting page at once; its script calls the API, then reloads.
      return htmlResponse(deps.render.printing(pc, mint), 200, "no-store", { "x-robots-tag": "noindex" });
    }
    try {
      const { sticker, source } = await compute(env, ctx, mint, clientIp(request));
      return htmlResponse(deps.render.sticker(pc, sticker), 200, publicCache(STICKER_PAGE_MAX_AGE_SEC), { "x-msrp-cache": source });
    } catch (error) {
      logFailure(error, mint);
      return errorPage(pc, publicError(error));
    }
  }

  async function apiSticker(request: Request, env: Env, ctx: ExecutionContext, segment: string, head: boolean): Promise<Response> {
    const mint = decodeSegment(segment);
    if (!isValidMint(mint)) return jsonError(invalidMintError());
    const saved = await deps.cache.get(env, mint);
    if (saved && isFresh(saved)) {
      return jsonResponse(saved, 200, publicCache(STICKER_PAGE_MAX_AGE_SEC), { "x-msrp-cache": "hit" });
    }
    if (head) {
      // HEAD never starts a computation: 202 = "not printed yet, GET to print it".
      return jsonResponse({ status: "not-printed" }, 202, "no-store");
    }
    try {
      const { sticker, source } = await compute(env, ctx, mint, clientIp(request));
      return jsonResponse(sticker, 200, publicCache(STICKER_PAGE_MAX_AGE_SEC), { "x-msrp-cache": source });
    } catch (error) {
      logFailure(error, mint);
      const e = publicError(error);
      // Busy or over the limit, but we have an older sticker: return it (computedAt carries its date).
      if (saved && (e.status === 429 || e.status === 503)) return jsonResponse(saved, 200, "no-store", { "x-msrp-cache": "stale" });
      return jsonError(e);
    }
  }

  async function badge(env: Env, segment: string): Promise<Response> {
    const mint = decodeSegment(segment);
    if (!isValidMint(mint)) return textResponse("Not a valid coin address.", 400, "no-store");
    const stored = await deps.cache.get(env, mint); // never computes
    // Too old to show without its date: "tap to check" instead (the coin page re-checks it).
    const saved = stored && deps.now() - stored.computedAt <= CACHE.BADGE_MAX_AGE_SEC * 1000 ? stored : null;
    const maxAge = saved ? CACHE.BADGE_TTL_SEC : UNKNOWN_BADGE_MAX_AGE_SEC;
    return svgResponse(deps.render.badge(saved, mint), 200, publicCache(maxAge));
  }

  async function og(env: Env, segment: string): Promise<Response> {
    if (segment === "default") return svgResponse(deps.render.og(null), 200, publicCache(STATIC_MAX_AGE_SEC));
    const mint = decodeSegment(segment);
    if (!isValidMint(mint)) return textResponse("Not a valid coin address.", 400, "no-store");
    const saved = await deps.cache.get(env, mint); // never computes
    return svgResponse(deps.render.og(saved), 200, publicCache(saved ? CACHE.BADGE_TTL_SEC : UNKNOWN_BADGE_MAX_AGE_SEC));
  }

  function health(env: Env, url: URL): Response {
    // Cloudflare's cache does nothing on *.workers.dev addresses: without D1, stickers live only in
    // each Worker instance's memory there. Say so instead of suggesting the cache works.
    const kind = deps.cache.storage(env);
    const storage = kind === "cache-only" && /\.workers\.dev$/i.test(url.hostname) ? "memory-only" : kind;
    return jsonResponse({ ok: true, version, storage, rpc: rpcFromEnv(env).kind }, 200, "no-store");
  }

  async function sitemap(pc: PageContext, env: Env): Promise<Response> {
    const recent = await deps.cache.recent(env, SITEMAP_MAX);
    return textResponse(renderSitemap(pc.publicUrl, STATIC_PATHS, recent.slice(0, SITEMAP_MAX)), 200, publicCache(STATIC_MAX_AGE_SEC), "application/xml; charset=utf-8");
  }

  async function assets(request: Request, env: Env): Promise<Response> {
    if (!env.ASSETS) return textResponse("Not found.", 404, "no-store");
    return env.ASSETS.fetch(request);
  }

  // --- dispatcher -----------------------------------------------------------

  async function route(request: Request, env: Env, ctx: ExecutionContext, head: boolean): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") || "/" : url.pathname;
    const pc = pageContext(request, env);
    let m: RegExpExecArray | null;

    if (path.startsWith("/assets/") || path === "/favicon.svg") return assets(request, env);
    if (path === "/") return home(pc, env);
    if (path === "/check") return check(pc, url);
    if ((m = /^\/coin\/([^/]+)$/.exec(path))) return coin(request, env, ctx, pc, url, m[1] ?? "", head);
    if ((m = /^\/api\/v1\/sticker\/([^/]+)$/.exec(path))) return apiSticker(request, env, ctx, m[1] ?? "", head);
    if (path === "/api/v1/methodology") return jsonResponse({ rules: deps.methodology }, 200, publicCache(STATIC_MAX_AGE_SEC));
    if (path === "/api/health") return health(env, url);
    if (path.startsWith("/api/")) {
      return jsonResponse({ error: "There is no API route at this address.", code: "no_route" }, 404, "no-store");
    }
    if ((m = /^\/badge\/([^/]+)\.svg$/.exec(path))) return badge(env, m[1] ?? "");
    if ((m = /^\/og\/([^/]+)\.svg$/.exec(path))) return og(env, m[1] ?? "");
    if (path === "/example") return htmlResponse(deps.render.sticker(pc, deps.sample()), 200, publicCache(STATIC_MAX_AGE_SEC));
    if (path === "/methodology") return htmlResponse(deps.render.methodology(pc, deps.methodology), 200, publicCache(STATIC_MAX_AGE_SEC));
    if (path === "/pricing") return htmlResponse(deps.render.pricing(pc), 200, publicCache(STATIC_MAX_AGE_SEC));
    if (path === "/about") return htmlResponse(deps.render.about(pc), 200, publicCache(STATIC_MAX_AGE_SEC));
    if (path === "/robots.txt") return textResponse(renderRobots(pc.publicUrl), 200, publicCache(STATIC_MAX_AGE_SEC));
    if (path === "/sitemap.xml") return sitemap(pc, env);
    return htmlResponse(deps.render.notFound(pc), 404, publicCache(300), { "x-robots-tag": "noindex" });
  }

  function crash(request: Request, env: Env, error: unknown): Response {
    log("msrp: request failed", { path: safePath(request), error: describeError(error) });
    const e = publicError(error);
    if (safePath(request).startsWith("/api/")) return jsonError(e);
    try {
      return errorPage(pageContext(request, env), e);
    } catch {
      return textResponse(e.message, e.status, "no-store");
    }
  }

  return {
    async fetch(request, env, ctx) {
      const method = request.method.toUpperCase();
      const isApi = safePath(request).startsWith("/api/");
      if (method === "OPTIONS" && isApi) {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, HEAD",
            "access-control-allow-headers": "Accept, Content-Type",
            "access-control-max-age": "86400",
            ...SECURITY,
          },
        });
      }
      if (method !== "GET" && method !== "HEAD") {
        const allow = { allow: "GET, HEAD" };
        return isApi
          ? jsonResponse({ error: "Only GET requests are supported.", code: "method_not_allowed" }, 405, "no-store", allow)
          : textResponse("Only GET requests are supported.", 405, "no-store", undefined, allow);
      }
      const head = method === "HEAD";
      let response: Response;
      try {
        response = await route(request, env, ctx, head);
      } catch (error) {
        response = crash(request, env, error);
      }
      return head ? new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers }) : response;
    },
  };
}

function safePath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}
