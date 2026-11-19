/**
 * Record real Solana RPC + DEX Screener traffic into a fixture file, and serve it back offline.
 *
 * - Every JSON-RPC call is stored individually, keyed by `method + stable JSON of params`, so a
 *   batch is replayed item by item no matter how calls get grouped into HTTP requests.
 * - Every plain GET (DEX Screener) is stored by URL.
 * - recordingFetch wraps a real fetch; replayFetch / ReplayRpc never touch the network.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIMITS } from "../../src/config";
import { stableStringify } from "../../src/chain/collect";
import type { FetchLike, RpcClient } from "../../src/types";

export interface FixtureRpcEntry {
  method: string;
  params: unknown[];
  result?: unknown;
  error?: { code: number | null; message: string };
  /** HTTP status of the request that carried this call, when it was not 200. */
  httpStatus?: number;
}

export interface Fixture {
  version: 1;
  name: string;
  mint: string;
  /** Unix ms. Tests use it as "now" so time-relative logic matches the capture. */
  capturedAt: number;
  notes: string[];
  rpc: Record<string, FixtureRpcEntry>;
  http: Record<string, { status: number; body: string }>;
}

export const callKey = (method: string, params: unknown[]) => `${method} ${stableStringify(params)}`;

export function emptyFixture(name: string, mint: string, capturedAt: number): Fixture {
  return { version: 1, name, mint, capturedAt, notes: [], rpc: {}, http: {} };
}

type RpcRequestItem = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };
type RpcResponseItem = { id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };

/** Wrap a real fetch: forwards everything and records each RPC call / GET into `fixture`. */
export function recordingFetch(inner: FetchLike, fixture: Fixture, rpcUrl: string): FetchLike {
  return async (url, init) => {
    const response = await inner(url, init);
    const text = await response.text();
    if (url === rpcUrl && typeof init?.body === "string") {
      const request = JSON.parse(init.body) as RpcRequestItem | RpcRequestItem[];
      const items = Array.isArray(request) ? request : [request];
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const answers = Array.isArray(parsed) ? (parsed as RpcResponseItem[]) : parsed && typeof parsed === "object" ? [parsed as RpcResponseItem] : [];
      const byId = new Map<unknown, RpcResponseItem>();
      for (const a of answers) byId.set(a.id, a);
      for (const item of items) {
        if (typeof item.method !== "string" || !Array.isArray(item.params)) continue;
        const answer = byId.get(item.id) ?? (answers.length === 1 && items.length === 1 ? answers[0] : undefined);
        const entry: FixtureRpcEntry = { method: item.method, params: item.params };
        if (answer && "result" in answer) entry.result = answer.result;
        else {
          const code = typeof answer?.error?.code === "number" ? answer.error.code : null;
          const message = typeof answer?.error?.message === "string" ? answer.error.message : `HTTP ${response.status}`;
          entry.error = { code, message };
        }
        if (response.status !== 200) entry.httpStatus = response.status;
        const key = callKey(item.method, item.params);
        // Keep a successful answer if a later retry of the same call failed.
        const prev = fixture.rpc[key];
        if (!prev || prev.error || !entry.error) fixture.rpc[key] = entry;
      }
    } else {
      fixture.http[url] = { status: response.status, body: text };
    }
    const headers = new Headers({ "content-type": response.headers.get("content-type") ?? "application/json" });
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) headers.set("retry-after", retryAfter);
    return new Response(text, { status: response.status, headers });
  };
}

export interface ReplayStats {
  misses: string[];
  httpRequests: number;
}

/** Serve a fixture as if it were the network. Unknown calls get a JSON-RPC error (and are listed in misses). */
export function replayFetch(fixture: Fixture, rpcUrl = "https://rpc.replay.invalid", stats: ReplayStats = { misses: [], httpRequests: 0 }): FetchLike & { stats: ReplayStats } {
  const fn = (async (url: string, init?: RequestInit) => {
    stats.httpRequests++;
    if (url === rpcUrl) {
      const request = JSON.parse(String(init?.body ?? "null")) as RpcRequestItem | RpcRequestItem[];
      const items = Array.isArray(request) ? request : [request];
      const statuses: number[] = [];
      const out = items.map((item) => {
        const key = callKey(String(item.method), Array.isArray(item.params) ? item.params : []);
        const entry = fixture.rpc[key];
        if (!entry) {
          stats.misses.push(key);
          statuses.push(200);
          return { jsonrpc: "2.0", id: item.id, error: { code: -32099, message: "not in fixture" } };
        }
        statuses.push(entry.httpStatus ?? 200);
        return entry.error ? { jsonrpc: "2.0", id: item.id, error: entry.error } : { jsonrpc: "2.0", id: item.id, result: entry.result };
      });
      // Repeat the recorded HTTP status (e.g. 429 for a refused method) only when every call had it.
      const first = statuses[0] ?? 200;
      const status = statuses.every((s) => s === first) ? first : 200;
      const body = JSON.stringify(Array.isArray(request) ? out : out[0]);
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    }
    const hit = fixture.http[url];
    if (!hit) {
      stats.misses.push(`GET ${url}`);
      return new Response("not in fixture", { status: 404 });
    }
    return new Response(hit.body, { status: hit.status, headers: { "content-type": "application/json" } });
  }) as FetchLike & { stats: ReplayStats };
  fn.stats = stats;
  return fn;
}

/** An RpcClient served straight from a fixture. Counts HTTP requests like the real client (batches in chunks). */
export class ReplayRpc implements RpcClient {
  requests = 0;
  readonly misses: string[] = [];
  readonly calls: string[] = [];
  constructor(
    private readonly fixture: Fixture,
    private readonly maxBatch: number = LIMITS.MAX_BATCH,
  ) {}

  private answer<T>(method: string, params: unknown[]): T | Error {
    const key = callKey(method, params);
    this.calls.push(key);
    const entry = this.fixture.rpc[key];
    if (!entry) {
      this.misses.push(key);
      return new Error(`not in fixture: ${method}`);
    }
    if (entry.error) return new Error(`RPC ${method} failed (${entry.error.code}): ${entry.error.message}`);
    return entry.result as T;
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    this.requests++;
    const r = this.answer<T>(method, params);
    if (r instanceof Error) throw r;
    return r;
  }

  async batch<T>(calls: { method: string; params: unknown[] }[]): Promise<(T | Error)[]> {
    if (calls.length === 0) return [];
    this.requests += Math.ceil(calls.length / this.maxBatch);
    return calls.map((c) => this.answer<T>(c.method, c.params));
  }
}

// ---------------------------------------------------------------------------
// Size trimming: drop fields the chain reader never reads, keep every shape real.
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Fields of a jsonParsed getTransaction result that src/chain never reads. */
function trimInstruction(ix: unknown) {
  if (!isRecord(ix)) return;
  delete ix.stackHeight;
  delete ix.program; // program name; programId is what we read
  // Unparsed instructions keep data (pump.fun events live there); account lists are never read.
  if (ix.parsed === undefined) delete ix.accounts;
}

export function trimTransaction(tx: unknown): void {
  if (!isRecord(tx)) return;
  delete tx.version;
  const meta = tx.meta;
  if (isRecord(meta)) {
    for (const k of ["rewards", "returnData", "computeUnitsConsumed", "costUnits", "status", "loadedAddresses"]) delete meta[k];
    for (const list of [meta.preTokenBalances, meta.postTokenBalances]) {
      if (!Array.isArray(list)) continue;
      for (const b of list) {
        if (!isRecord(b)) continue;
        delete b.programId;
        if (isRecord(b.uiTokenAmount)) {
          delete b.uiTokenAmount.uiAmount;
          delete b.uiTokenAmount.uiAmountString;
        }
      }
    }
    if (Array.isArray(meta.innerInstructions)) {
      for (const group of meta.innerInstructions) if (isRecord(group) && Array.isArray(group.instructions)) group.instructions.forEach(trimInstruction);
    }
    // Compute-unit log lines are never read (invoke / success / Instruction / Program data lines are).
    if (Array.isArray(meta.logMessages)) meta.logMessages = meta.logMessages.filter((l) => typeof l !== "string" || !/^Program \w+ consumed \d+ of \d+ compute units$/.test(l));
  }
  const message = isRecord(tx.transaction) && isRecord(tx.transaction.message) ? tx.transaction.message : null;
  if (message) {
    delete message.recentBlockhash;
    delete message.addressTableLookups;
    if (Array.isArray(message.accountKeys)) {
      for (const k of message.accountKeys) {
        if (!isRecord(k)) continue;
        delete k.source;
        delete k.writable;
      }
    }
    if (Array.isArray(message.instructions)) message.instructions.forEach(trimInstruction);
  }
}

/** Trim every recorded answer in a fixture (transactions and signature lists). Safe to run twice. */
export function trimFixture(fixture: Fixture): void {
  for (const entry of Object.values(fixture.rpc)) {
    if (entry.method === "getTransaction") trimTransaction(entry.result);
    else if (entry.method === "getSignaturesForAddress" && Array.isArray(entry.result)) {
      for (const s of entry.result) {
        if (!isRecord(s)) continue;
        delete s.memo;
        delete s.confirmationStatus;
      }
    }
  }
}

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(here, "..", "fixtures");

/**
 * Replay fixtures are stored gzip-compressed (`<name>.json.gz`, about a quarter of the size: most of
 * a recording is signature lists, which compress well). A plain `<name>.json` is read too.
 */
export function fixturePath(name: string): string {
  const gz = join(FIXTURE_DIR, `${name}.json.gz`);
  return existsSync(gz) ? gz : join(FIXTURE_DIR, `${name}.json`);
}

export function loadFixture(name: string): Fixture {
  const path = fixturePath(name);
  const raw = readFileSync(path);
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as Fixture;
}

/** Write a replay fixture as `<name>.json.gz` (deterministic bytes: no file name or time in the header). Returns the path. */
export function saveFixture(name: string, fixture: Fixture): string {
  const path = join(FIXTURE_DIR, `${name}.json.gz`);
  writeFileSync(path, gzipSync(JSON.stringify(fixture), { level: 9 }));
  return path;
}

/** A fake clock: returns the fixture's capture time (so "now" matches what was recorded). */
export const fixedNow = (fixture: Fixture) => () => fixture.capturedAt;
