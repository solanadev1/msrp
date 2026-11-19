/**
 * Solana JSON-RPC client with a hard request budget.
 *
 * - batch() packs many calls into ONE HTTP request (JSON-RPC batch), split into chunks of
 *   LIMITS.MAX_BATCH. Every HTTP request (each chunk, each retry) counts against the budget.
 * - The budget is checked BEFORE sending: if the calls do not fit, BudgetExceededError is thrown
 *   and nothing is sent.
 * - One retry on HTTP 429 / 5xx / network failure, with a short pause, only if budget remains.
 * - Every request has a timeout (AbortController).
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
    readonly reason: "http" | "network" | "timeout" | "bad-response",
  ) {
    super(
      reason === "http"
        ? `Solana RPC answered HTTP ${status}`
        : reason === "timeout"
          ? "Solana RPC timed out"
          : reason === "bad-response"
            ? "Solana RPC sent an unreadable answer"
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
}

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
  let requests = 0;
  let nextId = 1;

  const remaining = () => Math.max(0, options.maxRequests - requests);

  /** One HTTP POST with one retry. Returns parsed JSON or throws RpcTransportError. */
  async function post(body: unknown): Promise<unknown> {
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
          const text = await response.text().catch(() => "");
          if (attempt === 0 && remaining() >= 1) {
            const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, retryDelayMs) : retryDelayMs;
            await sleep(wait);
            continue;
          }
          const parsed = safeJson(text);
          if (parsed !== undefined && (Array.isArray(parsed) || isObject(parsed))) return parsed;
          throw lastError;
        }
        if (!response.ok) throw new RpcTransportError(response.status, "http");
        const text = await response.text();
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
      const json = await post({ jsonrpc: "2.0", id, method, params });
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
          json = await post(body);
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
