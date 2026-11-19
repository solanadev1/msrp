/**
 * Turning failures into HTTP answers and safe log lines.
 *
 * Errors are matched by `error.name` (a string) so this file doesn't import src/chain.
 * Messages shown to visitors are fixed sentences written here, never the raw error text,
 * so nothing internal (like the RPC address, which can contain a key) can leak.
 */

export type ErrorCode =
  | "invalid_mint"
  | "not_found"
  | "rate_limited"
  | "daily_limit"
  | "chain_unavailable"
  | "internal"
  | "method_not_allowed"
  | "no_route";

export interface PublicError {
  status: number;
  code: ErrorCode;
  /** Short page title. */
  title: string;
  /** One or two plain sentences for the visitor. */
  message: string;
  /** Seconds before trying again makes sense (Retry-After). */
  retryAfterSec: number | null;
}

/** Seconds to wait after a Solana network failure before retrying. */
export const CHAIN_RETRY_AFTER_SEC = 30;

/** Thrown by the app when a visitor (or the whole site) is over a limit for new stickers. */
export class RateLimitedError extends Error {
  constructor(
    readonly scope: "ip" | "daily",
    readonly retryAfterSec: number,
  ) {
    super(scope === "ip" ? "per-visitor limit for new stickers reached" : "site-wide daily limit for new stickers reached");
    this.name = "RateLimitedError";
  }
}

export const MESSAGES = {
  invalidMint:
    "That doesn't look like a Solana coin address. A coin address is 32 to 44 letters and numbers, " +
    "like the one at the end of a pump.fun or DEX Screener link. Please check it and try again.",
  notFound: "No coin exists at that address on Solana. It may be a wallet, or the address may have a typo.",
  rateLimited:
    "You've asked for a lot of new stickers in the last hour. Stickers that were already printed still open instantly. " +
    "Please try again a little later.",
  dailyLimit:
    "MSRP has printed as many new stickers as it can today. Stickers that were already printed still open. " +
    "New ones will be available again after midnight UTC.",
  chainUnavailable: "The Solana network didn't answer in time. Please try again in a minute.",
  internal: "Something went wrong on our side. Please try again in a minute.",
} as const;

/** Map any thrown value to what the visitor sees. */
export function publicError(error: unknown): PublicError {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "InvalidMintError":
      return invalidMintError();
    case "NotFoundError":
      return { status: 404, code: "not_found", title: "No coin at this address", message: MESSAGES.notFound, retryAfterSec: null };
    case "RateLimitedError": {
      const e = error as RateLimitedError;
      const wait = Math.max(1, Math.ceil(Number(e.retryAfterSec) || 60));
      return e.scope === "daily"
        ? { status: 429, code: "daily_limit", title: "Daily limit reached", message: MESSAGES.dailyLimit, retryAfterSec: wait }
        : { status: 429, code: "rate_limited", title: "Too many new stickers", message: MESSAGES.rateLimited, retryAfterSec: wait };
    }
    case "BudgetExceededError":
    case "ChainUnavailableError":
    case "RpcTransportError":
    case "RpcError":
      return {
        status: 503,
        code: "chain_unavailable",
        title: "Solana is busy",
        message: MESSAGES.chainUnavailable,
        retryAfterSec: CHAIN_RETRY_AFTER_SEC,
      };
    default:
      return { status: 500, code: "internal", title: "Something went wrong", message: MESSAGES.internal, retryAfterSec: null };
  }
}

/** The answer for an address that isn't a valid Solana address. */
export function invalidMintError(): PublicError {
  return { status: 400, code: "invalid_mint", title: "Not a coin address", message: MESSAGES.invalidMint, retryAfterSec: null };
}

/** True for failures that are normal visitor outcomes, not bugs (no need to log them as errors). */
export function isExpectedError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "InvalidMintError" || name === "NotFoundError" || name === "RateLimitedError";
}

/** "Name: message" with any URL removed (RPC URLs can carry an API key) and a length cap. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const message = scrub(error.message ?? "");
    return `${error.name || "Error"}${message ? `: ${message}` : ""}`;
  }
  return typeof error === "string" ? scrub(error) : typeof error;
}

export function scrub(text: string): string {
  return String(text)
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, "[url]")
    .replace(/(api[-_]?key|token|secret|auth)=[^\s&"']+/gi, "$1=[hidden]")
    .slice(0, 240);
}
