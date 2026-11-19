/**
 * MSRP Cloudflare Worker entry point. Wires the real modules into the web app (src/web/app.ts).
 * All routing, caching and limits live in src/web; this file only connects the pieces.
 * MSRP is its own Worker (name "msrp"), separate from SolanaView. No cron, read-only.
 */
import { analyze } from "./analyze";
import { createRpcClient } from "./chain/rpc";
import { LIMITS } from "./config";
import { METHODOLOGY } from "./engines/methodology";
import { sampleSticker } from "./engines/sample";
import type { Env } from "./types";
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
import { createApp, RPC_TIMEOUT_MS } from "./web/app";
import { createLimiter } from "./web/limits";
import { createStickerCache } from "./web/store";
import { rpcFromEnv } from "./web/validate";

/** Shown by /api/health (keep in step with package.json). */
export const VERSION = "0.1.0";

// Workers need fetch called unbound from the global scope ("Illegal invocation" otherwise).
const globalFetch = (url: string, init?: RequestInit) => fetch(url, init);
const now = () => Date.now();

const app = createApp({
  analyze,
  render: {
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
  },
  methodology: METHODOLOGY,
  sample: sampleSticker,
  rpcFactory: (env: Env) =>
    createRpcClient({
      url: rpcFromEnv(env).url, // a secret: never log it
      fetch: globalFetch,
      maxRequests: LIMITS.MAX_RPC_REQUESTS,
      timeoutMs: RPC_TIMEOUT_MS,
    }),
  now,
  cache: createStickerCache({ now }),
  limiter: createLimiter(),
  fetch: globalFetch,
  version: VERSION,
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
