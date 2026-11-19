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

/** Decode base58 text. Returns null if the text contains a character outside the alphabet. */
export function decodeBase58(text: string): Uint8Array | null {
  if (typeof text !== "string") return null;
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  // Bytes, least significant first.
  const bytes: number[] = [];
  for (let i = zeros; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? (INDEX[code] ?? -1) : -1;
    if (value < 0) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += (bytes[j] ?? 0) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i] ?? 0;
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
