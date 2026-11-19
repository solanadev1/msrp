import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetExceededError, createRpcClient, RpcError, RpcTransportError } from "../src/chain/rpc";

const URL_WITH_KEY = "https://rpc.example.invalid/?api-key=SECRET123";
type Body = { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];

/** A fake fetch that answers each JSON-RPC item with `answer(method, params)`. */
function fakeFetch(answer: (method: string, params: unknown[]) => unknown, opts: { status?: number[] } = {}) {
  const log: Body[] = [];
  let n = 0;
  const fn = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    log.push(body);
    const status = opts.status?.[n++] ?? 200;
    if (status !== 200) return new Response("busy", { status });
    const items = Array.isArray(body) ? body : [body];
    const out = items.map((i) => ({ jsonrpc: "2.0", id: i.id, result: answer(i.method, i.params) }));
    return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]), { status: 200 });
  };
  return { fn, log };
}

const noSleep = async () => {};

test("batch packs many calls into one HTTP request, results in order", async () => {
  const { fn, log } = fakeFetch((m, p) => `${m}:${String(p[0])}`);
  const rpc = createRpcClient({ url: URL_WITH_KEY, fetch: fn, maxRequests: 5, timeoutMs: 1000, sleep: noSleep });
  const out = await rpc.batch<string>([
    { method: "a", params: [1] },
    { method: "b", params: [2] },
    { method: "c", params: [3] },
  ]);
  assert.deepEqual(out, ["a:1", "b:2", "c:3"]);
  assert.equal(log.length, 1);
  assert.equal(rpc.requests, 1);
});

test("batch splits into chunks of MAX_BATCH; each chunk is one request", async () => {
  const { fn, log } = fakeFetch((_m, p) => p[0]);
  const rpc = createRpcClient({ url: URL_WITH_KEY, fetch: fn, maxRequests: 10, timeoutMs: 1000, sleep: noSleep, maxBatch: 40 });
  const calls = Array.from({ length: 85 }, (_, i) => ({ method: "x", params: [i] }));
  const out = await rpc.batch<number>(calls);
  assert.equal(out.length, 85);
  assert.deepEqual(out.slice(80), [80, 81, 82, 83, 84]);
  assert.equal(log.length, 3);
  assert.equal(rpc.requests, 3);
  assert.equal(rpc.remaining, 7);
});

test("budget is enforced before sending anything", async () => {
  const { fn, log } = fakeFetch(() => 1);
  const rpc = createRpcClient({ url: URL_WITH_KEY, fetch: fn, maxRequests: 2, timeoutMs: 1000, sleep: noSleep, maxBatch: 2 });
  await assert.rejects(
    rpc.batch(Array.from({ length: 5 }, () => ({ method: "x", params: [] }))),
    (e: unknown) => e instanceof BudgetExceededError && e.needed === 3 && e.remaining === 2,
  );
  assert.equal(log.length, 0);
  await rpc.call("x", []);
  await rpc.call("x", []);
  await assert.rejects(rpc.call("x", []), BudgetExceededError);
  assert.equal(log.length, 2);
  assert.deepEqual(await rpc.batch([]), []);
});

test("one retry on 429 / 5xx, and the retry counts as a request", async () => {
  const { fn, log } = fakeFetch(() => "ok", { status: [429, 200] });
  const rpc = createRpcClient({ url: URL_WITH_KEY, fetch: fn, maxRequests: 5, timeoutMs: 1000, sleep: noSleep });
  assert.equal(await rpc.call("x", []), "ok");
  assert.equal(log.length, 2);
  assert.equal(rpc.requests, 2);

  const twice = fakeFetch(() => "ok", { status: [503, 503] });
  const rpc2 = createRpcClient({ url: URL_WITH_KEY, fetch: twice.fn, maxRequests: 5, timeoutMs: 1000, sleep: noSleep });
  const out = await rpc2.batch([{ method: "x", params: [] }, { method: "y", params: [] }]);
  assert.equal(twice.log.length, 2, "only one retry");
  assert.ok(out.every((r) => r instanceof RpcTransportError && r.status === 503));
});

test("no retry when the budget has no room for it", async () => {
  const { fn, log } = fakeFetch(() => "ok", { status: [429, 200] });
  const rpc = createRpcClient({ url: URL_WITH_KEY, fetch: fn, maxRequests: 1, timeoutMs: 1000, sleep: noSleep });
  await assert.rejects(rpc.call("x", []), RpcTransportError);
  assert.equal(log.length, 1);
});

test("a 429 body with per-call errors is passed through as errors", async () => {
  const fn = async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number }[];
    return new Response(JSON.stringify(body.map((b) => ({ jsonrpc: "2.0", id: b.id, error: { code: 429, message: "Too many requests" } }))), { status: 429 });
  };
  const rpc = createRpcClient({ url: URL_WITH_KEY, fetch: fn, maxRequests: 5, timeoutMs: 1000, sleep: noSleep });
  const out = await rpc.batch([{ method: "getTokenLargestAccounts", params: [] }]);
  assert.ok(out[0] instanceof RpcError);
  assert.equal((out[0] as RpcError).code, 429);
  assert.equal(rpc.requests, 2);
});

test("JSON-RPC errors become RpcError; missing answers become errors", async () => {
  const fn = async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string }[] | { id: number };
    if (!Array.isArray(body)) return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Invalid param" } }));
    // Answer only the first item, out of order ids are fine.
    return new Response(JSON.stringify([{ jsonrpc: "2.0", id: body[0]?.id, result: 7 }]));
  };
  const rpc = createRpcClient({ url: URL_WITH_KEY, fetch: fn, maxRequests: 5, timeoutMs: 1000, sleep: noSleep });
  await assert.rejects(rpc.call("getAccountInfo", ["x"]), (e: unknown) => e instanceof RpcError && e.code === -32602);
  const out = await rpc.batch([{ method: "a", params: [] }, { method: "b", params: [] }]);
  assert.equal(out[0], 7);
  assert.ok(out[1] instanceof RpcError);
});

test("timeouts abort the request and are not retried", async () => {
  let calls = 0;
  const hang = (_u: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      calls++;
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const rpc = createRpcClient({ url: URL_WITH_KEY, fetch: hang, maxRequests: 5, timeoutMs: 20, sleep: noSleep });
  await assert.rejects(rpc.call("x", []), (e: unknown) => e instanceof RpcTransportError && e.reason === "timeout");
  assert.equal(calls, 1);
});

test("network failures retry once, then fail every item", async () => {
  let calls = 0;
  const down = async () => {
    calls++;
    throw new TypeError("connection refused");
  };
  const rpc = createRpcClient({ url: URL_WITH_KEY, fetch: down, maxRequests: 5, timeoutMs: 1000, sleep: noSleep });
  const out = await rpc.batch([{ method: "a", params: [] }]);
  assert.equal(calls, 2);
  assert.ok(out[0] instanceof RpcTransportError && out[0].reason === "network");
});

test("error messages never contain the RPC URL or its key", async () => {
  const errors: string[] = [];
  const cases = [
    async () => new Response("nope", { status: 401 }),
    async () => new Response("not json", { status: 200 }),
    async () => {
      throw new Error(`failed to fetch ${URL_WITH_KEY}`);
    },
  ];
  for (const f of cases) {
    const rpc = createRpcClient({ url: URL_WITH_KEY, fetch: f, maxRequests: 5, timeoutMs: 1000, sleep: noSleep });
    try {
      await rpc.call("x", []);
    } catch (e) {
      errors.push(String(e instanceof Error ? e.message : e));
    }
  }
  assert.equal(errors.length, 3);
  for (const m of errors) {
    assert.ok(!m.includes("SECRET123") && !m.includes("example.invalid"), m);
  }
});

test("no retry when the provider says the method is switched off (x-ratelimit-method-limit: 0)", async () => {
  let calls = 0;
  const fn = async (_u: string, init?: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init?.body)) as { id: number };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: 429, message: "Too many requests for a specific RPC call" } }), {
      status: 429,
      headers: { "x-ratelimit-method-limit": "0" },
    });
  };
  const rpc = createRpcClient({ url: URL_WITH_KEY, fetch: fn, maxRequests: 5, timeoutMs: 1000, sleep: noSleep });
  await assert.rejects(rpc.call("getTokenLargestAccounts", ["x"]), (e: unknown) => e instanceof RpcError && e.code === 429);
  assert.equal(calls, 1, "a refused method is not retried");
  assert.equal(rpc.requests, 1);
});

test("answer size limits: per method for single calls, overall for batches; too-large is never retried", async () => {
  const big = "x".repeat(5_000);
  let calls = 0;
  const { fn } = fakeFetch(() => {
    calls++;
    return big;
  });
  const rpc = createRpcClient({
    url: URL_WITH_KEY,
    fetch: fn,
    maxRequests: 10,
    timeoutMs: 1000,
    sleep: noSleep,
    maxResponseBytes: 20_000,
    methodResponseBytes: { getProgramAccounts: 1_000 },
  });
  await assert.rejects(rpc.call("getProgramAccounts", []), (e: unknown) => e instanceof RpcTransportError && e.reason === "too-large");
  assert.equal(calls, 1, "not retried");
  assert.equal(await rpc.call("getTransaction", []), big, "other methods use the overall limit");
  // A batch of 2 limited calls may use 2 x 1,000 bytes: still too small for two 5,000-byte answers.
  const two = await rpc.batch([
    { method: "getProgramAccounts", params: [] },
    { method: "getProgramAccounts", params: [] },
  ]);
  assert.ok(two.every((r) => r instanceof RpcTransportError && r.reason === "too-large"));
  // Mixed with an unlimited method, the overall limit applies.
  const mixed = await rpc.batch([
    { method: "getProgramAccounts", params: [] },
    { method: "getTransaction", params: [] },
  ]);
  assert.deepEqual(mixed, [big, big]);
  const huge = await rpc.batch(Array.from({ length: 5 }, () => ({ method: "getTransaction", params: [] })));
  assert.ok(huge.every((r) => r instanceof RpcTransportError && r.reason === "too-large"), "overall limit");
});
