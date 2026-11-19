import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS } from "../src/config";
import { ChainUnavailableError, collectFacts, InvalidMintError, NotFoundError } from "../src/chain/collect";
import { isValidAddress } from "../src/chain/base58";
import { createRpcClient } from "../src/chain/rpc";
import type { AnalyzeOptions, CollectedFacts, RpcClient } from "../src/types";
import { fixedNow, loadFixture, ReplayRpc, replayFetch, type Fixture } from "./helpers/replay";

const FIXTURES = ["curve-coin", "graduated-coin", "curve-coin-fee-sharing"] as const;

function options(f: Fixture, rpc: RpcClient, over: Partial<AnalyzeOptions> = {}): AnalyzeOptions {
  return { rpc, fetch: replayFetch(f), now: fixedNow(f), maxRpcRequests: LIMITS.MAX_RPC_REQUESTS, deadlineMs: LIMITS.DEADLINE_MS, ...over };
}

async function replay(name: string, over: Partial<AnalyzeOptions> = {}) {
  const f = loadFixture(name);
  const rpc = new ReplayRpc(f);
  const facts = await collectFacts(f.mint, options(f, rpc, over));
  return { f, rpc, facts };
}

/** Checks every sticker's facts must pass, whatever the coin. */
function assertSane(facts: CollectedFacts, f: Fixture) {
  const c = facts.coin;
  assert.equal(c.mint, f.mint);
  assert.ok(c.supply > 0, "supply > 0");
  assert.equal(c.decimals, 6);
  assert.equal(c.launchpad, "pump.fun");
  assert.ok(c.creator && isValidAddress(c.creator), "creator found");
  assert.ok(c.bondingCurve, "curve read");
  assert.ok(c.bondingCurve.progressPct !== null && c.bondingCurve.progressPct >= 0 && c.bondingCurve.progressPct <= 100);
  assert.ok(c.createdAt !== null && c.createdAt < f.capturedAt, "creation time found");
  assert.ok(c.creationSlot !== null && c.creationSignature !== null);
  assert.ok(c.devBuySol !== null && c.devBuySol >= 0);
  assert.notEqual(c.mintAuthority, "unknown");
  assert.ok(c.market, "DEX Screener market facts");

  assert.ok(facts.holders.length > 0, "holders found");
  let pct = 0;
  for (const h of facts.holders) {
    assert.ok(["bonding-curve", "pool", "creator", "burn", "program", "wallet"].includes(h.kind));
    assert.ok(h.amount > 0 && h.pctSupply > 0 && h.pctSupply <= 100);
    if (h.kind === "wallet" || h.kind === "creator") assert.ok(h.origin, `origin traced for ${h.owner}`);
    else assert.equal(h.origin, null);
    if (h.origin) {
      assert.equal(h.origin.wallet, h.owner);
      assert.ok(h.origin.signaturesSampled > 0 && h.origin.signaturesSampled <= LIMITS.ORIGIN_SIGNATURES);
      if (!h.origin.historyComplete) assert.equal(h.origin.funder, null, "never guess a funder without the full history");
    }
    pct += h.pctSupply;
  }
  assert.ok(pct <= 100.0001);
  const amounts = facts.holders.map((h) => h.amount);
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a), "largest first");

  for (const e of facts.earlyBuys) {
    assert.ok(e.slotsAfterCreate >= 0 && e.slotsAfterCreate <= 1);
    assert.ok(e.tokenAmount > 0);
    assert.notEqual(e.wallet, c.creator);
  }
  assert.ok(facts.factory, "factory facts");
  assert.equal(facts.factory.deployer, c.creator);
  assert.ok(facts.factory.deployerLaunches.some((l) => l.mint === f.mint), "current coin listed as a launch");
  assert.ok(facts.factory.siblings.length <= LIMITS.MAX_SIBLINGS);

  const cov = facts.coverage;
  assert.ok(cov.rpcRequests > 0 && cov.rpcRequests <= LIMITS.MAX_RPC_REQUESTS, `requests ${cov.rpcRequests} within budget`);
  assert.equal(cov.dexRequests, 1);
  assert.ok(cov.notes.length > 0, "capped steps are explained");
  assert.equal(cov.complete, false);
  for (const n of cov.notes) assert.doesNotMatch(n, /scam|rug|safe|moon|buy now/i);
  assert.equal(facts.collectedAt, f.capturedAt);
}

for (const name of FIXTURES) {
  test(`collectFacts on real ${name} (replayed offline)`, async () => {
    const { f, rpc, facts } = await replay(name);
    assert.deepEqual(rpc.misses, [], "every call was recorded");
    assertSane(facts, f);
    assert.equal(facts.coverage.rpcRequests, rpc.requests);
  });
}

test("curve coin: still on the curve, curve account is the biggest holder", async () => {
  const { facts } = await replay("curve-coin");
  assert.equal(facts.coin.bondingCurve?.complete, false);
  assert.ok(facts.holders.some((h) => h.kind === "bonding-curve"));
  assert.ok(facts.coin.bondingCurve && facts.coin.bondingCurve.progressPct !== null && facts.coin.bondingCurve.progressPct < 100);
});

test("graduated coin: curve complete, pool holds tokens, launch-factory pattern visible", async () => {
  const { facts } = await replay("graduated-coin");
  assert.equal(facts.coin.bondingCurve?.complete, true);
  assert.equal(facts.coin.bondingCurve?.progressPct, 100);
  assert.ok(facts.holders.some((h) => h.kind === "pool"));
  const fac = facts.factory;
  assert.ok(fac);
  // Fresh deployer funded through a temporary wrapped-SOL account by a busy master wallet,
  // sold on PumpSwap after graduation, and swept the SOL back to that master.
  assert.equal(fac.deployer, "BvbAXpW8GQoxCUAooG3H816MRSh4UBvvFP7cjKFqvzsm");
  assert.equal(fac.funder, "AZyfCKACS3nxzeBYLfXF2PKk6FbztboAqXWgCfKmeVvb");
  assert.equal(fac.deployerOrigin?.historyComplete, true);
  assert.ok((fac.deployerOrigin?.fundedSol ?? 0) > 0.4);
  assert.ok(fac.deployerSentBackSol > 13, `sent back ${fac.deployerSentBackSol}`);
  const launch = fac.deployerLaunches.find((l) => l.mint === facts.coin.mint);
  assert.equal(launch?.devSold, true);
  assert.ok(launch?.firstDevSellAfterMin !== null && (launch?.firstDevSellAfterMin ?? 99) < 60);
  assert.ok(fac.funderSignaturesSampled > 0);
  assert.ok(facts.earlyBuys.length > 0, "same-block buyers found");
});

test("fee-sharing coin: deployer comes from the creation, not pump.fun's creator record", async () => {
  const { facts } = await replay("curve-coin-fee-sharing");
  assert.equal(facts.coin.creator, "Et1fXddAXcMPfhqNvXakqhnQt4nwNnMwicuh8zJG6wzv");
  assert.equal(facts.coin.devBuySol, 3.5);
  // Holders were read with the fallback because the public RPC refuses the largest-holders lookup.
  assert.ok(facts.coverage.notes.some((n) => n.includes("refused the largest-holders lookup")));
  // A veteran deployer is not traced: unknown, never zero.
  assert.equal(facts.factory?.funder, null);
  assert.equal(facts.factory?.deployerOrigin?.veteran, true);
  const launch = facts.factory?.deployerLaunches.find((l) => l.mint === facts.coin.mint);
  assert.equal(launch?.devSold, true);
});

test("the real RPC client over the replayed HTTP layer gives the same facts within budget", async () => {
  const f = loadFixture("graduated-coin");
  const http = replayFetch(f);
  const rpc = createRpcClient({ url: "https://rpc.replay.invalid", fetch: http, maxRequests: LIMITS.MAX_RPC_REQUESTS, timeoutMs: 5000, sleep: async () => {} });
  const facts = await collectFacts(f.mint, { ...options(f, rpc), fetch: http });
  assert.deepEqual(http.stats.misses, []);
  assert.ok(rpc.requests <= LIMITS.MAX_RPC_REQUESTS);
  const direct = await replay("graduated-coin");
  assert.deepEqual(facts.coin, direct.facts.coin);
  assert.deepEqual(facts.factory, direct.facts.factory);
  assert.deepEqual(facts.holders, direct.facts.holders);
});

for (const budget of [1, 2, 3, 5, 8]) {
  test(`budget of ${budget} request(s): partial facts, never more requests, never a throw`, async () => {
    for (const name of FIXTURES) {
      const { facts, rpc } = await replay(name, { maxRpcRequests: budget });
      assert.ok(rpc.requests <= budget, `${name}: ${rpc.requests} > ${budget}`);
      assert.equal(facts.coverage.complete, false);
      assert.ok(facts.coverage.notes.some((n) => n.includes(`${budget} Solana request`)), `${name}: budget note`);
      assert.ok(facts.coin.supply > 0, "the coin itself is always read first");
      assert.deepEqual(rpc.misses, [], `${name}: no unrecorded calls`);
    }
  });
}

test("deadline: a slow chain stops early and says so", async () => {
  const f = loadFixture("graduated-coin");
  const rpc = new ReplayRpc(f);
  let t = f.capturedAt;
  // Every clock read moves time 3 seconds forward.
  const facts = await collectFacts(f.mint, options(f, rpc, { now: () => (t += 3000), deadlineMs: 12_000 }));
  assert.equal(facts.coverage.complete, false);
  assert.ok(facts.coverage.notes.some((n) => n.includes("seconds")));
  const full = await replay("graduated-coin");
  assert.ok(rpc.requests < full.rpc.requests);
});

test("invalid mint, missing mint and an unreachable chain are typed errors", async () => {
  const f = loadFixture("curve-coin");
  const rpc = new ReplayRpc(f);
  await assert.rejects(collectFacts("not-a-mint", options(f, rpc)), InvalidMintError);
  assert.equal(rpc.requests, 0);

  const nothing: RpcClient = {
    requests: 0,
    async call() {
      return { context: { slot: 1 }, value: null } as never;
    },
    async batch(calls) {
      return calls.map((c) => (c.method === "getMultipleAccounts" ? { context: { slot: 1 }, value: [null, null] } : [])) as never;
    },
  };
  await assert.rejects(collectFacts("So11111111111111111111111111111111111111113", options(f, nothing)), NotFoundError);

  const wallet: RpcClient = {
    requests: 0,
    async call() {
      return [] as never;
    },
    async batch(calls) {
      return calls.map((c) =>
        c.method === "getMultipleAccounts" ? { context: { slot: 1 }, value: [{ owner: "11111111111111111111111111111111", data: ["", "base64"], lamports: 1 }, null] } : [],
      ) as never;
    },
  };
  await assert.rejects(collectFacts("So11111111111111111111111111111111111111113", options(f, wallet)), InvalidMintError);

  const down: RpcClient = {
    requests: 0,
    async call() {
      throw new Error("down");
    },
    async batch(calls) {
      return calls.map(() => new Error("down"));
    },
  };
  await assert.rejects(collectFacts(f.mint, options(f, down)), ChainUnavailableError);
});

test("round 1 reads the mint and its curve in ONE account call; identical calls are never repeated", async () => {
  const { f, rpc } = await replay("curve-coin-fee-sharing");
  const curve = "3Nx96x3fTCuJhQux8J8MdehAdm11YVK4FcXP7Fi8b7ne";
  assert.ok(rpc.calls.some((k) => k.startsWith(`getMultipleAccounts [["${f.mint}","${curve}"]`)), "mint + curve merged");
  assert.equal(new Set(rpc.calls).size, rpc.calls.length, "no duplicate calls");
  // Many calls, few HTTP requests: that is the point of batching.
  assert.ok(rpc.calls.length > rpc.requests * 3, `${rpc.calls.length} calls in ${rpc.requests} requests`);
});
