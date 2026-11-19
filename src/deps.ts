/**
 * The real wiring of MSRP: every module the web app (src/web/app.ts) needs. src/worker.ts builds the
 * live site from realDeps(); the end-to-end tests build the same site with a replaying fetch.
 */
import { analyze } from "./analyze";
import { createRpcClient } from "./chain/rpc";
import { LIMITS } from "./config";
import { METHODOLOGY } from "./engines/methodology";
import { sampleSticker } from "./engines/sample";
import type { Env, FetchLike } from "./types";
import { renderBadgeSvg } from "./ui/badge";
import { renderOgDefaultSvg, renderOgSvg } from "./ui/og";
import {
  renderAbout,
  renderError,
  renderHome,
  renderMethodology,
  renderNotFound,
  renderPricing,
  renderPrinting,
  renderSticker,
} from "./ui/pages";
import { RPC_TIMEOUT_MS, type AppDeps, type Renderers } from "./web/app";
import { createLimiter } from "./web/limits";
import { createStickerCache } from "./web/store";
import { rpcFromEnv } from "./web/validate";

/** Shown by /api/health (keep in step with package.json). */
export const VERSION = "0.1.0";

// Workers need fetch called unbound from the global scope ("Illegal invocation" otherwise).
const globalFetch: FetchLike = (url, init) => fetch(url, init);

/** Every page and image renderer (src/ui), wired to the routes in src/web/app.ts. */
export const RENDERERS: Renderers = {
  home: renderHome,
  sticker: renderSticker,
  printing: renderPrinting,
  methodology: renderMethodology,
  pricing: renderPricing,
  about: renderAbout,
  notFound: renderNotFound,
  error: renderError,
  badge: renderBadgeSvg,
  og: (sticker) => (sticker ? renderOgSvg(sticker) : renderOgDefaultSvg()),
};

/**
 * The real dependencies of the site. `over` replaces parts of them: the end-to-end tests pass a
 * replaying fetch (recorded mainnet answers), a fixed clock and a memory-only cache; production
 * passes nothing. The Solana client uses the same fetch as DEX Screener.
 */
export function realDeps(over: Partial<AppDeps> = {}): AppDeps {
  const fetchFn = over.fetch ?? globalFetch;
  const now = over.now ?? (() => Date.now());
  return {
    analyze,
    render: RENDERERS,
    methodology: METHODOLOGY,
    sample: sampleSticker,
    rpcFactory: (env: Env) =>
      createRpcClient({
        url: rpcFromEnv(env).url, // a secret: never log it
        fetch: fetchFn,
        maxRequests: LIMITS.MAX_RPC_REQUESTS,
        timeoutMs: RPC_TIMEOUT_MS,
      }),
    now,
    cache: createStickerCache({ now }),
    limiter: createLimiter(),
    fetch: fetchFn,
    version: VERSION,
    ...over,
  };
}
