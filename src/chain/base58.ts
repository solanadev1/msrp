/**
 * Base58 (Bitcoin alphabet), the text form of Solana addresses and signatures.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) INDEX[ALPHABET.charCodeAt(i)] = i;

export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  // Base-58 digits, least significant first.
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i] ?? 0;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] ?? 0) << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i] ?? 0];
  return out;
}

const LIMB = 16_777_216; // 2^24

/**
 * Decode base58 text. Returns null if the text contains a character outside the alphabet.
 * Works on 24-bit limbs, four digits at a time (58^4 < 2^24, and limb * 58^4 stays far below 2^53):
 * about 12 times fewer steps than one digit and one byte at a time. pump.fun event data is ~300
 * characters, read for every transaction, and a Worker has little CPU.
 */
export function decodeBase58(text: string): Uint8Array | null {
  if (typeof text !== "string") return null;
  const n = text.length;
  let zeros = 0;
  while (zeros < n && text.charCodeAt(zeros) === 49 /* "1" */) zeros++;
  // The number as 24-bit limbs, least significant first.
  const limbs: number[] = [];
  let i = zeros;
  while (i < n) {
    let chunk = 0;
    let mult = 1;
    const end = Math.min(i + 4, n);
    for (; i < end; i++) {
      const code = text.charCodeAt(i);
      const value = code < 128 ? (INDEX[code] ?? -1) : -1;
      if (value < 0) return null;
      chunk = chunk * 58 + value;
      mult *= 58;
    }
    let carry = chunk;
    for (let j = 0; j < limbs.length; j++) {
      const x = (limbs[j] ?? 0) * mult + carry;
      carry = Math.floor(x / LIMB);
      limbs[j] = x - carry * LIMB;
    }
    while (carry > 0) {
      limbs.push(carry % LIMB);
      carry = Math.floor(carry / LIMB);
    }
  }
  // Limbs to bytes (least significant first), then drop the number's leading zero bytes.
  const body: number[] = [];
  for (const limb of limbs) body.push(limb & 0xff, (limb >>> 8) & 0xff, (limb >>> 16) & 0xff);
  while (body.length > 0 && body[body.length - 1] === 0) body.pop();
  const out = new Uint8Array(zeros + body.length);
  for (let k = 0; k < body.length; k++) out[zeros + k] = body[body.length - 1 - k] ?? 0;
  return out;
}

/** Decode a Solana address (32 bytes). Returns null when it is not one. */
export function decodeAddress(text: string): Uint8Array | null {
  if (typeof text !== "string" || text.length < 32 || text.length > 44) return null;
  const bytes = decodeBase58(text);
  return bytes && bytes.length === 32 ? bytes : null;
}

/** True when `text` is a well-formed 32-byte Solana address (wallet, mint, program or PDA). */
export function isValidAddress(text: unknown): text is string {
  return typeof text === "string" && decodeAddress(text) !== null;
}
