import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAddress, decodeBase58, encodeBase58, isValidAddress } from "../src/chain/base58";
import { base64ToBytes, bytesToBase64, readU64LE } from "../src/chain/bytes";
import { associatedTokenAddress, createProgramAddress, findProgramAddress, isOffCurveAddress, isOnCurve } from "../src/chain/pda";
import { PROGRAMS } from "../src/config";
import { KNOWN_POOL_AUTHORITIES, METAPLEX_METADATA_PROGRAM, PUMP_MAYHEM_PROGRAM } from "../src/chain/constants";

// Real addresses seen on mainnet (Nov 2026). See tests/fixtures/README.md.
const MINT = "EDFFFXFW8hQ3hSrGswUaxxeZzLHWP3iVmiCfJyGjpump";
const CURVE = "3Nx96x3fTCuJhQux8J8MdehAdm11YVK4FcXP7Fi8b7ne"; // DEX Screener's pump.fun pair = this curve account
const DEPLOYER = "Et1fXddAXcMPfhqNvXakqhnQt4nwNnMwicuh8zJG6wzv";
const DEPLOYER_ATA = "ABmFWkmtQdEdMGts5HqN17H6Qwtho3CBDJtkuYwsid6q"; // created in the coin's CreateV2 transaction
const MAYHEM_STATE = "97KgebLBmPVrtSbNhxZ7eHSi7TKG3TmubgL9TY1Yq4oP"; // only signature on chain = the creation

test("base58: known values", () => {
  assert.deepEqual(decodeBase58("11111111111111111111111111111111"), new Uint8Array(32));
  assert.equal(encodeBase58(new Uint8Array(32)), "11111111111111111111111111111111");
  assert.equal(encodeBase58(Uint8Array.of(0, 0, 1)), "112");
  assert.deepEqual(decodeBase58("112"), Uint8Array.of(0, 0, 1));
  assert.equal(encodeBase58(new TextEncoder().encode("hello world")), "StV1DL6CwTryKyV");
  assert.deepEqual(decodeBase58(""), new Uint8Array(0));
});

test("base58: rejects characters outside the alphabet", () => {
  for (const bad of ["0abc", "Oabc", "Iabc", "labc", "ab c", "abc!", "é"]) assert.equal(decodeBase58(bad), null, bad);
});

test("base58: round trip of random bytes", () => {
  for (let n = 0; n < 200; n++) {
    const len = n % 70;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = (n * 31 + i * 17) & 0xff;
    if (len > 2 && n % 3 === 0) bytes[0] = 0;
    assert.deepEqual(decodeBase58(encodeBase58(bytes)), bytes);
  }
});

test("addresses: 32-byte validation", () => {
  assert.equal(isValidAddress(MINT), true);
  assert.equal(isValidAddress(PROGRAMS.SYSTEM), true);
  assert.equal(isValidAddress("abc"), false);
  assert.equal(isValidAddress(MINT + "1"), false);
  assert.equal(isValidAddress(`${MINT.slice(0, -1)}0`), false);
  assert.equal(isValidAddress(123), false);
  assert.equal(isValidAddress(undefined), false);
  // A 64-byte signature is valid base58 but not an address.
  assert.equal(decodeAddress("4RqUNGNApW9LWKuAsVCMXgfxiRkgmjDLazzgWWdPndEnTVLEonPCYsX59u3D6gsoGr5357Rb8QeJ8Dz9bkD232i1"), null);
});

test("base64 helpers", () => {
  assert.deepEqual(base64ToBytes("AQID"), Uint8Array.of(1, 2, 3));
  assert.equal(bytesToBase64(Uint8Array.of(1, 2, 3)), "AQID");
  assert.equal(base64ToBytes("not base64!"), null);
  assert.equal(readU64LE(Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 1), 0), 72057594037927937n);
});

test("pda: pump.fun bonding curve matches the real on-chain account", () => {
  const { address } = findProgramAddress(["bonding-curve", decodeAddress(MINT) as Uint8Array], PROGRAMS.PUMP);
  assert.equal(address, CURVE);
});

test("pda: pool authorities and per-coin accounts match mainnet", () => {
  assert.equal(findProgramAddress(["amm authority"], PROGRAMS.RAYDIUM_V4).address, "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1");
  assert.equal(findProgramAddress(["vault_and_lp_mint_auth_seed"], PROGRAMS.RAYDIUM_CPMM).address, "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL");
  for (const a of KNOWN_POOL_AUTHORITIES) assert.ok(isOffCurveAddress(a));
  assert.equal(findProgramAddress(["mayhem-state", decodeAddress(MINT) as Uint8Array], PUMP_MAYHEM_PROGRAM).address, MAYHEM_STATE);
  assert.equal(associatedTokenAddress(DEPLOYER, MINT, PROGRAMS.TOKEN_2022), DEPLOYER_ATA);
  const meta = findProgramAddress(["metadata", decodeAddress(METAPLEX_METADATA_PROGRAM) as Uint8Array, decodeAddress(MINT) as Uint8Array], METAPLEX_METADATA_PROGRAM);
  assert.equal(meta.address, "4Ammumfy1nRMEpqxa4fkUYdUrfsLUDvZVTe324XYDUTP");
});

test("pda: wallets are on the curve, PDAs are not", () => {
  assert.equal(isOnCurve(decodeAddress(DEPLOYER) as Uint8Array), true);
  assert.equal(isOffCurveAddress(DEPLOYER), false);
  assert.equal(isOffCurveAddress(CURVE), true);
  assert.equal(isOffCurveAddress("not an address"), false);
  assert.equal(isOnCurve(new Uint8Array(31)), false);
});

test("pda: createProgramAddress refuses bad input", () => {
  assert.equal(createProgramAddress([new Uint8Array(33)], PROGRAMS.PUMP), null);
  assert.equal(createProgramAddress(["x"], "bad"), null);
  assert.equal(associatedTokenAddress("bad", MINT, PROGRAMS.TOKEN), null);
});
