import { test } from "node:test";
import assert from "node:assert/strict";
import { base64ToBytes } from "../src/chain/bytes";
import { bondingCurveAddress, curveProgressPct, decodeBondingCurve, decodeBondingCurveAccount } from "../src/chain/pump";

// Real curve account of EDFFF...pump read from mainnet on Nov 19 2026 (166 bytes, newer layout).
const REAL_CURVE =
  "F7f4N2DYrGBLpNGI4CMCADVNEHEMAAAASwy/PE8lAQA1oex0BQAAAACAxqR+jQMAAIsdLT92+/6wuz596QojkD0J2FO//lkw+X9Fpd8H5lpVAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgLzYSAAAAAHnK1RwAAAAAAACsI/wGAAAAAAAAAAAAAAAAAAAAAAAAAA==";

test("decode a real pump.fun curve account", () => {
  const c = decodeBondingCurveAccount([REAL_CURVE, "base64"]);
  assert.ok(c);
  assert.equal(c.virtualTokenReserves, 602397228508235n);
  assert.equal(c.virtualSolReserves, 53436501301n);
  assert.equal(c.realTokenReserves, 322497228508235n);
  assert.equal(c.realSolReserves, 23436501301n);
  assert.equal(c.tokenTotalSupply, 1000000000000000n);
  assert.equal(c.complete, false);
  // The creator field here is a fee-sharing account (a PDA), not a wallet: kept as-is.
  assert.equal(c.creator, "AN3UVieRKvEJE2mtwXFMHuVb6rb5mKpEyitXgqHYs4Ck");
  assert.equal(curveProgressPct(c), 59.34);
});

test("progress: start, clamp and graduation", () => {
  const bytes = base64ToBytes(REAL_CURVE) as Uint8Array;
  const c = decodeBondingCurve(bytes);
  assert.ok(c);
  assert.equal(curveProgressPct({ ...c, realTokenReserves: 793_100_000_000_000n }), 0);
  assert.equal(curveProgressPct({ ...c, realTokenReserves: 900_000_000_000_000n }), 0);
  assert.equal(curveProgressPct({ ...c, realTokenReserves: 0n }), 100);
  assert.equal(curveProgressPct({ ...c, complete: true, realTokenReserves: 793_100_000_000_000n }), 100);
});

test("decoder refuses anything that is not a curve", () => {
  const bytes = base64ToBytes(REAL_CURVE) as Uint8Array;
  const wrongTag = bytes.slice();
  wrongTag[0] = 0;
  assert.equal(decodeBondingCurve(wrongTag), null);
  assert.equal(decodeBondingCurve(bytes.slice(0, 40)), null);
  const badFlag = bytes.slice();
  badFlag[48] = 7;
  assert.equal(decodeBondingCurve(badFlag), null);
  assert.equal(decodeBondingCurve(null), null);
  assert.equal(decodeBondingCurveAccount(42), null);
  assert.equal(decodeBondingCurveAccount(["%%%", "base64"]), null);
  // Old 81-byte layout without creator bytes beyond 49 still decodes reserves; zero creator -> null.
  const old = bytes.slice(0, 81);
  old.fill(0, 49, 81);
  assert.equal(decodeBondingCurve(old)?.creator, null);
});

test("curve address for a bad mint is null", () => {
  assert.equal(bondingCurveAddress("nope"), null);
  assert.equal(bondingCurveAddress("EDFFFXFW8hQ3hSrGswUaxxeZzLHWP3iVmiCfJyGjpump"), "3Nx96x3fTCuJhQux8J8MdehAdm11YVK4FcXP7Fi8b7ne");
});
