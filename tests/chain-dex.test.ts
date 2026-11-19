import { test } from "node:test";
import assert from "node:assert/strict";
import { dexTokenUrl, fetchDexToken, parseDexPairs } from "../src/chain/dex";

const MINT = "Hd1ePXKpGhxHrWzyyp3RS3B7dsDjYTNuWiqYDknYpump";
// Shape copied from a real DEX Screener /tokens/v1/solana answer (Nov 19 2026), values trimmed.
const pair = (over: Record<string, unknown> = {}) => ({
  chainId: "solana",
  dexId: "pumpswap",
  url: "https://dexscreener.com/solana/hcjeg3iwfbrvr3fjvgzanxkkebdhudzntqddsznn899e",
  pairAddress: "Hcjeg3iWFbrvR3FJvGZAnxKkEbDhuDZNtqdDSZnN899e",
  baseToken: { address: MINT, name: "DacityCoin", symbol: "FiveM" },
  quoteToken: { address: "So11111111111111111111111111111111111111112", name: "Wrapped SOL", symbol: "SOL" },
  priceNative: "0.0000004026",
  priceUsd: "0.00002948",
  volume: { h24: 32528.42 },
  priceChange: { h24: -18.04 },
  liquidity: { usd: 11288.88, base: 206270650, quote: 71.08338 },
  fdv: 29451,
  marketCap: 29451,
  pairCreatedAt: 1795051386000,
  info: { imageUrl: "https://cdn.dexscreener.com/cms/images/CgaLHpFL3gPggPic?width=800" },
  ...over,
});

test("parses the real shape into market facts", () => {
  const info = parseDexPairs([pair()], MINT);
  assert.ok(info);
  assert.equal(info.name, "DacityCoin");
  assert.equal(info.symbol, "FiveM");
  assert.equal(info.imageUrl, "https://cdn.dexscreener.com/cms/images/CgaLHpFL3gPggPic?width=800");
  assert.deepEqual(info.market, {
    priceUsd: 0.00002948,
    marketCapUsd: 29451,
    fdvUsd: 29451,
    liquidityUsd: 11288.88,
    volume24hUsd: 32528.42,
    priceChange24hPct: -18.04,
    dex: "pumpswap",
    pairAddress: "Hcjeg3iWFbrvR3FJvGZAnxKkEbDhuDZNtqdDSZnN899e",
    pairUrl: "https://dexscreener.com/solana/hcjeg3iwfbrvr3fjvgzanxkkebdhudzntqddsznn899e",
    pairCreatedAt: 1795051386000,
  });
});

test("picks the Solana pair of this coin with the most liquidity", () => {
  const json = {
    pairs: [
      pair({ pairAddress: "small", liquidity: { usd: 10 } }),
      pair({ pairAddress: "other-chain", chainId: "ethereum", liquidity: { usd: 1e9 } }),
      pair({ pairAddress: "quote-side", baseToken: { address: "So11111111111111111111111111111111111111112" }, liquidity: { usd: 1e9 } }),
      pair({ pairAddress: "big", liquidity: { usd: 5000 } }),
      pair({ pairAddress: "curve", dexId: "pumpfun", liquidity: undefined }),
    ],
  };
  assert.equal(parseDexPairs(json, MINT)?.market.pairAddress, "big");
});

test("a pump.fun curve pair without liquidity says unknown, not zero", () => {
  const info = parseDexPairs([pair({ dexId: "pumpfun", liquidity: undefined })], MINT);
  assert.equal(info?.market.liquidityUsd, null);
  assert.equal(info?.market.marketCapUsd, 29451);
});

test("invalid numbers become null", () => {
  const info = parseDexPairs(
    [pair({ priceUsd: "abc", marketCap: -5, fdv: Infinity, liquidity: { usd: "NaN" }, volume: { h24: null }, priceChange: { h24: -150 }, pairCreatedAt: "x", url: "javascript:alert(1)", info: { imageUrl: "http://insecure" } })],
    MINT,
  );
  assert.ok(info);
  const m = info.market;
  assert.equal(m.priceUsd, null);
  assert.equal(m.marketCapUsd, null);
  assert.equal(m.fdvUsd, null);
  assert.equal(m.liquidityUsd, null);
  assert.equal(m.volume24hUsd, null);
  assert.equal(m.priceChange24hPct, null);
  assert.equal(m.pairCreatedAt, null);
  assert.equal(m.pairUrl, null);
  assert.equal(info.imageUrl, null);
});

test("not listed and junk answers", () => {
  assert.equal(parseDexPairs([], MINT), null);
  assert.equal(parseDexPairs(null, MINT), null);
  assert.equal(parseDexPairs({ pairs: null }, MINT), null);
  assert.equal(parseDexPairs([pair({ baseToken: { address: "someone-else" } })], MINT), null);
});

test("fetchDexToken never throws", async () => {
  const urls: string[] = [];
  const ok = await fetchDexToken(MINT, async (u) => {
    urls.push(u);
    return new Response(JSON.stringify([pair()]));
  });
  assert.equal(ok.status, "ok");
  assert.equal(urls[0], dexTokenUrl(MINT));
  assert.equal((await fetchDexToken(MINT, async () => new Response("[]"))).status, "not-listed");
  const bad = await fetchDexToken(MINT, async () => new Response("oops", { status: 500 }));
  assert.equal(bad.status, "error");
  assert.equal((await fetchDexToken(MINT, async () => new Response("not json"))).status, "error");
  assert.equal(
    (
      await fetchDexToken(MINT, async () => {
        throw new Error("down");
      })
    ).status,
    "error",
  );
  const slow = await fetchDexToken(
    MINT,
    (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    20,
  );
  assert.deepEqual(slow, { status: "error", info: null, reason: "DEX Screener timed out" });
});

test("names lose invisible characters that could disguise them (the fee-sharing coin's real name has a zero-width space)", () => {
  const info = parseDexPairs([pair({ baseToken: { address: MINT, name: "The Odyssean Hip​po", symbol: "‮Pablo⁦" } })], MINT);
  assert.equal(info?.name, "The Odyssean Hippo");
  assert.equal(info?.symbol, "Pablo");
  // Emoji keep their joiners; a name of only invisible characters is unknown, not "".
  assert.equal(parseDexPairs([pair({ baseToken: { address: MINT, name: "👨‍👩‍👧 fam", symbol: "​﻿" } })], MINT)?.name, "👨‍👩‍👧 fam");
  assert.equal(parseDexPairs([pair({ baseToken: { address: MINT, name: "x", symbol: "​﻿" } })], MINT)?.symbol, null);
  // Length limits count characters, never cutting an emoji in half.
  assert.equal(parseDexPairs([pair({ baseToken: { address: MINT, name: "🚀".repeat(100), symbol: "R" } })], MINT)?.name, "🚀".repeat(80));
});
