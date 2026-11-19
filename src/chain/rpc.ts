/**
 * Solana JSON-RPC client with a hard request budget.
 *
 * - batch() packs many calls into ONE HTTP request (JSON-RPC batch), split into chunks of
 *   LIMITS.MAX_BATCH. Every HTTP request (each chunk, each retry) counts against the budget.
 * - The budget is checked BEFORE sending: if the calls do not fit, BudgetExceededError is thrown
 *   and nothing is sent.
 * - One retry on HTTP 429 / 5xx / network failure, with a short pause, only if budget remains.
 *   No retry when the provider says the method is switched off for us (x-ratelimit-method-limit: 0,
 *   what the public RPC answers for getTokenLargestAccounts): retrying would only waste budget.
 * - Every request has a timeout (AbortController).
 * - Answers are read with a size limit (LIMITS.MAX_RESPONSE_BYTES, and a smaller one per method, e.g.
 *   getProgramAccounts) and cut off while downloading when too big, so one huge answer cannot use up
 *   the Worker's memory or CPU. A cut-off answer is an RpcTransportError with reason "too-large".
 * - Never logs or echoes the URL: it usually contains an API key.
 */
import { LIMITS } from "../config";
import type { RpcClient } from "../types";

export class BudgetExceededError extends Error {
  constructor(
    readonly needed: number,
    readonly remaining: number,
  ) {
    super(`Solana request budget reached (needed ${needed}, ${remaining} left)`);
    this.name = "BudgetExceededError";
  }
}

/** A JSON-RPC error returned by the node for one call (code is the JSON-RPC error code). */
export class RpcError extends Error {
  constructor(
    readonly code: number | null,
    message: string,
    readonly method: string,
  ) {
    super(`Solana RPC ${method} failed${code === null ? "" : ` (${code})`}: ${message.slice(0, 160)}`);
    this.name = "RpcError";
  }
}

/** The HTTP request itself failed (status, network error or timeout). */
export class RpcTransportError extends Error {
  constructor(
    readonly status: number | null,
    readonly reason: "http" | "network" | "timeout" | "bad-response" | "too-large",
  ) {
    super(
      reason === "http"
        ? `Solana RPC answered HTTP ${status}`
        : reason === "timeout"
          ? "Solana RPC timed out"
          : reason === "bad-response"
            ? "Solana RPC sent an unreadable answer"
            : reason === "too-large"
              ? "Solana RPC answer was too large to read"
              : "Solana RPC could not be reached",
    );
    this.name = "RpcTransportError";
  }
}

export interface RpcClientOptions {
  url: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Max HTTP requests this client may make in total. */
  maxRequests: number;
  /** Per-request timeout. */
  timeoutMs: number;
  /** Pause before the single retry (default 600 ms; a shorter Retry-After header wins). */
  retryDelayMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Override the batch chunk size (default LIMITS.MAX_BATCH). */
  maxBatch?: number;
  /** Largest answer (bytes) accepted for one HTTP request (default LIMITS.MAX_RESPONSE_BYTES). */
  maxResponseBytes?: number;
  /**
   * Smaller limits for single calls of some methods (default: getProgramAccounts ->
   * LIMITS.HOLDER_SCAN_MAX_BYTES). A batch uses the sum of its calls' limits when every call has one,
   * else maxResponseBytes.
   */
  methodResponseBytes?: Readonly<Record<string, number>>;
}

/** Default per-method answer limits (see RpcClientOptions.methodResponseBytes). */
export const DEFAULT_METHOD_RESPONSE_BYTES: Readonly<Record<string, number>> = {
  getProgramAccounts: LIMITS.HOLDER_SCAN_MAX_BYTES,
};

export interface BudgetedRpcClient extends RpcClient {
  readonly maxRequests: number;
  /** HTTP requests still allowed. */
  readonly remaining: number;
}

type JsonRpcResponse = { id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createRpcClient(options: RpcClientOptions): BudgetedRpcClient {
  const maxBatch = Math.max(1, Math.floor(options.maxBatch ?? LIMITS.MAX_BATCH));
  const sleep = options.sleep ?? defaultSleep;
  const retryDelayMs = options.retryDelayMs ?? 600;
  const maxResponseBytes = Math.max(1, options.maxResponseBytes ?? LIMITS.MAX_RESPONSE_BYTES);
  const methodResponseBytes = options.methodResponseBytes ?? DEFAULT_METHOD_RESPONSE_BYTES;
  let requests = 0;
  let nextId = 1;

  const remaining = () => Math.max(0, options.maxRequests - requests);

  /** Answer size limit for one HTTP request carrying these methods. */
  function limitFor(methods: string[]): number {
    let sum = 0;
    for (const m of methods) {
      const own = Object.prototype.hasOwnProperty.call(methodResponseBytes, m) ? methodResponseBytes[m] : undefined;
      if (typeof own !== "number" || !(own > 0)) return maxResponseBytes;
      sum += own;
    }
    return Math.min(sum, maxResponseBytes);
  }

  /** One HTTP POST with one retry. Returns parsed JSON or throws RpcTransportError. */
  async function post(body: unknown, maxBytes: number): Promise<unknown> {
    let lastError: RpcTransportError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0 && remaining() < 1) break; // no budget left for the retry
      requests++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      let response: Response;
      try {
        response = await options.fetch(options.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        clearTimeout(timer);
        lastError = new RpcTransportError(null, controller.signal.aborted ? "timeout" : "network");
        if (lastError.reason === "timeout") break; // time is precious: don't retry a timeout
        await sleep(retryDelayMs);
        continue;
      }
      try {
        if (response.status === 429 || response.status >= 500) {
          lastError = new RpcTransportError(response.status, "http");
          // A 429 body can still be a valid per-call error list: keep it for the last attempt.
          const retryAfter = Number(response.headers.get("retry-after"));
          const switchedOff = response.headers.get("x-ratelimit-method-limit") === "0";
          const text = await readLimited(response, maxBytes).catch(() => "");
          if (attempt === 0 && remaining() >= 1 && !switchedOff) {
            const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, retryDelayMs) : retryDelayMs;
            await sleep(wait);
            continue;
          }
          const parsed = safeJson(text);
          if (parsed !== undefined && (Array.isArray(parsed) || isObject(parsed))) return parsed;
          throw lastError;
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new RpcTransportError(response.status, "http");
        }
        const text = await readLimited(response, maxBytes);
        const parsed = safeJson(text);
        if (parsed === undefined) throw new RpcTransportError(response.status, "bad-response");
        return parsed;
      } catch (error) {
        if (error instanceof RpcTransportError) throw error;
        throw new RpcTransportError(null, controller.signal.aborted ? "timeout" : "bad-response");
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new RpcTransportError(null, "network");
  }

  function toResult<T>(method: string, item: JsonRpcResponse | undefined): T | Error {
    if (!item || !isObject(item)) return new RpcError(null, "missing answer", method);
    if (item.error !== undefined && item.error !== null) {
      const code = typeof item.error.code === "number" ? item.error.code : null;
      const message = typeof item.error.message === "string" ? item.error.message : "unknown error";
      return new RpcError(code, message, method);
    }
    if (!("result" in item)) return new RpcError(null, "missing result", method);
    return item.result as T;
  }

  const client: BudgetedRpcClient = {
    get requests() {
      return requests;
    },
    get remaining() {
      return remaining();
    },
    maxRequests: options.maxRequests,

    async call<T>(method: string, params: unknown[]): Promise<T> {
      if (remaining() < 1) throw new BudgetExceededError(1, remaining());
      const id = nextId++;
      const json = await post({ jsonrpc: "2.0", id, method, params }, limitFor([method]));
      const item = Array.isArray(json) ? (json[0] as JsonRpcResponse | undefined) : (json as JsonRpcResponse);
      const result = toResult<T>(method, item);
      if (result instanceof Error) throw result;
      return result;
    },

    async batch<T>(calls: { method: string; params: unknown[] }[]): Promise<(T | Error)[]> {
      if (calls.length === 0) return [];
      const chunks: { method: string; params: unknown[] }[][] = [];
      for (let i = 0; i < calls.length; i += maxBatch) chunks.push(calls.slice(i, i + maxBatch));
      if (chunks.length > remaining()) throw new BudgetExceededError(chunks.length, remaining());
      const out: (T | Error)[] = [];
      for (const chunk of chunks) {
        const ids = chunk.map(() => nextId++);
        const body = chunk.map((c, i) => ({ jsonrpc: "2.0", id: ids[i], method: c.method, params: c.params }));
        let json: unknown;
        try {
          json = await post(body, limitFor(chunk.map((c) => c.method)));
        } catch (error) {
          const err = error instanceof Error ? error : new RpcTransportError(null, "network");
          for (let i = 0; i < chunk.length; i++) out.push(err);
          continue;
        }
        const byId = new Map<unknown, JsonRpcResponse>();
        if (Array.isArray(json)) {
          for (const item of json) if (isObject(item)) byId.set((item as JsonRpcResponse).id, item as JsonRpcResponse);
        } else if (isObject(json) && chunk.length === 1) {
          // Some providers answer a one-item batch (or a batch-level error) with a single object.
          byId.set(ids[0], json as JsonRpcResponse);
        }
        chunk.forEach((c, i) => out.push(toResult<T>(c.method, byId.get(ids[i]))));
      }
      return out;
    },
  };
  return client;
}

/**
 * Read a response body as text, but stop (and cancel the download) once it passes `maxBytes`.
 * Content-Length, when present, is the compressed size, which is never larger than the real one.
 */
export async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new RpcTransportError(response.status, "too-large");
  }
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RpcTransportError(response.status, "too-large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
