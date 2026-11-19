/**
 * The holder-list fallback (used when the provider refuses getTokenLargestAccounts, as the public
 * RPC does): every token account of the coin via getProgramAccounts, owner + amount only, with hard
 * limits so a popular coin can't exhaust a Worker's memory or CPU.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, PROGRAMS } from "../src/config";
import { collectFacts, holderRowsFromProgramAccounts } from "../src/chain/collect";
import { encodeBase58 } from "../src/chain/base58";
import { bytesToBase64 } from "../src/chain/bytes";
import { createRpcClient, readLimited, RpcTransportError } from "../src/chain/rpc";
import type { AnalyzeOptions, FetchLike, RpcClient } from "../src/types";

const MINT = "So11111111111111111111111111111111111111113";
const NOW = 1_795_000_000_000;

/** A deterministic 32-byte address from a number (owner or token account). */
function address(n: number, salt: number): string {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = (n * 31 + i * 7 + salt * 13 + ((n >> 8) & 0xff)) & 0xff;
  b[0] = salt;
  b[1] = n & 0xff;
  b[2] = (n >> 8) & 0xff;
  return encodeBase58(b);
}

/** One getProgramAccounts item with dataSlice {offset 32, length 40}: owner (32 bytes) + amount (u64 LE). */
function gpaItem(n: number, rawAmount: bigint) {
  const data = new Uint8Array(40);
  data.set(Uint8Array.from(Array.from({ length: 32 }, (_, i) => (n * 17 + i * 3 + 1) & 0xff)), 0);
  data[0] = 0xaa;
  data[1] = n & 0xff;
  data[2] = (n >> 8) & 0xff;
  new DataView(data.buffer).setBigUint64(32, rawAmount, true);
  return {
    pubkey: address(n, 2),
    account: { data: [bytesToBase64(data), "base64"], executable: false, lamports: 2_039_280, owner: PROGRAMS.TOKEN, rentEpoch: 0, space: 165 },
  };
}
const ownerOf = (item: ReturnType<typeof gpaItem>) => {
  const raw = atob(item.account.data[0] as string);
  return encodeBase58(Uint8Array.from(raw.slice(0, 32), (c) => c.charCodeAt(0)));
};

function mintAccount(program: string) {
  return {
    owner: program,
    lamports: 1_461_600,
    executable: false,
    data: { program: "spl-token", parsed: { type: "mint", info: { decimals: 6, supply: "1000000000000000", mintAuthority: null, freezeAuthority: null, isInitialized: true } } },
  };
}

type Answer = (method: string, params: unknown[]) => unknown;

/** A scripted chain: the mint exists, nothing else does; getTokenLargestAccounts is refused. */
function scriptedAnswer(program: string, gpa: () => unknown): Answer {
  return (method, params) => {
    switch (method) {
      case "getMultipleAccounts": {
        const keys = params[0] as string[];
        return { context: { slot: 1 }, value: keys.map((k) => (k === MINT ? mintAccount(program) : null)) };
      }
      case "getSignaturesForAddress":
        return [];
      case "getTokenLargestAccounts":
        return new Error("Too many requests for a specific RPC call");
      case "getProgramAccounts":
        return gpa();
      default:
        return null;
    }
  };
}

class ScriptedRpc implements RpcClient {
  requests = 0;
  readonly log: { method: string; params: unknown[]; via: "call" | "batch" }[] = [];
  constructor(private readonly answer: Answer) {}
  async call<T>(method: string, params: unknown[]): Promise<T> {
    this.requests++;
    this.log.push({ method, params, via: "call" });
    const r = this.answer(method, params);
    if (r instanceof Error) throw r;
    return r as T;
  }
  async batch<T>(calls: { method: string; params: unknown[] }[]): Promise<(T | Error)[]> {
    if (calls.length === 0) return [];
    this.requests += Math.ceil(calls.length / LIMITS.MAX_BATCH);
    return calls.map((c) => {
      this.log.push({ method: c.method, params: c.params, via: "batch" });
      return this.answer(c.method, c.params) as T | Error;
    });
  }
}

const noFetch: FetchLike = async () => new Response("[]", { status: 200 });
const options = (rpc: RpcClient, over: Partial<AnalyzeOptions> = {}): AnalyzeOptions => ({
  rpc,
  fetch: noFetch,
  now: () => NOW,
  maxRpcRequests: LIMITS.MAX_RPC_REQUESTS,
  deadlineMs: LIMITS.DEADLINE_MS,
  ...over,
});

test("holderRowsFromProgramAccounts: largest first, only the top N, skips empty and broken entries", () => {
  const items = [gpaItem(1, 5_000_000n), gpaItem(2, 0n), gpaItem(3, 9_000_000n), { pubkey: "x" }, null, gpaItem(4, 7_000_000n), { pubkey: "y", account: { data: ["!!", "base64"] } }];
  const rows = holderRowsFromProgramAccounts(items, 6, 2);
  assert.deepEqual(
    rows.map((r) => [r.tokenAccount, r.amount]),
    [
      [address(3, 2), 9],
      [address(4, 2), 7],
    ],
  );
  assert.equal(rows[0]?.owner, ownerOf(gpaItem(3, 1n)));
  assert.equal(holderRowsFromProgramAccounts(items, 6).length, 3, "no limit: every non-empty account");
  assert.deepEqual(holderRowsFromProgramAccounts("junk", 6), []);
});

test("fallback for a classic SPL token: dataSize + mint filters, owner + amount only, on its own request", async () => {
  const items = Array.from({ length: 50 }, (_, i) => gpaItem(i + 1, BigInt((i + 1) * 1_000_000)));
  const rpc = new ScriptedRpc(scriptedAnswer(PROGRAMS.TOKEN, () => items));
  const facts = await collectFacts(MINT, options(rpc));
  const gpa = rpc.log.filter((c) => c.method === "getProgramAccounts");
  assert.equal(gpa.length, 1);
  assert.equal(gpa[0]?.via, "call", "isolated: a refusal or a cut-off answer can't spoil other calls");
  assert.deepEqual(gpa[0]?.params, [
    PROGRAMS.TOKEN,
    { encoding: "base64", dataSlice: { offset: 32, length: 40 }, filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: MINT } }], commitment: "confirmed" },
  ]);
  assert.equal(facts.holders.length, LIMITS.TOP_HOLDERS);
  assert.equal(facts.holders[0]?.amount, 50);
  assert.equal(facts.holders[0]?.owner, ownerOf(items[49] as ReturnType<typeof gpaItem>));
  assert.ok(Math.abs((facts.holders[0]?.pctSupply ?? 0) - 0.000005) < 1e-12);
  assert.ok(facts.coverage.notes.some((n) => n.includes("refused the largest-holders lookup") && n.includes("all 50 token accounts")));
});

test("fallback for a Token-2022 coin: only the mint filter (account sizes vary with extensions)", async () => {
  const rpc = new ScriptedRpc(scriptedAnswer(PROGRAMS.TOKEN_2022, () => [gpaItem(1, 1_000_000n)]));
  const facts = await collectFacts(MINT, options(rpc));
  const gpa = rpc.log.find((c) => c.method === "getProgramAccounts");
  assert.deepEqual(gpa?.params, [PROGRAMS.TOKEN_2022, { encoding: "base64", dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: MINT } }], commitment: "confirmed" }]);
  assert.equal(facts.holders.length, 1);
});

test(`fallback cap: more than ${LIMITS.HOLDER_SCAN_MAX_ACCOUNTS} token accounts -> holders unknown with a note, no failure`, async () => {
  const many = Array.from({ length: LIMITS.HOLDER_SCAN_MAX_ACCOUNTS + 1 }, (_, i) => gpaItem(i, 1_000_000n));
  const rpc = new ScriptedRpc(scriptedAnswer(PROGRAMS.TOKEN_2022, () => many));
  const facts = await collectFacts(MINT, options(rpc));
  assert.deepEqual(facts.holders, []);
  assert.equal(facts.coverage.complete, false);
  assert.ok(facts.coverage.notes.some((n) => n.includes(`more than ${LIMITS.HOLDER_SCAN_MAX_ACCOUNTS.toLocaleString("en-US")} token accounts`)));
  assert.ok(facts.coverage.notes.some((n) => n.includes("Holder shares are unknown")));
  // Nothing was read about the would-be holders.
  assert.equal(rpc.log.filter((c) => c.method === "getMultipleAccounts").length, 1, "only the mint + curve read");
  assert.equal(facts.coin.supply, 1_000_000_000);
});

test("fallback refused too -> holders unknown with a note, no failure", async () => {
  const rpc = new ScriptedRpc(scriptedAnswer(PROGRAMS.TOKEN, () => new Error("getProgramAccounts is not available")));
  const facts = await collectFacts(MINT, options(rpc));
  assert.deepEqual(facts.holders, []);
  assert.ok(facts.coverage.notes.some((n) => n.includes("refused both ways")));
});

test("fallback through the real RPC client: an oversized answer is cut off while downloading", async () => {
  const many = Array.from({ length: 8_000 }, (_, i) => gpaItem(i, 1_000_000n));
  let gpaBytesOffered = 0;
  let gpaBytesPulled = 0;
  const answer = scriptedAnswer(PROGRAMS.TOKEN_2022, () => many);
  const http: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
    const items = Array.isArray(body) ? body : [body];
    const out = items.map((i) => {
      const r = answer(i.method, i.params);
      return r instanceof Error ? { jsonrpc: "2.0", id: i.id, error: { code: 429, message: r.message } } : { jsonrpc: "2.0", id: i.id, result: r };
    });
    const text = JSON.stringify(Array.isArray(body) ? out : out[0]);
    if (!Array.isArray(body) && body.method === "getProgramAccounts") {
      // Stream it in 64 KB chunks, without a Content-Length, like a chunked HTTP answer.
      const bytes = new TextEncoder().encode(text);
      gpaBytesOffered = bytes.length;
      let at = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (at >= bytes.length) return controller.close();
          const chunk = bytes.subarray(at, at + 65_536);
          at += chunk.length;
          gpaBytesPulled = at;
          controller.enqueue(chunk);
        },
      });
      return new Response(stream, { status: 200 });
    }
    return new Response(text, { status: 200 });
  };
  const rpc = createRpcClient({ url: "https://rpc.test.invalid", fetch: http, maxRequests: LIMITS.MAX_RPC_REQUESTS, timeoutMs: 5_000, sleep: async () => {} });
  const facts = await collectFacts(MINT, { ...options(rpc), fetch: noFetch });
  assert.ok(gpaBytesOffered > LIMITS.HOLDER_SCAN_MAX_BYTES, "the fake answer really is too big");
  assert.ok(gpaBytesPulled < gpaBytesOffered, `stopped reading at ${gpaBytesPulled} of ${gpaBytesOffered} bytes`);
  assert.ok(gpaBytesPulled <= LIMITS.HOLDER_SCAN_MAX_BYTES + 2 * 65_536, "at most one chunk read ahead");
  assert.deepEqual(facts.holders, []);
  assert.ok(facts.coverage.notes.some((n) => n.includes(`more than ${LIMITS.HOLDER_SCAN_MAX_ACCOUNTS.toLocaleString("en-US")} token accounts`)));
  assert.ok(rpc.requests <= LIMITS.MAX_RPC_REQUESTS);
});

test("readLimited: stops a never-ending answer, and trusts a too-big Content-Length without reading", async () => {
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1_000).fill(32));
    },
  });
  await assert.rejects(readLimited(new Response(endless), 10_000), (e: unknown) => e instanceof RpcTransportError && e.reason === "too-large");
  assert.ok(pulled <= 12, `pulled ${pulled} chunks`);
  let read = false;
  const lazy = new ReadableStream<Uint8Array>({
    pull() {
      read = true;
    },
  });
  await assert.rejects(readLimited(new Response(lazy, { headers: { "content-length": "999999" } }), 1_000), (e: unknown) => e instanceof RpcTransportError && e.reason === "too-large");
  assert.equal(read, false);
  assert.equal(await readLimited(new Response("héllo"), 100), "héllo");
});
