/**
 * A fetch wrapper for capturing fixtures from the PUBLIC Solana RPC without hammering it.
 * Used only by scripts/capture-fixtures.ts and probes, never by the Worker.
 *
 * What the public RPC does (seen Nov 2026), and how this copes:
 * - It refuses a batch holding two account reads (getAccountInfo / getMultipleAccounts) with
 *   HTTP 429 "method limit 0", and answers many getTransaction calls in one batch with per-item
 *   429 errors. So a JSON-RPC batch is split into small sub-batches (per-method caps below),
 *   sent one at a time, and items refused with code 429 are retried after a pause.
 * - It never serves getTokenLargestAccounts (x-ratelimit-method-limit: 0): that is not retried.
 * The caller still sees ONE response with every answer, in the original order.
 */
export interface PoliteOptions {
  minGapMs?: number;
  backoffMs?: number;
  maxRetries?: number;
  log?: (line: string) => void;
}

const PER_METHOD_CAP: Record<string, number> = {
  getAccountInfo: 1,
  getMultipleAccounts: 1,
  getProgramAccounts: 1,
  getTokenLargestAccounts: 1,
  getTransaction: 4,
  getSignaturesForAddress: 8,
};

type Item = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
type Answer = { id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };

export function politeFetch(inner: typeof fetch, options: PoliteOptions = {}): (url: string, init?: RequestInit) => Promise<Response> {
  const minGap = options.minGapMs ?? 1200;
  const backoff = options.backoffMs ?? 8000;
  const maxRetries = options.maxRetries ?? 6;
  let last = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /** One HTTP request with gap + HTTP-level 429/5xx retries. */
  async function send(url: string, init: RequestInit | undefined): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const wait = last + minGap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const response = await inner(url, init);
      if (response.status !== 429 && response.status < 500) return response;
      const disabled = response.headers.get("x-ratelimit-method-limit") === "0";
      if (disabled || attempt >= maxRetries) {
        options.log?.(`  HTTP ${response.status}${disabled ? " (refused by provider)" : ""}, giving up`);
        return response;
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      const pause = Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, backoff * 2 ** attempt);
      options.log?.(`  HTTP ${response.status}, waiting ${Math.round(pause / 1000)}s`);
      await response.text().catch(() => "");
      await sleep(pause);
    }
  }

  function split(items: Item[]): Item[][] {
    const groups: Item[][] = [];
    let current: Item[] = [];
    let counts: Record<string, number> = {};
    for (const item of items) {
      const m = String(item.method);
      const cap = PER_METHOD_CAP[m] ?? 8;
      if ((counts[m] ?? 0) >= cap) {
        groups.push(current);
        current = [];
        counts = {};
      }
      current.push(item);
      counts[m] = (counts[m] ?? 0) + 1;
    }
    if (current.length) groups.push(current);
    return groups;
  }

  async function sendBatch(url: string, init: RequestInit, items: Item[]): Promise<Response> {
    const answers = new Map<unknown, Answer>();
    let lastStatus = 200;
    let headers: Headers | undefined;
    for (const group of split(items)) {
      let pending = group;
      for (let attempt = 0; pending.length > 0; attempt++) {
        const response = await send(url, { ...init, body: JSON.stringify(pending) });
        headers = response.headers;
        lastStatus = response.status;
        const text = await response.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
        const list = Array.isArray(parsed) ? (parsed as Answer[]) : [];
        for (const a of list) answers.set(a.id, a);
        if (response.status !== 200) break;
        const refused = pending.filter((p) => answers.get(p.id)?.error?.code === 429);
        if (refused.length === 0 || attempt >= maxRetries) break;
        const pause = backoff * 2 ** attempt;
        options.log?.(`  ${refused.length} call(s) rate-limited, waiting ${Math.round(pause / 1000)}s`);
        await sleep(pause);
        pending = refused;
      }
    }
    const merged = items.map((i) => answers.get(i.id) ?? { jsonrpc: "2.0", id: i.id, error: { code: -32098, message: "no answer" } });
    const status = items.length > 0 && items.every((i) => answers.get(i.id)?.error?.code === 429) ? lastStatus : 200;
    const out = new Headers({ "content-type": "application/json" });
    const limit = headers?.get("x-ratelimit-method-limit");
    if (status !== 200 && limit) out.set("x-ratelimit-method-limit", limit);
    return new Response(JSON.stringify(merged), { status, headers: out });
  }

  return (url, init) => {
    const run = async (): Promise<Response> => {
      if (typeof init?.body === "string" && init.body.startsWith("[")) {
        const items = JSON.parse(init.body) as Item[];
        return sendBatch(url, init, items);
      }
      return send(url, init);
    };
    // Serialize: one request at a time.
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };
}
