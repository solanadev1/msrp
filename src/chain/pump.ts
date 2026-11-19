/**
 * pump.fun bonding curve: address, account decoder and progress.
 * Layout (after the 8-byte tag): five u64 LE reserves, a completion flag, the 32-byte creator.
 */
import { PROGRAMS } from "../config";
import { decodeAddress, encodeBase58 } from "./base58";
import { base64ToBytes, readU64LE, startsWith } from "./bytes";
import { PUMP_CURVE_DISCRIMINATOR, PUMP_INITIAL_REAL_TOKEN_RESERVES } from "./constants";
import { findProgramAddress } from "./pda";

export interface PumpCurve {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  /** Deployer wallet recorded by pump.fun (null if the account predates the creator field). */
  creator: string | null;
}

const SYSTEM_ADDRESS = "11111111111111111111111111111111";

/** The pump.fun bonding-curve address for a mint (PDA of ["bonding-curve", mint]). Null for a bad mint. */
export function bondingCurveAddress(mint: string): string | null {
  const mintBytes = decodeAddress(mint);
  if (!mintBytes) return null;
  return findProgramAddress(["bonding-curve", mintBytes], PROGRAMS.PUMP).address;
}

/** Decode a bonding-curve account. Returns null (never throws) when the bytes are not a curve. */
export function decodeBondingCurve(data: Uint8Array | null | undefined): PumpCurve | null {
  if (!data || data.length < 49 || !startsWith(data, PUMP_CURVE_DISCRIMINATOR)) return null;
  const flag = data[48];
  if (flag !== 0 && flag !== 1) return null;
  let creator: string | null = null;
  if (data.length >= 81) {
    const text = encodeBase58(data.subarray(49, 81));
    creator = text === SYSTEM_ADDRESS ? null : text;
  }
  const curve: PumpCurve = {
    virtualTokenReserves: readU64LE(data, 8),
    virtualSolReserves: readU64LE(data, 16),
    realTokenReserves: readU64LE(data, 24),
    realSolReserves: readU64LE(data, 32),
    tokenTotalSupply: readU64LE(data, 40),
    complete: flag === 1,
    creator,
  };
  return curve;
}

/** Decode from an RPC account `data` field: ["<base64>", "base64"] or a bare base64 string. */
export function decodeBondingCurveAccount(data: unknown): PumpCurve | null {
  const text = Array.isArray(data) ? data[0] : data;
  if (typeof text !== "string") return null;
  return decodeBondingCurve(base64ToBytes(text));
}

/**
 * 0-100: how far through the curve. pump.fun: 1 - realTokenReserves / initialRealTokenReserves.
 * A completed curve is 100.
 */
export function curveProgressPct(curve: PumpCurve, initial: bigint = PUMP_INITIAL_REAL_TOKEN_RESERVES): number {
  if (curve.complete) return 100;
  if (initial <= 0n) return 0;
  const sold = Number(initial - curve.realTokenReserves) / Number(initial);
  const pct = sold * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}
