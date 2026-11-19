import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_DIR } from "./helpers/replay";
import {
  findFunding,
  isBatchPayout,
  isPlainTransferTx,
  mintTrades,
  mintsSoldBy,
  parseMintInit,
  parsePumpCreate,
  pumpEvents,
  solMoves,
  solSent,
  solTransfers,
  tokenDeltaByOwner,
  tokensSentBy,
  txBasics,
  walletTrade,
} from "../src/chain/parse";
import { tokenTransfersFrom } from "../src/chain/collect";
import { COLLECT } from "../src/chain/constants";

// Real mainnet transactions (getTransaction, jsonParsed, version 1), see tests/fixtures/README.md.
const TX = JSON.parse(readFileSync(join(FIXTURE_DIR, "tx-samples.json"), "utf8")) as Record<string, unknown>;
const tx = (name: string) => {
  const t = TX[name];
  assert.ok(t, `sample ${name} missing`);
  return t;
};

const EDFFF = "EDFFFXFW8hQ3hSrGswUaxxeZzLHWP3iVmiCfJyGjpump";
const EDFFF_DEPLOYER = "Et1fXddAXcMPfhqNvXakqhnQt4nwNnMwicuh8zJG6wzv";
const EDFFF_CURVE = "3Nx96x3fTCuJhQux8J8MdehAdm11YVK4FcXP7Fi8b7ne";
const LUCIA = "3ZhsX6y2aEYoiwRFCu7mtwuMWSFH654dhyR2aGRVpump";
const LUCIA_DEPLOYER = "BvbAXpW8GQoxCUAooG3H816MRSh4UBvvFP7cjKFqvzsm";
const LUCIA_FUNDER = "AZyfCKACS3nxzeBYLfXF2PKk6FbztboAqXWgCfKmeVvb";

test("txBasics reads signature, slot, time, signers and success", () => {
  const b = txBasics(tx("createV2WithDevBuy"));
  assert.ok(b);
  assert.equal(b.signature, "4RqUNGNApW9LWKuAsVCMXgfxiRkgmjDLazzgWWdPndEnTVLEonPCYsX59u3D6gsoGr5357Rb8QeJ8Dz9bkD232i1");
  assert.equal(b.slot, 471145053);
  assert.equal(b.blockTime, 1795050281000);
  assert.equal(b.ok, true);
  assert.equal(b.feePayer, EDFFF_DEPLOYER);
  assert.deepEqual(b.signers, [EDFFF_DEPLOYER, EDFFF]);
  assert.equal(txBasics(tx("failedBuy"))?.ok, false);
});

test("pump.fun CreateV2 with a dev buy in the same transaction", () => {
  const c = parsePumpCreate(tx("createV2WithDevBuy"));
  assert.ok(c);
  assert.equal(c.mint, EDFFF);
  assert.equal(c.deployer, EDFFF_DEPLOYER);
  assert.equal(c.name, "The Odyssean Hip​po");
  assert.equal(c.symbol, "Pablo");
  assert.equal(c.devBuySol, 3.5);
  assert.equal(c.devBuyTokens, 112104477.61194);
  assert.equal(c.slot, 471145053);
  assert.equal(c.createdAt, 1795050281000);
  assert.equal(parseMintInit(tx("createV2WithDevBuy"), EDFFF)?.payer, EDFFF_DEPLOYER);
  assert.equal(parseMintInit(tx("createV2WithDevBuy"), LUCIA), null);
});

test("trades come from pump.fun's own trade events, one per wallet", () => {
  // One bundle transaction bought for two different wallets in the creation block.
  const trades = mintTrades(tx("bundleBuyTwoWallets"), EDFFF);
  assert.deepEqual(
    trades.map((t) => [t.wallet, t.side, t.sol, t.source]),
    [
      ["Am8qinvoJHR6AZ3mEiLYwe1mRPh24qidohQtxBN25EAM", "buy", 1, "pump-event"],
      ["FFhMpqcphMyWUuCbtfLC41Fczv83b1xLgdp6mtMsgKNa", "buy", 1, "pump-event"],
    ],
  );
  assert.equal(pumpEvents(tx("bundleBuyTwoWallets")).creates.length, 0);
  assert.equal(parsePumpCreate(tx("bundleBuyTwoWallets")), null);
  const dev = walletTrade(tx("createV2WithDevBuy"), EDFFF, EDFFF_DEPLOYER);
  assert.equal(dev?.side, "buy");
  assert.equal(dev?.sol, 3.5);
});

test("a router sell (pump.fun called through another program) is a dev sell", () => {
  const t = walletTrade(tx("routerSell"), EDFFF, EDFFF_DEPLOYER);
  assert.equal(t?.side, "sell");
  assert.ok((t?.sol ?? 0) > 0);
  assert.deepEqual(mintsSoldBy(tx("routerSell"), EDFFF_DEPLOYER), [EDFFF]);
});

test("token balance changes by owner", () => {
  const d = tokenDeltaByOwner(tx("createV2WithDevBuy"), EDFFF);
  assert.equal(d.get(EDFFF_DEPLOYER), 112104477.61194);
  assert.equal(d.get(EDFFF_CURVE), 887895522.38806);
});

test("SOL transfers and what the deployer paid", () => {
  const t = solTransfers(tx("createV2WithDevBuy"));
  assert.ok(t.some((x) => x.from === EDFFF_DEPLOYER && x.to === EDFFF_CURVE && x.sol === 3.54375 && !x.topLevel));
  assert.equal(solSent(tx("createV2WithDevBuy"), EDFFF_DEPLOYER, EDFFF_CURVE), 3.54375);
  assert.equal(isPlainTransferTx(tx("createV2WithDevBuy")), false);
  // The create is not a "funding" of the curve wallet-to-wallet.
  assert.equal(findFunding(tx("createV2WithDevBuy"), "nobody"), null);
});

test("failed transactions give nothing", () => {
  const f = tx("failedBuy");
  assert.deepEqual(mintTrades(f, EDFFF), []);
  assert.deepEqual(solTransfers(f), []);
  assert.equal(parsePumpCreate(f), null);
  assert.equal(findFunding(f, EDFFF_DEPLOYER), null);
});

test("malformed input never throws", () => {
  const junk: unknown[] = [null, undefined, 1, "x", [], {}, { meta: null }, { slot: 1, meta: {}, transaction: { signatures: [], message: { accountKeys: [] } } }, { slot: 1, meta: { err: null, logMessages: ["Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]", "Program data: !!!"] }, transaction: { signatures: ["s"], message: { accountKeys: ["a"], instructions: [{ programId: 5 }] } } }];
  for (const j of junk) {
    assert.doesNotThrow(() => {
      txBasics(j);
      parsePumpCreate(j);
      mintTrades(j, EDFFF);
      solMoves(j);
      findFunding(j, "a");
      mintsSoldBy(j, "a");
      isPlainTransferTx(j);
      parseMintInit(j, EDFFF);
    });
  }
});

test("launch factory: funding hidden in a temporary wrapped-SOL account", () => {
  // The master creates a throw-away account with 0.4375 SOL and closes it into the fresh deployer.
  const f = tx("fundingViaTempAccount");
  assert.equal(isPlainTransferTx(f), true);
  assert.equal(solTransfers(f).filter((t) => t.to === LUCIA_DEPLOYER).length, 0, "no direct System transfer");
  const funding = findFunding(f, LUCIA_DEPLOYER);
  assert.equal(funding?.funder, LUCIA_FUNDER);
  assert.equal(funding?.sol, 0.43749928);
});

test("launch factory: profits swept back to the master the same way", () => {
  assert.equal(solSent(tx("sweepViaTempAccount"), LUCIA_DEPLOYER, LUCIA_FUNDER), 13.408080545);
});

test("launch factory: create + dev buy, then a PumpSwap sell after graduation", () => {
  const c = parsePumpCreate(tx("luciaCreate"));
  assert.equal(c?.mint, LUCIA);
  assert.equal(c?.deployer, LUCIA_DEPLOYER);
  assert.ok((c?.devBuySol ?? 0) > 0.26);
  const sell = walletTrade(tx("pumpSwapSell"), LUCIA, LUCIA_DEPLOYER);
  assert.equal(sell?.side, "sell");
  assert.equal(sell?.source, "balances");
  assert.ok((sell?.sol ?? 0) > 13);
});

test("launch factory: the coin graduated in its creation block; the migration is not a trade", () => {
  const m = tx("luciaMigrateSameBlock");
  assert.equal(txBasics(m)?.slot, txBasics(tx("luciaCreate"))?.slot, "same block as the create");
  assert.equal(parsePumpCreate(m), null);
  assert.deepEqual(mintTrades(m, LUCIA), []);
  assert.equal(walletTrade(m, LUCIA, LUCIA_DEPLOYER), null);
});

test("launch factory: creator fees collected and forwarded to the master count as SOL sent back", () => {
  const fee = tx("creatorFeeForwardedToMaster");
  assert.equal(isPlainTransferTx(fee), false);
  assert.equal(solSent(fee, LUCIA_DEPLOYER, LUCIA_FUNDER), 39.096275651);
  assert.equal(walletTrade(fee, LUCIA, LUCIA_DEPLOYER), null, "collecting fees is not a sell");
  assert.equal(parsePumpCreate(fee), null);
});

test("address-poisoning dust (1 lamport to many wallets) is never a wallet's funding", () => {
  const dust = tx("dustPoisoning");
  assert.equal(findFunding(dust, LUCIA_DEPLOYER)?.sol, 1e-9, "it is a SOL move");
  assert.equal(findFunding(dust, LUCIA_DEPLOYER, 890_880), null, "but below the rent-exempt minimum");
  assert.equal(findFunding(tx("fundingViaTempAccount"), LUCIA_DEPLOYER, 890_880)?.funder, LUCIA_FUNDER);
});

test("launch factory: the dev sold most of its coins 81 seconds after launch", () => {
  const created = parsePumpCreate(tx("luciaCreate"));
  const sold = txBasics(tx("pumpSwapSell"));
  assert.ok(created?.createdAt && sold?.blockTime);
  assert.equal((sold.blockTime - created.createdAt) / 1000, 81);
  assert.deepEqual(mintsSoldBy(tx("pumpSwapSell"), LUCIA_DEPLOYER), [LUCIA]);
});

test("pump.fun events are decoded once per transaction, and callers can't change what the next one sees", () => {
  const t = tx("bundleBuyTwoWallets");
  const first = pumpEvents(t);
  assert.ok(first.trades.length >= 2);
  const before = JSON.stringify(first.trades.map((e) => ({ ...e, tokenAmountRaw: String(e.tokenAmountRaw) })));
  first.trades.length = 0; // a careless caller empties its copy
  const again = pumpEvents(t);
  assert.ok(again.trades.length >= 2, "the cached events are untouched");
  assert.equal(JSON.stringify(again.trades.map((e) => ({ ...e, tokenAmountRaw: String(e.tokenAmountRaw) }))), before);
  assert.ok(Object.isFrozen(again.trades[0]), "events themselves are read-only");
  // Same answers through the functions built on top (cache hit path).
  assert.deepEqual(mintTrades(t, EDFFF), mintTrades(structuredClone(t), EDFFF));
  assert.deepEqual(parsePumpCreate(tx("createV2WithDevBuy")), parsePumpCreate(structuredClone(tx("createV2WithDevBuy"))));
});

// ---------------------------------------------------------------------------
// Reviewer findings, Nov 19 2026 (real mainnet transactions)
// ---------------------------------------------------------------------------

const NSHM = "4NShmh1AkwX2PMA8KSJDbbp8ExLUuHXbYBmzRjNNpump";
const NSHM_CREATOR = "7mKkcvD9zbwaUdrVsSCPxQi1QSr8exUzsbnmcEuDzZG5";
const NSHM_BAG = "EMx7nCjqnDprUCpAhTBGBLcsKJ73t9EgT6m8LLKuTEMm";

test("a creator moving 600M of its own coins to another wallet is a plain transfer to that wallet (4NShmh...pump)", () => {
  const t = tx("creatorTokenTransfer");
  assert.deepEqual(tokensSentBy(t, NSHM, NSHM_CREATOR, COLLECT.TRANSFER_MAX_SOL_BACK), [{ to: NSHM_BAG, tokens: 600_000_000 }]);
  assert.equal(walletTrade(t, NSHM, NSHM_CREATOR), null, "not a sell");
  const facts = tokenTransfersFrom(NSHM_CREATOR, NSHM, [t, t]);
  assert.equal(facts.length, 1, "one entry per receiver and transaction");
  assert.equal(facts[0]?.to, NSHM_BAG);
  assert.equal(facts[0]?.tokenAmount, 600_000_000);
  assert.equal(facts[0]?.signature, "3HhMCFJX1fz3Nas3sTpTepcrVXcMLGPy11xqnDLGPshMJECY2EX921Z51F1Wfjtoyb61Sg9XskatgmqBgTizaLES");
  // Only out of the given wallet, only this coin.
  assert.deepEqual(tokensSentBy(t, NSHM, NSHM_BAG, COLLECT.TRANSFER_MAX_SOL_BACK), []);
  assert.deepEqual(tokensSentBy(t, LUCIA, NSHM_CREATOR, COLLECT.TRANSFER_MAX_SOL_BACK), []);
});

test("sells, swaps and fee collection are never 'tokens sent' by the deployer", () => {
  assert.deepEqual(tokensSentBy(tx("pumpSwapSell"), LUCIA, LUCIA_DEPLOYER, COLLECT.TRANSFER_MAX_SOL_BACK), [], "a sell");
  assert.deepEqual(tokensSentBy(tx("routerSell"), EDFFF, EDFFF_DEPLOYER, COLLECT.TRANSFER_MAX_SOL_BACK), []);
  assert.deepEqual(tokensSentBy(tx("creatorFeeForwardedToMaster"), LUCIA, LUCIA_DEPLOYER, COLLECT.TRANSFER_MAX_SOL_BACK), []);
  assert.deepEqual(tokensSentBy(tx("luciaCreate"), LUCIA, LUCIA_DEPLOYER, COLLECT.TRANSFER_MAX_SOL_BACK), [], "a buy");
});

test("an exchange-style batch withdrawal (durable nonce, 6 wallets paid at once) is recognised (5tzF...)", () => {
  const t = tx("exchangeBatchFunding");
  const exchange = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
  assert.equal(findFunding(t, "A98sX7ezz8UKFj7pjkok9QBd8KcPDSQmP44whPNFMfni", 890_880)?.funder, exchange);
  assert.equal(isBatchPayout(t, exchange, COLLECT.BATCH_PAYOUT_MIN_RECIPIENTS, 890_880), true);
  assert.equal(isBatchPayout(t, exchange, 7, 890_880), false, "it paid 6");
  // A launch factory funding its deployer through a temporary account is not an exchange batch.
  assert.equal(isBatchPayout(tx("fundingViaTempAccount"), LUCIA_FUNDER, COLLECT.BATCH_PAYOUT_MIN_RECIPIENTS, 890_880), false);
  assert.equal(isBatchPayout(tx("dustPoisoning"), "x", 1), false);
});
