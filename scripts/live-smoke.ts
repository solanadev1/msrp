/**
 * LIVE SMOKE TEST: run the real analyze() (the same code the Worker runs) against mainnet for a few
 * current coins, print what it found, and check the answers for internal consistency.
 * Read-only: it only reads public data from Solana and DEX Screener.
 *
 *   npm run smoke:live                    # 2 fresh pump.fun coins + 1 recent graduation
 *   npm run smoke:live -- <mint> [<mint>] # specific coins
 *   npm run smoke:live -- --json          # also print each sticker as JSON
 *
 * It uses the public Solana RPC unless the SOLANA_RPC_URL environment variable is set in your shell
 * (the address is never printed: it usually contains an API key). Each coin uses the same request
 * budget, per-request timeout and deadline as the Worker. The creator is cross-checked against
 * RugCheck's public report when that site answers.
 *
 * Exit code 1 when a consistency check fails (not when the network is slow: that is reported).
 */
import { analyze } from "../src/analyze";
import { PROGRAMS, LIMITS } from "../src/config";
import { createRpcClient } from "../src/chain/rpc";
import type { Sticker } from "../src/types";
import { RPC_TIMEOUT_MS } from "../src/web/app";
import { PUBLIC_RPC_URL } from "../src/web/validate";

const RPC_URL = process.env.SOLANA_RPC_URL || PUBLIC_RPC_URL;
const RPC_KIND = process.env.SOLANA_RPC_URL ? "custom (from SOLANA_RPC_URL)" : "public mainnet";
const args = process.argv.slice(2);
const printJson = args.includes("--json");
const given = args.filter((a) => !a.startsWith("--"));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const globalFetch = (url: string, init?: RequestInit) => fetch(url, init);

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<T | null> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  const j = await getJson<{ result?: T }>(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return j?.result ?? null;
}

/** Fresh pump.fun coins from DEX Screener's latest token profiles. */
async function freshCoins(n: number): Promise<string[]> {
  const profiles = await getJson<{ chainId?: string; tokenAddress?: string }[]>("https://api.dexscreener.com/token-profiles/latest/v1");
  const out: string[] = [];
  for (const p of profiles ?? []) {
    const m = p.tokenAddress;
    if (p.chainId === "solana" && typeof m === "string" && m.endsWith("pump") && !out.includes(m)) out.push(m);
    if (out.length >= n) break;
  }
  return out;
}

/** The coin of the most recent pump.fun graduation (every migration is signed by the migration wallet). */
async function recentGraduation(skip: string[]): Promise<string | null> {
  const sigs = await rpc<{ signature: string; err: unknown }[]>("getSignaturesForAddress", [PROGRAMS.PUMP_MIGRATION_WALLET, { limit: 15 }]);
  for (const s of sigs ?? []) {
    if (s.err) continue;
    await sleep(800);
    const tx = await rpc<{ meta?: { postTokenBalances?: { mint?: string }[] } }>("getTransaction", [
      s.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]);
    const mints = (tx?.meta?.postTokenBalances ?? []).map((b) => b.mint).filter((m): m is string => typeof m === "string" && m.endsWith("pump"));
    const m = mints.find((x) => !skip.includes(x));
    if (m) return m;
  }
  return null;
}

/** RugCheck's view of the creator, when its public API answers. */
async function rugcheckCreator(mint: string): Promise<string | null | undefined> {
  const r = await getJson<{ creator?: string }>(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, undefined, 20_000);
  if (r === null) return undefined; // not reachable / no report
  return typeof r.creator === "string" && r.creator ? r.creator : null;
}

const pct = (v: number | null) => (v === null ? "unknown" : `${v.toFixed(2)}%`);
const usd = (v: number | null) => (v === null ? "unknown" : `$${Math.round(v).toLocaleString("en-US")}`);
const stars = (v: number | null) => (v === null ? "not rated" : `${v}/5`);

/** Consistency checks a skeptical analyst would make. Returns the problems found. */
export function auditSticker(s: Sticker): string[] {
  const bad: string[] = [];
  const inRange = (name: string, v: number | null) => {
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100.0001)) bad.push(`${name} out of range: ${v}`);
  };
  const h = s.headline;
  inRange("independentPct", h.independentPct);
  inRange("insiderPct", h.insiderPct);
  for (const [k, v] of Object.entries(s.crowd)) if (typeof v === "number" && k.endsWith("Pct")) inRange(`crowd.${k}`, v);
  if (h.independentPct !== null && h.insiderPct !== null && h.independentPct + h.insiderPct > 100.05) {
    bad.push(`insider ${h.insiderPct} + independent ${h.independentPct} > 100`);
  }
  if ((h.independentPct === null) !== (h.insiderPct === null)) bad.push("independent/insider: one known, the other unknown");
  if (h.stickerPriceUsd !== null) {
    if (h.marketCapUsd === null) bad.push("sticker price without a market cap");
    else if (h.stickerPriceUsd > h.marketCapUsd + 0.01) bad.push("sticker price above market cap");
  }
  if (h.marketCapUsd === null && h.stickerPriceUsd !== null) bad.push("unknown market cap but a sticker price");
  let sum = 0;
  for (const x of s.crowd.topHolders) {
    sum += x.pctSupply;
    const infra = x.kind === "bonding-curve" || x.kind === "pool" || x.kind === "burn" || x.kind === "program";
    if (infra && x.label !== "infrastructure") bad.push(`${x.kind} ${x.owner} labelled ${x.label} (infrastructure must never count as insider/independent)`);
    if (x.label === "infrastructure" && !infra) bad.push(`${x.kind} ${x.owner} labelled infrastructure`);
    if (x.kind === "creator" && x.label !== "insider") bad.push(`creator ${x.owner} labelled ${x.label}`);
  }
  if (sum > 100.0001) bad.push(`top holders add up to ${sum.toFixed(2)}% of supply`);
  for (const c of s.crowd.clusters) inRange(`cluster ${c.id}`, c.pctSupply);
  if (s.crowd.holdersAnalyzed === 0 && (h.insiderPct !== null || s.ratings.crowd.stars !== null)) bad.push("no holders read but holder numbers shown");
  if (s.build.deployer === null && s.ratings.build.stars !== null) bad.push("build rated without a deployer");
  if (!s.disclaimer) bad.push("no disclaimer");
  if (s.market && s.market.liquidityUsd !== null && s.market.marketCapUsd !== null && s.market.liquidityUsd >= s.market.marketCapUsd && (s.ratings.market.stars ?? 0) > 3) {
    bad.push("liquidity above market cap earned top market stars");
  }
  const words = [s.ratings.build.reason, s.ratings.crowd.reason, s.ratings.market.reason, s.ratings.overall.reason, ...s.findings.flatMap((f) => [f.title, f.detail]), ...s.coverage.notes].join("\n");
  const banned = /\b(scam(mer)?|rug(ged)?|safe|moon|buy now|sell now)\b/i.exec(words);
  if (banned) bad.push(`banned word: "${banned[0]}"`);
  if (s.coverage.rpcRequests > LIMITS.MAX_RPC_REQUESTS) bad.push(`${s.coverage.rpcRequests} Solana requests (budget ${LIMITS.MAX_RPC_REQUESTS})`);
  return bad;
}

function print(s: Sticker, rugcheck: string | null | undefined, wallMs: number): void {
  const b = s.build;
  const deployer = b.family.find((m) => m.role === "deployer");
  console.log(`\n=== ${s.name ?? "?"} ($${s.symbol ?? "?"})  ${s.mint}`);
  console.log(`requests: ${s.coverage.rpcRequests} Solana + ${s.coverage.dexRequests} DEX Screener · collect ${s.coverage.elapsedMs} ms · wall ${wallMs} ms`);
  console.log(`launchpad: ${b.launchpad} · graduated: ${b.graduated} · curve: ${b.curveProgressPct ?? "?"}% · created: ${b.createdAt ? new Date(b.createdAt).toISOString() : "unknown"}`);
  const rc = rugcheck === undefined ? "rugcheck: not reachable" : rugcheck === null ? "rugcheck: no creator" : rugcheck === b.deployer ? "rugcheck: SAME creator" : `rugcheck: DIFFERENT creator ${rugcheck}`;
  console.log(`deployer: ${b.deployer ?? "unknown"} (${rc})`);
  console.log(`funder: ${b.funder ?? "unknown"} · funded ${b.deployerFundedBeforeLaunchMin === null ? "?" : `${b.deployerFundedBeforeLaunchMin} min`} before launch · dev buy ${b.devBuySol ?? "?"} SOL`);
  console.log(`family: ${b.familySize} wallets · launches: deployer ${b.deployerLaunchCount} (${deployer?.launchesWithFastDevSell ?? 0} fast sells), family ${b.familyLaunchCount} (${b.familyFastDevSellCount} fast sells) · sent back ${b.sentBackToFunderSol} SOL`);
  console.log(`market cap: ${usd(s.headline.marketCapUsd)} · liquidity: ${usd(s.market?.liquidityUsd ?? null)} · 24h volume: ${usd(s.market?.volume24hUsd ?? null)}`);
  console.log(`holders read: ${s.crowd.holdersAnalyzed} · insider: ${pct(s.headline.insiderPct)} · independent: ${pct(s.headline.independentPct)} (of circulating) · sticker price: ${usd(s.headline.stickerPriceUsd)}`);
  console.log(`crowd: creator ${pct(s.crowd.creatorPct)} · bundle ${pct(s.crowd.bundlePct)} · clustered ${pct(s.crowd.clusteredPct)} · infrastructure ${pct(s.crowd.infrastructurePct)} · top10 ${pct(s.crowd.top10Pct)} (of total)`);
  const kinds = new Map<string, number>();
  for (const x of s.crowd.topHolders) kinds.set(`${x.kind}/${x.label}`, (kinds.get(`${x.kind}/${x.label}`) ?? 0) + x.pctSupply);
  console.log(`holder split: ${[...kinds].map(([k, v]) => `${k} ${v.toFixed(2)}%`).join(" · ") || "none"}`);
  console.log(`stars: overall ${stars(s.ratings.overall.stars)} · build ${stars(s.ratings.build.stars)} · crowd ${stars(s.ratings.crowd.stars)} · market ${stars(s.ratings.market.stars)}`);
  for (const [k, r] of Object.entries(s.ratings)) console.log(`  ${k}: ${r.reason}`);
  console.log("findings:");
  for (const f of s.findings) console.log(`  [${f.severity}] ${f.title}`);
  console.log("coverage notes:");
  for (const n of s.coverage.notes) console.log(`  - ${n}`);
  if (printJson) console.log(JSON.stringify(s, null, 2));
}

async function main(): Promise<void> {
  console.log(`MSRP live smoke · RPC: ${RPC_KIND} · budget ${LIMITS.MAX_RPC_REQUESTS} requests · deadline ${LIMITS.DEADLINE_MS} ms`);
  let mints = given;
  if (mints.length === 0) {
    const fresh = await freshCoins(2);
    const grad = await recentGraduation(fresh);
    mints = [...fresh, ...(grad ? [grad] : [])];
    console.log(`coins: ${fresh.length} fresh from DEX Screener profiles${grad ? " + 1 recent graduation" : " (no graduation found)"}`);
  }
  if (mints.length === 0) {
    console.log("No coins to check (DEX Screener did not answer).");
    process.exitCode = 1;
    return;
  }
  let failures = 0;
  for (const [i, mint] of mints.entries()) {
    if (i > 0) await sleep(5_000); // be polite to the public RPC between coins
    const client = createRpcClient({ url: RPC_URL, fetch: globalFetch, maxRequests: LIMITS.MAX_RPC_REQUESTS, timeoutMs: RPC_TIMEOUT_MS });
    const started = Date.now();
    try {
      const sticker = await analyze(mint, { rpc: client, fetch: globalFetch, now: Date.now, maxRpcRequests: LIMITS.MAX_RPC_REQUESTS, deadlineMs: LIMITS.DEADLINE_MS });
      const wall = Date.now() - started;
      const rc = await rugcheckCreator(mint);
      print(sticker, rc, wall);
      const problems = auditSticker(sticker);
      if (rc && sticker.build.deployer && rc !== sticker.build.deployer) problems.push(`creator differs from RugCheck (${rc})`);
      if (problems.length) {
        failures++;
        for (const p of problems) console.log(`CHECK FAILED: ${p}`);
      } else console.log("checks: all passed");
    } catch (error) {
      console.log(`\n=== ${mint}\nanalyze failed after ${Date.now() - started} ms: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    }
  }
  if (failures) process.exitCode = 1;
}

await main();
