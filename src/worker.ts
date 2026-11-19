/**
 * MSRP Cloudflare Worker entry point. The wiring lives in src/deps.ts; all routing, caching and
 * limits live in src/web. MSRP is its own Worker (name "msrp"), separate from SolanaView.
 * No cron, read-only.
 */
import { realDeps } from "./deps";
import type { Env } from "./types";
import { createApp } from "./web/app";

const app = createApp(realDeps());

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
