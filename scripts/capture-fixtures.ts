/**
 * Capture real Solana + DEX Screener answers for two coins into tests/fixtures, so the chain
 * reader can be tested offline. Read-only: it only reads public data.
 *
 *   npx tsx scripts/capture-fixtures.ts                      # find candidates automatically
 *   npx tsx scripts/capture-fixtures.ts <curveMint> <graduatedMint>
 *   npx tsx scripts/capture-fixtures.ts - <graduatedMint>    # "-" skips that coin (keeps its fixture)
 *   npx tsx scripts/capture-fixtures.ts --trim               # only re-trim the existing fixture files
 *   npx tsx scripts/capture-fixtures.ts --top-up <name>      # add only the calls a fixture is missing
 *
 * It runs the real collectFacts() against the public RPC (slowly and politely) and records every
 * call. The public RPC refuses getTokenLargestAccounts; for the graduated coin the script computes
 * the same answer from getProgramAccounts (all of the coin's token accounts, largest 20) and serves
 * that to collectFacts, noting it in the fixture. The curve coin uses collectFacts' own fallback.
 */
import { existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { LIMITS, PROGRAMS } from "../src/config";
import { collectFacts } from "../src/chain/collect";
import { createRpcClient } from "../src/chain/rpc";
import { base64ToBytes, readU64LE } from "../src/chain/bytes";
import { decodeBondingCurveAccount, bondingCurveAddress } from "../src/chain/pump";
import type { CollectedFacts, FetchLike } from "../src/types";
import { politeFetch } from "../tests/helpers/politeFetch";
import {
  callKey,
  emptyFixture,
  FIXTURE_DIR,
  fixturePath,
  loadFixture,
  recordingFetch,
  replayFetch,
  saveFixture,
  trimFixture,
  type Fixture,
} from "../tests/helpers/replay";

const RPC_URL = "https://api.mainnet-beta.solana.com";
const polite = politeFetch(fetch, { minGapMs: 2500, backoffMs: 8000, maxRetries: 8, log: (l) => console.log(l) });

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await polite(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message?: string } };
  if (j.error || j.result === undefined) throw new Error(`${method}: ${j.error?.message ?? r.status}`);
  return j.result;
}

/** pump.fun coins from DEX Screener's latest profiles: one still on the curve, one graduated. */
async function findCandidates(): Promise<{ curve: string; graduated: string }> {
  const profiles = (await (await fetch("https://api.dexscreener.com/token-profiles/latest/v1")).json()) as { chainId?: string; tokenAddress?: string }[];
  const mints = profiles.filter((p) => p.chainId === "solana" && p.tokenAddress?.endsWith("pump")).map((p) => p.tokenAddress as string).slice(0, 30);
  const pairs = (await (await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`)).json()) as { dexId?: string; baseToken?: { address?: string }; volume?: { h24?: number } }[];
  const pick = (dex: string) =>
    pairs
      .filter((p) => p.dexId === dex && p.baseToken?.address)
      .sort((a, b) => (a.volume?.h24 ?? 0) - (b.volume?.h24 ?? 0))
      .map((p) => p.baseToken?.address as string);
  const curves = pick("pumpfun");
  const grads = pick("pumpswap");
  // Confirm curve state on chain.
  const check = async (list: string[], wantComplete: boolean) => {
    for (const m of list) {
      const curve = bondingCurveAddress(m);
      const acc = await rpc<{ value: { data: [string, string] } | null }>("getAccountInfo", [curve, { encoding: "base64" }]);
      const c = acc.value ? decodeBondingCurveAccount(acc.value.data) : null;
      if (c && c.complete === wantComplete) return m;
    }
    throw new Error("no candidate found");
  };
  return { curve: await check(curves.slice(Math.floor(curves.length / 2)), false), graduated: await check(grads.slice(Math.floor(grads.length / 2)), true) };
}

/** The largest-20 answer computed from all token accounts of the mint (same data, other method). */
async function derivedLargest(mint: string): Promise<{ value: unknown; holders: number }> {
  const acc = await rpc<{ value: { owner: string; data: { parsed: { info: { decimals: number } } } } }>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const program = acc.value.owner;
  const decimals = acc.value.data.parsed.info.decimals;
  const filters: unknown[] = [{ memcmp: { offset: 0, bytes: mint } }];
  if (program === PROGRAMS.TOKEN) filters.push({ dataSize: 165 });
  const slot = await rpc<number>("getSlot", [{ commitment: "confirmed" }]);
  const all = await rpc<{ pubkey: string; account: { data: [string, string] } }[]>("getProgramAccounts", [program, { encoding: "base64", dataSlice: { offset: 64, length: 8 }, filters, commitment: "confirmed" }]);
  const rows = all
    .map((a) => {
      const b = base64ToBytes(a.account.data[0]);
      return { address: a.pubkey, raw: b && b.length >= 8 ? readU64LE(b, 0) : 0n };
    })
    .filter((r) => r.raw > 0n)
    .sort((a, b) => (a.raw === b.raw ? 0 : a.raw > b.raw ? -1 : 1))
    .slice(0, LIMITS.TOP_HOLDERS);
  const value = rows.map((r) => {
    const ui = Number(r.raw) / 10 ** decimals;
    return { address: r.address, amount: r.raw.toString(), decimals, uiAmount: ui, uiAmountString: String(ui) };
  });
  return { value: { context: { slot }, value }, holders: all.length };
}

/** Answer getTokenLargestAccounts(mint) locally with a precomputed answer; forward everything else. */
function withLargestOverride(inner: FetchLike, mint: string, answer: unknown): FetchLike {
  return async (url, init) => {
    if (url === RPC_URL && typeof init?.body === "string") {
      const body = JSON.parse(init.body) as { id?: unknown; method?: string; params?: unknown[] } | unknown[];
      if (!Array.isArray(body) && body.method === "getTokenLargestAccounts" && body.params?.[0] === mint) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: answer }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (Array.isArray(body) && body.some((b) => (b as { method?: string }).method === "getTokenLargestAccounts")) {
        throw new Error("capture expects getTokenLargestAccounts on its own request");
      }
    }
    return inner(url, init);
  };
}

async function capture(name: string, mint: string, deriveLargest: boolean): Promise<{ fixture: Fixture; facts: CollectedFacts }> {
  console.log(`\n=== ${name}: ${mint}`);
  let base: FetchLike = polite;
  const fixtureNotes: string[] = [];
  if (deriveLargest) {
    const d = await derivedLargest(mint);
    base = withLargestOverride(polite, mint, d.value);
    fixtureNotes.push(
      `getTokenLargestAccounts is disabled on the public RPC; its answer here was computed at capture time from getProgramAccounts (all ${d.holders} token accounts of the coin, largest 20 by amount).`,
    );
  }
  const capturedAt = Date.now();
  const fixture = emptyFixture(name, mint, capturedAt);
  fixture.notes.push(...fixtureNotes);
  const recFetch = recordingFetch(base, fixture, RPC_URL);
  const client = createRpcClient({ url: RPC_URL, fetch: recFetch, maxRequests: LIMITS.MAX_RPC_REQUESTS, timeoutMs: 120_000 });
  let clock = capturedAt;
  const facts = await collectFacts(mint, {
    rpc: client,
    fetch: recFetch,
    // Frozen clock: replays must make the same time-based decisions as this run.
    now: () => clock,
    maxRpcRequests: LIMITS.MAX_RPC_REQUESTS,
    deadlineMs: LIMITS.DEADLINE_MS,
  });
  clock = Date.now();
  fixture.notes.push(`Captured from the public Solana RPC and DEX Screener at ${new Date(capturedAt).toISOString()} (real wall time ${Math.round((clock - capturedAt) / 1000)} s, slowed down to respect rate limits).`);
  return { fixture, facts };
}

/**
 * Top up an existing fixture after collectFacts learned to make a few more calls: calls already
 * recorded are answered from the file, only the missing ones go to the network (and are recorded).
 * The capture time stays the same and a note lists what was added and when.
 */
async function topUp(name: string): Promise<{ fixture: Fixture; facts: CollectedFacts }> {
  const fixture = loadFixture(name);
  console.log(`\n=== top-up ${name}: ${fixture.mint}`);
  const added: string[] = [];
  const rec = recordingFetch(polite, fixture, RPC_URL);
  const http: FetchLike = async (url, init) => {
    if (url !== RPC_URL) {
      const hit = fixture.http[url];
      if (hit) return new Response(hit.body, { status: hit.status, headers: { "content-type": "application/json" } });
      added.push(`GET ${url}`);
      return rec(url, init);
    }
    const request = JSON.parse(String(init?.body)) as { method: string; params: unknown[] } | { method: string; params: unknown[] }[];
    const items = Array.isArray(request) ? request : [request];
    const missing = items.filter((i) => !fixture.rpc[callKey(i.method, i.params)]);
    if (missing.length > 0) {
      for (const m of missing) added.push(callKey(m.method, m.params).slice(0, 160));
      await (await rec(RPC_URL, { ...init, body: JSON.stringify(missing) })).text();
    }
    // Everything asked is in the fixture now (a failed fetch is recorded as an error): answer from it.
    return replayFetch(fixture, RPC_URL)(url, init);
  };
  const client = createRpcClient({ url: RPC_URL, fetch: http, maxRequests: LIMITS.MAX_RPC_REQUESTS, timeoutMs: 120_000 });
  const facts = await collectFacts(fixture.mint, {
    rpc: client,
    fetch: http,
    now: () => fixture.capturedAt,
    maxRpcRequests: LIMITS.MAX_RPC_REQUESTS,
    deadlineMs: LIMITS.DEADLINE_MS,
  });
  if (added.length > 0) {
    fixture.notes.push(
      `Topped up at ${new Date().toISOString()}: ${added.length} call(s) the chain reader started making after the capture were fetched then (transactions never change; a signature list may include later activity): ${added.join(" | ")}`,
    );
  }
  console.log(`added ${added.length} call(s)`);
  return { fixture, facts };
}

function summary(facts: CollectedFacts) {
  const kinds: Record<string, number> = {};
  for (const h of facts.holders) kinds[h.kind] = (kinds[h.kind] ?? 0) + 1;
  const f = facts.factory;
  return {
    name: facts.coin.name,
    symbol: facts.coin.symbol,
    creator: facts.coin.creator,
    createdAt: facts.coin.createdAt ? new Date(facts.coin.createdAt).toISOString() : null,
    devBuySol: facts.coin.devBuySol,
    curve: facts.coin.bondingCurve,
    funder: f?.funder ?? null,
    funderIsVeteran: f?.funderIsVeteran ?? null,
    funderSignaturesSampled: f?.funderSignaturesSampled ?? null,
    deployerOrigin: f?.deployerOrigin ?? null,
    deployerSentBackSol: f?.deployerSentBackSol ?? null,
    deployerLaunchList: f?.deployerLaunches.map((l) => ({ mint: l.mint, devBuySol: l.devBuySol, devSold: l.devSold, firstDevSellAfterMin: l.firstDevSellAfterMin })) ?? null,
    siblingList: f?.siblings.map((x) => ({ wallet: x.wallet, fundedSol: x.fundedSol, launches: x.launches.length, sentBackSol: x.sentBackSol })) ?? null,
    siblings: f?.siblings.length ?? null,
    deployerLaunches: f?.deployerLaunches.length ?? null,
    siblingLaunches: f ? f.siblings.reduce((s, x) => s + x.launches.length, 0) : null,
    holders: facts.holders.length,
    holderKinds: kinds,
    earlyBuys: facts.earlyBuys.length,
    marketCapUsd: facts.coin.market?.marketCapUsd ?? null,
    rpcRequests: facts.coverage.rpcRequests,
    complete: facts.coverage.complete,
    notes: facts.coverage.notes,
  };
}

const FIXTURE_FILES = ["curve-coin", "graduated-coin", "curve-coin-fee-sharing"];

const mb = (path: string) => `${(statSync(path).size / 1e6).toFixed(2)} MB`;

/** Write a fixture compressed, and remove an old uncompressed copy. */
function store(name: string, fixture: Fixture): string {
  const path = saveFixture(name, fixture);
  const plain = join(FIXTURE_DIR, `${name}.json`);
  if (existsSync(plain)) unlinkSync(plain);
  return path;
}

/** Re-trim and compress fixture files already on disk (drops fields the chain reader never reads). */
function retrimAll() {
  for (const name of FIXTURE_FILES) {
    if (!existsSync(fixturePath(name))) continue;
    const fixture = loadFixture(name);
    trimFixture(fixture);
    const path = store(name, fixture);
    console.log(`trimmed ${path} (${mb(path)}, ${(JSON.stringify(fixture).length / 1e6).toFixed(2)} MB uncompressed)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--trim") return retrimAll();
  if (args[0] === "--top-up") {
    const name = args[1] ?? "";
    if (!FIXTURE_FILES.includes(name)) throw new Error(`--top-up needs one of: ${FIXTURE_FILES.join(", ")}`);
    const { fixture, facts } = await topUp(name);
    trimFixture(fixture);
    const path = store(name, fixture);
    console.log(JSON.stringify(summary(facts), null, 2));
    console.log(`wrote ${path} (${mb(path)}, ${Object.keys(fixture.rpc).length} calls)`);
    return;
  }
  const [curveArg, gradArg] = args;
  const { curve, graduated } = curveArg && gradArg ? { curve: curveArg, graduated: gradArg } : await findCandidates();
  for (const [name, mint, derive] of [
    ["curve-coin", curve, false],
    ["graduated-coin", graduated, true],
  ] as const) {
    if (mint === "-") continue;
    const { fixture, facts } = await capture(name, mint, derive);
    trimFixture(fixture);
    const path = store(name, fixture);
    console.log(JSON.stringify(summary(facts), null, 2));
    console.log(`wrote ${path} (${mb(path)}, ${Object.keys(fixture.rpc).length} calls)`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
