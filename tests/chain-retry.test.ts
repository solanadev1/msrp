/**
 * How the chain reader copes with a provider that turns calls away (seen live on the public RPC,
 * Nov 2026: each method is let through about 10 times per window and the rest of a batch is
 * answered with per-call 429 errors; big signature batches can also time out).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS } from "../src/config";
import { collectFacts, isRateLimited, isRetryable, type CollectTuning } from "../src/chain/collect";
import { COLLECT } from "../src/chain/constants";
import { RpcError, RpcTransportError } from "../src/chain/rpc";
import type { AnalyzeOptions, RpcClient } from "../src/types";
import { fixedNow, loadFixture, ReplayRpc, replayFetch, type Fixture } from "./helpers/replay";

/** Wraps a replay: calls matching `refuse` get a per-call 429 (the first `times` times each is asked). */
class RefusingRpc implements RpcClient {
  readonly asked = new Map<string, number>();
  /** Every request: when it was sent (real ms) and which methods it carried. */
  readonly sent: { at: number; methods: string[] }[] = [];
  /** When each method was first refused (real ms). */
  readonly firstRefusal = new Map<string, number>();
  refused = 0;
  constructor(
    private readonly inner: ReplayRpc,
    private readonly refuse: (method: string, params: unknown[]) => boolean,
    private readonly times = 1,
  ) {}
  get requests() {
    return this.inner.requests;
  }
  call<T>(method: string, params: unknown[]): Promise<T> {
    return this.inner.call<T>(method, params);
  }
  async batch<T>(calls: { method: string; params: unknown[] }[]): Promise<(T | Error)[]> {
    this.sent.push({ at: Date.now(), methods: calls.map((c) => c.method) });
    const answers = await this.inner.batch<T>(calls);
    return answers.map((a, i) => {
      const c = calls[i];
      if (!c || !this.refuse(c.method, c.params)) return a;
      const key = `${c.method} ${JSON.stringify(c.params)}`;
      const n = (this.asked.get(key) ?? 0) + 1;
      this.asked.set(key, n);
      if (n > this.times) return a;
      this.refused++;
      if (!this.firstRefusal.has(c.method)) this.firstRefusal.set(c.method, Date.now());
      return new RpcError(429, "Too many requests for a specific RPC call", c.method);
    });
  }
}

function options(f: Fixture, rpc: RpcClient): AnalyzeOptions {
  return { rpc, fetch: replayFetch(f), now: fixedNow(f), maxRpcRequests: LIMITS.MAX_RPC_REQUESTS, deadlineMs: LIMITS.DEADLINE_MS };
}

/** The provider's pause, shortened for tests (production waits COLLECT.RETRY_DELAY_MS = 12 s). */
const FAST: CollectTuning = { retryDelayMs: 120, timeoutRetryDelayMs: 20 };

test("which failures are worth one more try", () => {
  assert.equal(isRetryable(new RpcError(429, "Too many requests", "getTransaction")), true);
  assert.equal(isRetryable(new RpcError(-32429, "rate limited", "getTransaction")), true);
  assert.equal(isRetryable(new RpcTransportError(null, "timeout")), true);
  assert.equal(isRetryable(new RpcError(-32602, "Invalid param", "getTransaction")), false);
  assert.equal(isRetryable(new RpcTransportError(null, "too-large")), false);
  assert.equal(isRetryable(new Error("not in fixture")), false);
  assert.equal(isRateLimited(new RpcTransportError(429, "http")), true);
  assert.equal(isRateLimited(new RpcTransportError(503, "http")), false);
});

test("calls refused once for being too fast are retried and the facts come out complete (live: public RPC)", async () => {
  const f = loadFixture("graduated-coin");
  const clean = await collectFacts(f.mint, options(f, new ReplayRpc(f)));
  const cleanRequests = clean.coverage.rpcRequests;

  // Refuse every holder-origin signature list and every transaction the first time it is asked.
  const rpc = new RefusingRpc(new ReplayRpc(f), (m) => m === "getSignaturesForAddress" || m === "getTransaction");
  const started = Date.now();
  const facts = await collectFacts(f.mint, options(f, rpc), FAST);
  assert.ok(rpc.refused > 0);
  assert.ok(Date.now() - started >= FAST.retryDelayMs!, "retries wait before asking again");
  assert.ok(facts.coverage.rpcRequests <= LIMITS.MAX_RPC_REQUESTS, `${facts.coverage.rpcRequests} within budget`);
  assert.ok(facts.coverage.rpcRequests > cleanRequests, "retries cost requests");
  // Retries go out in small batches and spend at most COLLECT.RETRY_MAX_REQUESTS requests, so what
  // could be retried comes back; whatever could not is reported, never silently dropped.
  // Never a third time.
  for (const [key, n] of rpc.asked) assert.ok(n <= 2, `${key} asked ${n} times`);
  assert.equal(facts.coin.creator, clean.coin.creator);
  assert.deepEqual(facts.coin.createdAt, clean.coin.createdAt);
  if (facts.holders.length === clean.holders.length && facts.factory?.siblings.length === clean.factory?.siblings.length) {
    assert.deepEqual(facts.holders, clean.holders);
  } else {
    assert.ok(facts.coverage.notes.some((n) => /turned away some of our requests/.test(n)), "a refusal that stuck is explained");
  }
  for (const n of facts.coverage.notes) assert.doesNotMatch(n, /did not answer/, "a refusal is not described as silence");
});

/** A real clock starting at the fixture's capture time, so the time limit applies as it would live. */
const realClock = (f: Fixture) => {
  const t0 = Date.now();
  return () => f.capturedAt + (Date.now() - t0);
};

test("after a refusal nothing of that method is sent until the provider's window has passed (live: public RPC, 12 s)", async () => {
  const f = loadFixture("graduated-coin");
  const tuning: CollectTuning = { retryDelayMs: 600, timeoutRetryDelayMs: 20 };
  const rpc = new RefusingRpc(new ReplayRpc(f), (m) => m === "getTransaction");
  const facts = await collectFacts(f.mint, { ...options(f, rpc), now: realClock(f), deadlineMs: 4_000 }, tuning);
  const refusedAt = rpc.firstRefusal.get("getTransaction");
  assert.ok(refusedAt !== undefined);
  // Requests carrying getTransaction after the first refusal: none inside the window (they would only
  // be refused again and count against the provider's limit).
  const later = rpc.sent.filter((r) => r.at > refusedAt && r.methods.includes("getTransaction"));
  assert.ok(later.length > 0, "retried after the window");
  for (const r of later) assert.ok(r.at - refusedAt >= tuning.retryDelayMs! - 5, `sent ${r.at - refusedAt} ms after the refusal`);
  // After the window, a method that was refused goes out in small groups (the provider's limit is ~10).
  for (const r of later) assert.ok(r.methods.filter((m) => m === "getTransaction").length <= COLLECT.RETRY_BATCH);
  assert.ok(facts.coverage.rpcRequests <= LIMITS.MAX_RPC_REQUESTS);
});

test("when the window would end after the time limit, refused calls fail at once without spending requests", async () => {
  const f = loadFixture("graduated-coin");
  // The pause (12 s live) can't fit in what is left of the time limit.
  const tuning: CollectTuning = { retryDelayMs: 60_000, timeoutRetryDelayMs: 20 };
  const rpc = new RefusingRpc(new ReplayRpc(f), (m) => m === "getTransaction", Number.POSITIVE_INFINITY);
  const facts = await collectFacts(f.mint, options(f, rpc), tuning);
  const refusedAt = rpc.firstRefusal.get("getTransaction");
  assert.ok(refusedAt !== undefined);
  const sentAfter = rpc.sent.filter((r) => r.at > refusedAt && r.methods.includes("getTransaction")).length;
  assert.equal(sentAfter, 0, "no request wasted on calls the provider would refuse");
  for (const [key, n] of rpc.asked) assert.equal(n, 1, `${key} asked once`);
  assert.ok(facts.coverage.notes.some((n) => /turned away some of our requests \(too many at once\)/.test(n)));
  assert.equal(facts.coverage.complete, false);
});

test("a provider that keeps refusing: one retry per call, budget kept, plain-language notes", async () => {
  const f = loadFixture("graduated-coin");
  const rpc = new RefusingRpc(new ReplayRpc(f), (m) => m === "getTransaction", Number.POSITIVE_INFINITY);
  const facts = await collectFacts(f.mint, options(f, rpc), FAST);
  assert.ok(facts.coverage.rpcRequests <= LIMITS.MAX_RPC_REQUESTS);
  // Never a third time.
  for (const [key, n] of rpc.asked) assert.ok(n <= 2, `${key} asked ${n} times`);
  assert.ok(facts.coverage.notes.some((n) => /turned away some of our requests \(too many at once\)/.test(n)));
  assert.equal(facts.coverage.complete, false);
  // Without the creation transaction the deployer, launch time and family are unknown, never zero.
  assert.equal(facts.coin.createdAt, null);
});

test("unread funder transactions are reported, not shown as 'the funder paid nobody else' (live: Wanted Lucia)", async () => {
  const f = loadFixture("graduated-coin");
  const clean = await collectFacts(f.mint, options(f, new ReplayRpc(f)));
  const funder = clean.factory?.funder;
  assert.ok(funder);
  // Refuse (twice, so the retry fails too) the funder's transactions the clean run read.
  const probe = new ReplayRpc(f);
  await collectFacts(f.mint, options(f, probe));
  const sigsOf = (wallet: string) =>
    Object.values(f.rpc)
      .filter((e) => e.method === "getSignaturesForAddress" && e.params[0] === wallet && Array.isArray(e.result))
      .flatMap((e) => (e.result as { signature?: string }[]).map((x) => x.signature ?? ""));
  // The deployer's own transactions (its funding among them) stay readable: only the funder step is hit.
  const deployerSigs = new Set(sigsOf(clean.factory?.deployer ?? ""));
  const funderTxs = new Set(
    sigsOf(funder).filter((sig) => sig && !deployerSigs.has(sig) && probe.calls.some((c) => c.startsWith(`getTransaction ["${sig}"`))),
  );
  assert.ok(funderTxs.size > 0);
  const rpc = new RefusingRpc(new ReplayRpc(f), (m, p) => m === "getTransaction" && funderTxs.has(String(p[0])), 2);
  const facts = await collectFacts(f.mint, options(f, rpc), FAST);
  assert.ok((facts.factory?.siblings.length ?? 0) < (clean.factory?.siblings.length ?? 0), "fewer siblings seen");
  assert.ok(
    facts.coverage.notes.some((n) => n.includes("the funder's transactions (some wallets it paid may be missing)")),
    facts.coverage.notes.join("\n"),
  );
});
