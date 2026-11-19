/**
 * Program derived addresses (PDAs), computed exactly like Solana does:
 * sha256(seeds || bump || programId || "ProgramDerivedAddress"), keeping the first
 * result that is NOT a valid ed25519 point (so no private key can exist for it).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { decodeAddress, encodeBase58 } from "./base58";
import { concatBytes, utf8 } from "./bytes";
import { ATA_PROGRAM } from "./constants";

const PDA_MARKER = utf8("ProgramDerivedAddress");
const MAX_SEED_LENGTH = 32;
const MAX_SEEDS = 16;

/**
 * True when 32 bytes decode to a point on the ed25519 curve (an address that can have a
 * private key, i.e. a normal wallet). Mirrors Solana's curve25519-dalek check (lenient decoding).
 */
export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  try {
    ed25519.Point.fromBytes(bytes, true);
    return true;
  } catch {
    return false;
  }
}

/** True when the address is a PDA-style address (off the curve): owned by a program, not a person. */
export function isOffCurveAddress(address: string): boolean {
  const bytes = decodeAddress(address);
  return bytes !== null && !isOnCurve(bytes);
}

export type Seed = Uint8Array | string;
const seedBytes = (seed: Seed): Uint8Array => (typeof seed === "string" ? utf8(seed) : seed);

/** createProgramAddress: returns null when the hash lands on the curve (invalid PDA) or input is bad. */
export function createProgramAddress(seeds: Seed[], programId: string): string | null {
  const program = decodeAddress(programId);
  if (!program || seeds.length > MAX_SEEDS) return null;
  const parts: Uint8Array[] = [];
  for (const seed of seeds) {
    const bytes = seedBytes(seed);
    if (bytes.length > MAX_SEED_LENGTH) return null;
    parts.push(bytes);
  }
  parts.push(program, PDA_MARKER);
  const hash = sha256(concatBytes(parts));
  return isOnCurve(hash) ? null : encodeBase58(hash);
}

/** findProgramAddress: tries bump 255 down to 0 and returns the first valid PDA. */
export function findProgramAddress(seeds: Seed[], programId: string): { address: string; bump: number } {
  for (let bump = 255; bump >= 0; bump--) {
    const address = createProgramAddress([...seeds, Uint8Array.of(bump)], programId);
    if (address) return { address, bump };
  }
  throw new Error("Unable to find a program address for these seeds");
}

/** Associated token account of `owner` for `mint` under `tokenProgram` (SPL Token or Token-2022). */
export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string): string | null {
  const o = decodeAddress(owner);
  const m = decodeAddress(mint);
  const t = decodeAddress(tokenProgram);
  if (!o || !m || !t) return null;
  return findProgramAddress([o, t, m], ATA_PROGRAM).address;
}
