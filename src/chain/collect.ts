/**
 * collectFacts: gather every fact a sticker needs, read-only, within a request budget and a deadline.
 *
 * How it stays inside the budget: every Solana read goes through a small "loader" that collects all
 * calls the independent steps ask for at the same moment and sends them as ONE batched HTTP request.
 * Identical calls are made once. When the budget or the time runs out, the remaining calls are
 * refused, each step notes what it could not see, and we return the facts we have.
 *
 * Steps (they run side by side; the loader merges their calls):
 *   coin      - mint account, pump.fun curve, DEX Screener
 *   creation  - creation transaction (via per-coin marker accounts, else paging the coin's history)
 *   holders   - largest token accounts -> owners -> what each owner is -> where wallets got their SOL
 *   early     - buys in the creation block or the next one (bundles)
 *   factory   - deployer's funder -> other wallets it funded -> their launches, dev sells, SOL sent back
 */
import { LIMITS, PROGRAMS, THRESHOLDS } from "../config";
import type {
  AnalyzeOptions,
  CoinFacts,
  CollectedFacts,
  EarlyBuyFact,
  FactoryFacts,
  HolderFact,
  HolderKind,
  LaunchFact,
  MarketFacts,
  RpcClient,
  SiblingFact,
  TokenTransferFact,
  WalletOrigin,
} from "../types";
import { decodeAddress, encodeBase58, isValidAddress } from "./base58";
import { base64ToBytes } from "./bytes";
import {
  COLLECT,
  EXTRA_AMM_PROGRAMS,
  JITO_TIP_ACCOUNTS,
  KNOWN_POOL_AUTHORITIES,
  METAPLEX_METADATA_PROGRAM,
  PUMP_MAYHEM_PROGRAM,
  TX_OPTIONS,
} from "./constants";
import { cleanText, fetchDexToken, type DexResult } from "./dex";
import { associatedTokenAddress, findProgramAddress, isOffCurveAddress } from "./pda";
import {
  findFunding,
  isBatchPayout,
  isPlainTransferTx,
  parseMintInit,
  parsePumpCreate,
  solSent,
  solMoves,
  tokensSentBy,
  txBasics,
  walletTrade,
  mintTrades,
} from "./parse";
import { bondingCurveAddress, curveProgressPct, decodeBondingCurveAccount, type PumpCurve } from "./pump";
import { BudgetExceededError, RpcError, RpcTransportError } from "./rpc";

// ---------------------------------------------------------------------------
// Errors (the only things collectFacts throws)
// ---------------------------------------------------------------------------

export class InvalidMintError extends Error {
  constructor(message = "That is not a valid Solana token address.") {
    super(message);
    this.name = "InvalidMintError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "No token exists at that address.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ChainUnavailableError extends Error {
  constructor(message = "The Solana network could not be reached. Please try again in a minute.") {
    super(message);
    this.name = "ChainUnavailableError";
  }
}

class DeadlineError extends Error {
  constructor() {
    super("time limit reached");
    this.name = "DeadlineError";
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export interface SigInfo {
  signature: string;
  slot: number;
  /** Unix ms or null. */
  blockTime: number | null;
  ok: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse a getSignaturesForAddress result (newest first). Null if the shape is wrong. */
export function parseSignatures(value: unknown): SigInfo[] | null {
  if (!Array.isArray(value)) return null;
  const out: SigInfo[] = [];
  for (const r of value) {
    if (!isObj(r) || typeof r.signature !== "string" || typeof r.slot !== "number") continue;
    out.push({
      signature: r.signature,
      slot: r.slot,
      blockTime: typeof r.blockTime === "number" ? r.blockTime * 1000 : null,
      ok: r.err === null || r.err === undefined,
    });
  }
  return out;
}

/** Stable JSON (sorted object keys): used to key identical calls. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObj(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Timing knobs for collectFacts (tests shorten the pauses; production uses COLLECT's values). */
export interface CollectTuning {
  /** Pause after the provider refuses a method for being too fast (COLLECT.RETRY_DELAY_MS). */
  retryDelayMs?: number;
  /** Pause before resending a call whose request timed out (COLLECT.TIMEOUT_RETRY_DELAY_MS). */
  timeoutRetryDelayMs?: number;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: Error };
async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** "a", "a and b", "a, b and c". */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// The loader: merges calls made at the same moment into one batched request
// ---------------------------------------------------------------------------

interface PendingAccount {
  address: string;
  priority: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Account reads are merged into one getMultipleAccounts per round (max keys the RPC accepts). */
const MAX_ACCOUNTS_PER_CALL = 100;
const ACCOUNT_OPTIONS = { encoding: "jsonParsed", commitment: "confirmed" } as const;

interface Pending {
  method: string;
  params: unknown[];
  priority: number;
  isolate: boolean;
  /** True once this call has been sent again after a refusal or timeout (it is never sent a third time). */
  retried?: boolean;
  /** Why the first attempt failed (given to the step if the retry cannot be sent). */
  firstError?: Error;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Worth one more try, later and in a smaller batch: the provider refused this one call for being too
 * fast (JSON-RPC error 429 inside a batch answer), or the whole request timed out. Not: other errors,
 * "method switched off" refusals (isolated calls are never retried), answers that were too large.
 */
export function isRetryable(error: unknown): boolean {
  return isRateLimited(error) || (error instanceof RpcTransportError && error.reason === "timeout");
}

/** The provider refused the call for being too fast (per-call 429, or an HTTP 429 for the whole request). */
export function isRateLimited(error: unknown): boolean {
  if (error instanceof RpcError) return error.code === 429 || error.code === -32429 || /too many requests/i.test(error.message);
  return error instanceof RpcTransportError && error.reason === "http" && error.status === 429;
}

/** Priorities: higher is sent first when the budget is tight. */
const P = { CORE: 3, HOLDERS: 2, ORIGIN: 2, EARLY: 1, DEPLOYER: 1, FAMILY: 0, SIBLING_TX: -1 } as const;

class Loader {
  private queue: Pending[] = [];
  private accountQueue: PendingAccount[] = [];
  private accountCache = new Map<string, Promise<unknown>>();
  private cache = new Map<string, Promise<unknown>>();
  private scheduled = false;
  budgetHit = false;
  deadlineHit = false;

  constructor(
    private readonly rpc: RpcClient,
    private readonly left: () => number,
    private readonly timeLeft: () => number,
    private readonly tuning: Required<CollectTuning> = { retryDelayMs: COLLECT.RETRY_DELAY_MS, timeoutRetryDelayMs: COLLECT.TIMEOUT_RETRY_DELAY_MS },
  ) {}

  /**
   * Read one account (jsonParsed). All account reads asked for in the same round become ONE
   * getMultipleAccounts call (some providers refuse several account calls in one batch).
   * Resolves to the account object, or null when the account does not exist.
   */
  account(address: string, priority = 0): Promise<unknown> {
    const cached = this.accountCache.get(address);
    if (cached) return cached;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.accountQueue.push({ address, priority, resolve, reject });
    });
    promise.catch(() => undefined);
    this.accountCache.set(address, promise);
    this.schedule();
    return promise;
  }

  private schedule() {
    if (!this.scheduled) {
      this.scheduled = true;
      // Wait until every step that is ready has asked for what it needs, then send one batch.
      setTimeout(() => void this.flush(), 0);
    }
  }

  load<T>(method: string, params: unknown[], options: { priority?: number; isolate?: boolean } = {}): Promise<T> {
    const key = `${method} ${stableStringify(params)}`;
    const cached = this.cache.get(key);
    if (cached) return cached as Promise<T>;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.queue.push({ method, params, priority: options.priority ?? 0, isolate: options.isolate ?? false, resolve, reject });
    });
    promise.catch(() => undefined); // speculative calls may never be awaited
    this.cache.set(key, promise);
    this.schedule();
    return promise as Promise<T>;
  }

  /** Turn queued account reads into getMultipleAccounts calls in the main queue. */
  private drainAccounts() {
    const accounts = this.accountQueue.splice(0);
    accounts.sort((a, b) => b.priority - a.priority);
    for (let i = 0; i < accounts.length; i += MAX_ACCOUNTS_PER_CALL) {
      const group = accounts.slice(i, i + MAX_ACCOUNTS_PER_CALL);
      this.queue.push({
        method: "getMultipleAccounts",
        params: [group.map((a) => a.address), ACCOUNT_OPTIONS],
        priority: Math.max(...group.map((a) => a.priority)),
        isolate: false,
        resolve: (value) => {
          const list = isObj(value) && Array.isArray(value.value) ? value.value : null;
          group.forEach((a, j) => {
            if (!list) a.reject(new Error("unreadable account list"));
            else {
              const v = list[j];
              a.resolve(v === undefined ? null : v);
            }
          });
        },
        reject: (error) => group.forEach((a) => a.reject(error)),
      });
    }
  }

  /** Calls sent a second time, and the requests that took (capped by COLLECT.RETRY_MAX_REQUESTS). */
  retries = 0;
  retryRequests = 0;
  /** Methods the provider refused again on retry: its limit window is used up, so stop retrying them. */
  private saturated = new Set<string>();
  /** True when the provider turned some calls away for being too fast (for the coverage note). */
  rateLimited = false;
  /**
   * Methods the provider refused for being too fast, and the deadline-clock time left when that
   * pause began. While a method pauses, its calls (new ones and retries) wait here instead of being
   * sent and refused again (refused calls count against the provider's limit too).
   */
  private cooling = new Map<string, number>();
  private held: Pending[] = [];
  /**
   * Methods refused at least once, and how many more calls of each may go out before the provider's
   * window is used up again (COLLECT.RETRY_BATCH per window, a little under its limit of about 10).
   */
  private allowance = new Map<string, number>();

  /** Milliseconds until `method` may be asked again (0 when it is not paused). */
  private pauseLeft(method: string): number {
    const startedAt = this.cooling.get(method);
    if (startedAt === undefined) return 0;
    return Math.max(0, this.tuning.retryDelayMs - (startedAt - this.timeLeft()));
  }

  /** Pause `method` for the provider's limit window, then send what waited. */
  private pause(method: string): void {
    if (this.cooling.has(method)) return;
    this.cooling.set(method, this.timeLeft());
    this.allowance.set(method, 0);
    setTimeout(() => {
      this.cooling.delete(method);
      this.allowance.set(method, COLLECT.RETRY_BATCH);
      const ready = this.held.filter((p) => p.method === method);
      if (ready.length === 0) return;
      this.held = this.held.filter((p) => p.method !== method);
      this.queue.push(...ready);
      this.schedule();
    }, this.tuning.retryDelayMs);
  }

  /** True when there is time to wait out `method`'s pause and still send it. */
  private canWait(method: string): boolean {
    const wait = this.cooling.has(method) ? this.pauseLeft(method) : this.tuning.retryDelayMs;
    return this.timeLeft() >= wait + COLLECT.MIN_ROUND_MS;
  }

  /** Fail a call locally (nothing sent, no request spent): its method is paused past the time limit. */
  private refuseLocally(p: Pending): void {
    this.rateLimited = true;
    p.reject(p.firstError ?? new RpcError(429, "Too many requests (the provider's limit would not reset in time)", p.method));
  }

  /**
   * A batched call failed: send it once more later, in a smaller batch, if it is worth it and time
   * allows; otherwise fail it. A refusal for being too fast pauses the whole method for the provider's
   * window (COLLECT.RETRY_DELAY_MS); a timeout is retried after a short pause. The budget is checked
   * again when the retry is sent.
   */
  private failOrRetry(p: Pending, error: Error): void {
    const limited = isRateLimited(error);
    if (limited) this.rateLimited = true;
    if (p.retried && limited) this.saturated.add(p.method);
    const worth = !p.retried && !p.isolate && isRetryable(error) && !(limited && this.saturated.has(p.method));
    if (limited) {
      // The provider's window for this method is used up: pause it, or (no time to wait) stop sending it.
      if (this.canWait(p.method)) this.pause(p.method);
      else if (!this.cooling.has(p.method)) this.allowance.set(p.method, 0);
      if (worth && this.cooling.has(p.method)) {
        p.retried = true;
        p.firstError = error;
        this.held.push(p);
      } else {
        p.reject(error);
      }
      return;
    }
    if (!worth || this.timeLeft() < this.tuning.timeoutRetryDelayMs + COLLECT.MIN_ROUND_MS) {
      p.reject(error);
      return;
    }
    p.retried = true;
    p.firstError = error;
    setTimeout(() => {
      this.queue.push(p);
      this.schedule();
    }, this.tuning.timeoutRetryDelayMs);
  }

  private async flush(): Promise<void> {
    this.scheduled = false;
    this.drainAccounts();
    const queued = this.queue.splice(0);
    if (queued.length === 0) return;
    if (this.timeLeft() < COLLECT.MIN_ROUND_MS) {
      this.deadlineHit = true;
      for (const p of queued) p.reject(new DeadlineError());
      return;
    }
    // Calls of a paused method wait for the pause to end (or fail now if it would end too late), and a
    // method that was refused before goes out at most COLLECT.RETRY_BATCH calls per provider window.
    const items: Pending[] = [];
    const sorted = queued.map((p, i) => ({ p, i })).sort((a, b) => b.p.priority - a.p.priority || a.i - b.i);
    for (const { p } of sorted) {
      const left = this.allowance.get(p.method);
      if (left !== undefined && left <= 0 && !this.cooling.has(p.method) && this.canWait(p.method)) this.pause(p.method);
      if (this.cooling.has(p.method) || (left !== undefined && left <= 0)) {
        if (this.cooling.has(p.method) && this.canWait(p.method)) this.held.push(p);
        else this.refuseLocally(p);
        continue;
      }
      if (left !== undefined) this.allowance.set(p.method, left - 1);
      items.push(p);
    }
    if (items.length === 0) return;
    const ordered = items.map((p, i) => ({ p, i }));
    const budget = this.left();
    const isolated: Pending[] = [];
    const batched: Pending[] = [];
    const again: Pending[] = [];
    const cost = (iso: number, bat: number, re: number) => iso + Math.ceil(bat / LIMITS.MAX_BATCH) + Math.ceil(re / COLLECT.RETRY_BATCH);
    let retryRoom = Math.max(0, COLLECT.RETRY_MAX_REQUESTS - this.retryRequests) * COLLECT.RETRY_BATCH;
    for (const { p } of ordered) {
      if (p.retried && p.firstError) {
        // Out of retry allowance: the step gets the original failure.
        if (retryRoom <= 0) {
          p.reject(p.firstError);
          continue;
        }
        retryRoom--;
      }
      const next = p.isolate
        ? cost(isolated.length + 1, batched.length, again.length)
        : p.retried
          ? cost(isolated.length, batched.length, again.length + 1)
          : cost(isolated.length, batched.length + 1, again.length);
      if (next <= budget) (p.isolate ? isolated : p.retried ? again : batched).push(p);
      else {
        this.budgetHit = true;
        p.reject(new BudgetExceededError(next, budget));
      }
    }
    const work: Promise<unknown>[] = isolated.map((p) =>
      this.rpc.call(p.method, p.params).then(p.resolve, (e: unknown) => {
        if (e instanceof BudgetExceededError) this.budgetHit = true;
        p.reject(e instanceof Error ? e : new Error(String(e)));
      }),
    );
    const send = (group: Pending[]) =>
      this.rpc.batch(group.map((p) => ({ method: p.method, params: p.params }))).then(
        (results) => {
          group.forEach((p, i) => {
            const r = results[i];
            if (r instanceof Error) this.failOrRetry(p, r);
            else if (r === undefined) p.reject(new Error("missing answer"));
            else p.resolve(r);
          });
        },
        (e: unknown) => {
          if (e instanceof BudgetExceededError) this.budgetHit = true;
          const err = e instanceof Error ? e : new Error(String(e));
          for (const p of group) this.failOrRetry(p, err);
        },
      );
    if (batched.length > 0) work.push(send(batched));
    for (let i = 0; i < again.length; i += COLLECT.RETRY_BATCH) {
      this.retryRequests++;
      this.retries += Math.min(COLLECT.RETRY_BATCH, again.length - i);
      work.push(send(again.slice(i, i + COLLECT.RETRY_BATCH)));
    }
    await Promise.all(work);
  }
}

// ---------------------------------------------------------------------------
// collectFacts
// ---------------------------------------------------------------------------

interface Creation {
  signature: string;
  slot: number;
  createdAt: number | null;
  deployer: string;
  devBuySol: number | null;
  devBuyTokens: number | null;
  name: string | null;
  symbol: string | null;
  source: "pump-create" | "mint-init";
}

export interface HolderRow {
  tokenAccount: string;
  owner: string;
  amount: number;
}

const SYSTEM = PROGRAMS.SYSTEM;
const POOL_PROGRAMS: ReadonlySet<string> = new Set([
  PROGRAMS.PUMP_AMM,
  PROGRAMS.RAYDIUM_V4,
  PROGRAMS.RAYDIUM_CPMM,
  PROGRAMS.METEORA_DLMM,
  ...EXTRA_AMM_PROGRAMS,
]);

export async function collectFacts(mint: string, opts: AnalyzeOptions, tuning: CollectTuning = {}): Promise<CollectedFacts> {
  if (!isValidAddress(mint)) throw new InvalidMintError();
  const startedAt = opts.now();
  const startRequests = opts.rpc.requests;
  const used = () => opts.rpc.requests - startRequests;
  const timeLeft = () => opts.deadlineMs - (opts.now() - startedAt);
  const loader = new Loader(opts.rpc, () => opts.maxRpcRequests - used(), timeLeft, {
    retryDelayMs: Math.max(0, tuning.retryDelayMs ?? COLLECT.RETRY_DELAY_MS),
    timeoutRetryDelayMs: Math.max(0, tuning.timeoutRetryDelayMs ?? COLLECT.TIMEOUT_RETRY_DELAY_MS),
  });
  const notes: string[] = [];
  const note = (text: string) => {
    if (!notes.includes(text)) notes.push(text);
  };
  /** Checks the provider turned away for being asked too fast (listed in one note at the end). */
  const refusedChecks: string[] = [];

  const getSigs = (address: string, limit: number, priority: number, before?: string) =>
    loader
      .load<unknown>("getSignaturesForAddress", [address, before ? { limit, before, commitment: "confirmed" } : { limit, commitment: "confirmed" }], { priority })
      .then((v) => {
        const sigs = parseSignatures(v);
        if (!sigs) throw new Error("unreadable signature list");
        return sigs;
      });
  const getTx = (signature: string, priority: number) => loader.load<unknown>("getTransaction", [signature, TX_OPTIONS], { priority });

  const requestsText = `${fmt(opts.maxRpcRequests)} Solana request${opts.maxRpcRequests === 1 ? "" : "s"}`;
  /** Turn a step failure into a plain-language note. */
  const explain = (error: unknown, what: string) => {
    if (error instanceof BudgetExceededError) note(`We reached the limit of ${requestsText} for one sticker, so we could not check ${what}.`);
    else if (error instanceof DeadlineError) note(`We ran out of time (${Math.round(opts.deadlineMs / 1000)} seconds) before we could check ${what}.`);
    else if (isRateLimited(error)) {
      // One combined note at the end instead of one sentence per step.
      if (!refusedChecks.includes(what)) refusedChecks.push(what);
    }
    else note(`The Solana network did not answer when we checked ${what}.`);
  };

  // ---- Round 1: coin basics (all in one batch) + largest holders (own request) + DEX Screener ----
  const curvePda = bondingCurveAddress(mint);
  const mintBytes = decodeAddress(mint);
  if (!curvePda || !mintBytes) throw new InvalidMintError();
  const metadataPda = findProgramAddress(["metadata", decodeAddress(METAPLEX_METADATA_PROGRAM) as Uint8Array, mintBytes], METAPLEX_METADATA_PROGRAM).address;
  const mayhemPda = findProgramAddress(["mayhem-state", mintBytes], PUMP_MAYHEM_PROGRAM).address;

  const mintAccP = loader.account(mint, P.CORE);
  const curveAccP = loader.account(curvePda, P.CORE);
  const markerSigsP = [metadataPda, mayhemPda].map((a) => settle(getSigs(a, COLLECT.CREATION_MARKER_SIGNATURES, P.CORE)));
  const mintPage1P = settle(getSigs(mint, COLLECT.MINT_SIGNATURE_PAGE, P.CORE));
  // Some providers refuse getTokenLargestAccounts; on its own request it can't spoil the batch.
  const largestP = settle(
    loader.load<unknown>("getTokenLargestAccounts", [mint, { commitment: "confirmed" }], { priority: P.CORE, isolate: opts.maxRpcRequests >= 2 }),
  );
  let dexRequests = 0;
  const dexP: Promise<DexResult> = (async () => {
    dexRequests++;
    return fetchDexToken(mint, opts.fetch);
  })();

  // ---- The mint account decides whether this is a real token ----
  const mintAcc = await settle(mintAccP);
  if (!mintAcc.ok) {
    if (mintAcc.error instanceof RpcError && mintAcc.error.code === -32602) throw new InvalidMintError();
    throw new ChainUnavailableError();
  }
  const mintValue = mintAcc.value;
  if (mintValue === null) throw new NotFoundError();
  if (!isObj(mintValue)) throw new ChainUnavailableError();
  const tokenProgram = mintValue.owner;
  const parsedMint = isObj(mintValue.data) && isObj(mintValue.data.parsed) ? mintValue.data.parsed : null;
  const mintInfo = parsedMint && parsedMint.type === "mint" && isObj(parsedMint.info) ? parsedMint.info : null;
  if ((tokenProgram !== PROGRAMS.TOKEN && tokenProgram !== PROGRAMS.TOKEN_2022) || !mintInfo) {
    throw new InvalidMintError("That address is not a token mint.");
  }
  const decimals = typeof mintInfo.decimals === "number" && Number.isInteger(mintInfo.decimals) && mintInfo.decimals >= 0 && mintInfo.decimals <= 18 ? mintInfo.decimals : null;
  const supplyRaw = typeof mintInfo.supply === "string" && /^\d+$/.test(mintInfo.supply) ? mintInfo.supply : null;
  if (decimals === null || supplyRaw === null) throw new InvalidMintError("That token's mint account could not be read.");
  const supply = Number(supplyRaw) / 10 ** decimals;
  const authority = (v: unknown): string | null | "unknown" => (v === null || v === undefined ? null : typeof v === "string" ? v : "unknown");
  const mintAuthority = authority(mintInfo.mintAuthority);
  const freezeAuthority = authority(mintInfo.freezeAuthority);
  // Token-2022 coins carry their name in the mint itself.
  let chainName: string | null = null;
  let chainSymbol: string | null = null;
  if (Array.isArray(mintInfo.extensions)) {
    for (const ext of mintInfo.extensions) {
      if (isObj(ext) && ext.extension === "tokenMetadata" && isObj(ext.state)) {
        chainName = cleanText(ext.state.name, 80);
        chainSymbol = cleanText(ext.state.symbol, 24);
      }
    }
  }

  // ---- pump.fun curve ----
  let curve: PumpCurve | null = null;
  const curveAcc = await settle(curveAccP);
  if (curveAcc.ok) {
    const v = curveAcc.value;
    if (isObj(v) && v.owner === PROGRAMS.PUMP) curve = decodeBondingCurveAccount(v.data);
  } else {
    explain(curveAcc.error, "whether this is a pump.fun coin");
  }
  const curveCreatorWallet = curve?.creator && !isOffCurveAddress(curve.creator) ? curve.creator : null;

  // A graduated coin's curve stops trading at graduation, so the curve's own history is usually short
  // and reaches back to the creation block, where bundles buy. Read it when the coin's history is too
  // long to reach its first block (asked as soon as we know, so it joins the next batch).
  const curveSigsP: Promise<SigInfo[] | null> = curve?.complete
    ? mintPage1P.then((page1) =>
        page1.ok && page1.value.length >= COLLECT.MINT_SIGNATURE_PAGE
          ? getSigs(curvePda, COLLECT.CURVE_SIGNATURES, P.EARLY).catch((error: unknown) => {
              explain(error, "the coin's first block");
              return null;
            })
          : null,
      )
    : Promise.resolve(null);

  // Shared state filled by the steps below.
  const mintSigs: SigInfo[] = [];
  let mintHistoryComplete = false;
  let mintPagesRead = 0;

  // ---- Step: creation ----
  const interpretCreation = (tx: unknown): Creation | null => {
    const pump = parsePumpCreate(tx);
    if (pump && pump.mint === mint) {
      return { signature: pump.signature, slot: pump.slot, createdAt: pump.createdAt, deployer: pump.deployer, devBuySol: pump.devBuySol, devBuyTokens: pump.devBuyTokens, name: pump.name, symbol: pump.symbol, source: "pump-create" };
    }
    const init = parseMintInit(tx, mint);
    if (init) return { signature: init.signature, slot: init.slot, createdAt: init.createdAt, deployer: init.payer, devBuySol: null, devBuyTokens: null, name: null, symbol: null, source: "mint-init" };
    return null;
  };
  const oldestOk = (sigs: SigInfo[]) => {
    for (let i = sigs.length - 1; i >= 0; i--) if (sigs[i]?.ok) return sigs[i] ?? null;
    return null;
  };

  const creationP: Promise<Creation | null> = (async () => {
    try {
      const candidates: string[] = [];
      for (const markerP of markerSigsP) {
        const m = await markerP;
        if (m.ok && m.value.length > 0 && m.value.length < COLLECT.CREATION_MARKER_SIGNATURES) {
          const o = oldestOk(m.value);
          if (o) candidates.push(o.signature);
        }
      }
      const page1 = await mintPage1P;
      if (page1.ok) {
        mintSigs.push(...page1.value);
        mintPagesRead = 1;
        if (page1.value.length < COLLECT.MINT_SIGNATURE_PAGE) {
          mintHistoryComplete = true;
          const o = oldestOk(page1.value);
          if (o) candidates.push(o.signature);
        }
      } else {
        explain(page1.error, "this coin's transaction history");
      }
      const unique = [...new Set(candidates)];
      const txs = await Promise.all(unique.map((s) => settle(getTx(s, P.CORE))));
      for (const t of txs) {
        if (!t.ok) continue;
        const c = interpretCreation(t.value);
        if (c) return c;
      }
      // Page back through the coin's history (newest first) until we reach its first transaction.
      while (!mintHistoryComplete && page1.ok && mintPagesRead < COLLECT.MAX_MINT_PAGES) {
        const before = mintSigs[mintSigs.length - 1]?.signature;
        if (!before) break;
        const page = await getSigs(mint, COLLECT.MINT_SIGNATURE_PAGE, P.CORE, before);
        mintSigs.push(...page);
        mintPagesRead++;
        if (page.length < COLLECT.MINT_SIGNATURE_PAGE) mintHistoryComplete = true;
      }
      if (mintHistoryComplete) {
        const o = oldestOk(mintSigs);
        if (o) {
          const c = interpretCreation(await getTx(o.signature, P.CORE));
          if (c) return c;
        }
        note("We could not recognise this coin's first transaction as its creation, so its launch time and dev buy are unknown.");
        return null;
      }
      note(
        `This coin has more than ${fmt(mintPagesRead * COLLECT.MINT_SIGNATURE_PAGE)} transactions and its creation could not be located directly, so its launch time, dev buy and deployer are unknown.`,
      );
      return null;
    } catch (error) {
      explain(error, "the coin's creation transaction");
      return null;
    }
  })();

  // Who deployed it: the creation's signer, else pump.fun's creator record when that is a wallet.
  const deployerP: Promise<string | null> = creationP.then((c) => {
    if (c) return c.deployer;
    if (curveCreatorWallet) {
      note("The deployer is taken from pump.fun's creator record because the creation transaction was not found.");
      return curveCreatorWallet;
    }
    if (curve?.creator) note("pump.fun's creator record points to a fee-sharing account, not a wallet, and the creation transaction was not found, so the deployer is unknown.");
    return null;
  });
  // Speculative: on pump.fun the creator record is usually the deployer, so start reading it now.
  if (curveCreatorWallet) void getSigs(curveCreatorWallet, LIMITS.ORIGIN_SIGNATURES, P.ORIGIN).catch(() => undefined);

  // ---- Wallet origins (memoized per wallet) ----
  const origins = new Map<string, Promise<{ origin: WalletOrigin; sigs: SigInfo[]; fundingSignature: string | null; fundingSlot: number | null } | null>>();
  const traceOrigin = (wallet: string) => {
    let p = origins.get(wallet);
    if (!p) {
      p = (async () => {
        const sigs = await getSigs(wallet, LIMITS.ORIGIN_SIGNATURES, P.ORIGIN);
        const complete = sigs.length < LIMITS.ORIGIN_SIGNATURES;
        const oldest = sigs[sigs.length - 1];
        const origin: WalletOrigin = {
          wallet,
          signaturesSampled: sigs.length,
          historyComplete: complete,
          firstSeenAt: oldest?.blockTime ?? null,
          funder: null,
          fundedSol: null,
          fundedAt: null,
          veteran: sigs.length >= LIMITS.VETERAN_SIGNATURES,
        };
        let fundingSignature: string | null = null;
        let fundingSlot: number | null = null;
        if (complete) {
          // The first SOL usually arrives in the very first transaction; look at the second if not.
          const okOldest = sigs.filter((s) => s.ok).slice(-2).reverse();
          for (const s of okOldest) {
            const tx = await getTx(s.signature, P.ORIGIN);
            const f = findFunding(tx, wallet, COLLECT.MIN_FUNDING_LAMPORTS);
            if (f) {
              origin.funder = f.funder;
              origin.fundedSol = round9(f.sol);
              origin.fundedAt = f.at;
              origin.fundedInBatch = isBatchPayout(tx, f.funder, COLLECT.BATCH_PAYOUT_MIN_RECIPIENTS, COLLECT.MIN_FUNDING_LAMPORTS);
              fundingSignature = f.signature;
              fundingSlot = f.slot;
              break;
            }
          }
        }
        return { origin, sigs, fundingSignature, fundingSlot };
      })().catch((error: unknown) => {
        explain(error, "where some wallets got their first SOL");
        return null;
      });
      origins.set(wallet, p);
    }
    return p;
  };

  // ---- Step: holders ----
  /**
   * Every token account of the coin via getProgramAccounts, reading only owner + amount (dataSlice
   * offset 32, 40 bytes) so each account is ~290 bytes of JSON. A popular coin can have hundreds of
   * thousands of accounts, so the RPC client cuts the answer off past LIMITS.HOLDER_SCAN_MAX_BYTES and we
   * refuse lists longer than LIMITS.HOLDER_SCAN_MAX_ACCOUNTS. Either way: a note, no holders, no failure.
   */
  const scanHolders = async (): Promise<HolderRow[] | null> => {
    const filters: unknown[] =
      tokenProgram === PROGRAMS.TOKEN
        ? [{ dataSize: SPL_TOKEN_ACCOUNT_SIZE }, { memcmp: { offset: 0, bytes: mint } }]
        : // Token-2022 accounts have different sizes (extensions), so only the mint filter applies.
          [{ memcmp: { offset: 0, bytes: mint } }];
    const all = await settle(
      loader.load<unknown>("getProgramAccounts", [tokenProgram, { encoding: "base64", dataSlice: { offset: 32, length: 40 }, filters, commitment: "confirmed" }], {
        priority: P.HOLDERS,
        // On its own request: a refusal or a cut-off answer can't spoil other calls.
        isolate: opts.maxRpcRequests >= 2,
      }),
    );
    const tooMany = `This coin has more than ${fmt(LIMITS.HOLDER_SCAN_MAX_ACCOUNTS)} token accounts, too many to read one by one, and the Solana provider refused the largest-holders lookup, so who holds it is unknown.`;
    if (!all.ok) {
      if (all.error instanceof RpcTransportError && all.error.reason === "too-large") note(tooMany);
      else if (all.error instanceof BudgetExceededError || all.error instanceof DeadlineError) explain(all.error, "the largest holders");
      else note("The Solana provider refused both ways of listing the largest holders, so who holds this coin is unknown.");
      return null;
    }
    if (!Array.isArray(all.value)) {
      note("The Solana provider sent an unreadable list of token accounts, so who holds this coin is unknown.");
      return null;
    }
    if (all.value.length > LIMITS.HOLDER_SCAN_MAX_ACCOUNTS) {
      note(tooMany);
      return null;
    }
    note(`The Solana provider refused the largest-holders lookup, so holders were read from all ${fmt(all.value.length)} token accounts instead.`);
    return holderRowsFromProgramAccounts(all.value, decimals, LIMITS.TOP_HOLDERS);
  };

  const holderSigs = new Map<string, SigInfo[]>();
  const holdersP: Promise<HolderFact[] | null> = (async () => {
    let rows: HolderRow[] = [];
    try {
      const largest = await largestP;
      const value = largest.ok && isObj(largest.value) && Array.isArray(largest.value.value) ? largest.value.value : null;
      if (value) {
        const accounts: { address: string; amount: number }[] = [];
        for (const a of value) {
          if (!isObj(a) || typeof a.address !== "string" || typeof a.amount !== "string" || !/^\d+$/.test(a.amount)) continue;
          const amount = Number(a.amount) / 10 ** decimals;
          if (amount > 0) accounts.push({ address: a.address, amount });
        }
        const top = accounts.slice(0, LIMITS.TOP_HOLDERS);
        if (top.length > 0) {
          const list = await Promise.all(top.map((a) => loader.account(a.address, P.HOLDERS)));
          top.forEach((a, i) => {
            const acc = list[i];
            const parsed = isObj(acc) && isObj(acc.data) && isObj(acc.data.parsed) ? acc.data.parsed : null;
            const info = parsed && isObj(parsed.info) ? parsed.info : null;
            if (info && info.mint === mint && typeof info.owner === "string") rows.push({ tokenAccount: a.address, owner: info.owner, amount: a.amount });
          });
          if (rows.length < top.length) note("Some of the largest token accounts could not be read, so they are left out of the holder list.");
        }
      } else {
        if (!largest.ok && (largest.error instanceof BudgetExceededError || largest.error instanceof DeadlineError)) {
          explain(largest.error, "the largest holders");
          return null;
        }
        // Fallback for providers that refuse getTokenLargestAccounts (the public RPC does): read every
        // token account of the coin, owner + amount only, within hard size limits (see scanHolders).
        const scanned = await scanHolders();
        if (!scanned) return null;
        rows = scanned;
      }
    } catch (error) {
      explain(error, "the largest holders");
      return null;
    }

    // What is each owner? Local rules first, then the owner accounts themselves.
    const deployerGuess = curveCreatorWallet;
    const owners = [...new Set(rows.map((r) => r.owner))];
    const needInfo = owners.filter((o) => o !== curvePda && o !== PROGRAMS.INCINERATOR && o !== SYSTEM && !KNOWN_POOL_AUTHORITIES.has(o));
    const ownerInfoP = settle(Promise.all(needInfo.map((o) => loader.account(o, P.HOLDERS))));
    // Speculative: anyone on the curve may be a wallet, so start tracing now (merged into the same request).
    for (const o of needInfo) if (!isOffCurveAddress(o) && o !== deployerGuess) void traceOrigin(o);
    if (deployerGuess && needInfo.includes(deployerGuess)) void traceOrigin(deployerGuess);

    const ownerInfo = await ownerInfoP;
    const ownerProgram = new Map<string, string | null>();
    if (ownerInfo.ok) {
      const list = ownerInfo.value;
      needInfo.forEach((o, i) => {
        const acc = list[i];
        ownerProgram.set(o, isObj(acc) && typeof acc.owner === "string" ? acc.owner : null);
      });
    } else {
      explain(ownerInfo.error, "which holders are programs or pools");
    }
    const deployer = await deployerP;

    const kindOf = (owner: string) =>
      holderKind(owner, { curve: curvePda, deployer, ownerProgram: ownerInfo.ok ? (ownerProgram.get(owner) ?? null) : undefined });

    const facts: HolderFact[] = [];
    let unknownKinds = 0;
    for (const r of rows.sort((a, b) => b.amount - a.amount)) {
      let kind = kindOf(r.owner);
      if (kind === "unchecked") {
        unknownKinds++;
        kind = "wallet";
      }
      let origin: WalletOrigin | null = null;
      if (kind === "wallet" || kind === "creator") {
        const traced = await traceOrigin(r.owner);
        if (traced) {
          origin = traced.origin;
          holderSigs.set(r.owner, traced.sigs);
        }
      }
      facts.push({ owner: r.owner, tokenAccount: r.tokenAccount, amount: r.amount, pctSupply: supply > 0 ? (r.amount / supply) * 100 : 0, kind, origin });
    }
    if (unknownKinds > 0) note(`${unknownKinds} holder(s) could not be checked for being a program, so they are treated as ordinary wallets.`);
    const untraced = facts.filter((f) => (f.kind === "wallet" || f.kind === "creator") && f.origin?.veteran).length;
    if (untraced > 0) note(`${untraced} holder wallet(s) have ${fmt(LIMITS.VETERAN_SIGNATURES)}+ transactions, so where their SOL came from was not traced.`);
    return facts;
  })();

  // ---- Step: early buys (creation block and the next one) ----
  /** Set to true only when the first two blocks were read in full and every transaction in them was checked. */
  let earlyBuysComplete = false;
  const earlyP: Promise<EarlyBuyFact[]> = (async () => {
    const creation = await creationP;
    const holders = await holdersP;
    if (!creation) {
      note("Same-block buyers are unknown because the creation transaction was not found.");
      return [];
    }
    try {
      const deployer = creation.deployer;
      const lo = creation.slot;
      const hi = creation.slot + THRESHOLDS.BUNDLE_SLOTS;
      const candidates: SigInfo[] = [];
      const seen = new Set<string>();
      const add = (s: SigInfo) => {
        if (s.ok && s.slot >= lo && s.slot <= hi && !seen.has(s.signature)) {
          seen.add(s.signature);
          candidates.push(s);
        }
      };
      let firstBlockRead = mintHistoryComplete;
      if (mintHistoryComplete) for (const s of mintSigs) add(s);
      const curveSigs = await curveSigsP;
      const oldestCurve = curveSigs?.[curveSigs.length - 1];
      if (curveSigs && (curveSigs.length < COLLECT.CURVE_SIGNATURES || (oldestCurve !== undefined && oldestCurve.slot <= lo))) {
        firstBlockRead = true;
        for (const s of curveSigs) add(s);
      }
      // The deployer's own history often holds the bundle transactions that bought alongside it.
      const deployerTrace = await traceOrigin(deployer);
      if (deployerTrace) for (const s of deployerTrace.sigs) add(s);
      // Top holders whose own history covers the first block (when the coin's first block can't be read).
      let unread = 0;
      let tooLong = 0;
      for (const h of holders ?? []) {
        if (h.kind !== "wallet" && h.kind !== "creator") continue;
        const sigs = holderSigs.get(h.owner);
        if (!sigs) {
          unread++;
          continue;
        }
        const oldest = sigs[sigs.length - 1];
        const covers = sigs.length < LIMITS.ORIGIN_SIGNATURES || (oldest !== undefined && oldest.slot <= lo);
        if (!covers) {
          tooLong++;
          continue;
        }
        for (const s of sigs) add(s);
      }
      if (!firstBlockRead) {
        // Read the coin's history backwards from a transaction we already know that happened shortly
        // after its first two blocks, down to the creation ("before" may be any transaction; "until"
        // stops at the creation). This reaches the first block even when the coin has a long history.
        const ata = typeof tokenProgram === "string" ? associatedTokenAddress(deployer, mint, tokenProgram) : null;
        const ataSigs = ata ? await getSigs(ata, COLLECT.DEPLOYER_TOKEN_ACCOUNT_SIGNATURES, P.DEPLOYER).catch(() => []) : [];
        const known = [ataSigs, deployerTrace?.sigs ?? [], ...holderSigs.values()];
        let anchor: SigInfo | null = null;
        for (const list of known) {
          for (const s of list) {
            if (s.slot > hi && s.slot - lo <= COLLECT.FIRST_BLOCK_ANCHOR_SLOTS && (anchor === null || s.slot < anchor.slot)) anchor = s;
          }
        }
        if (anchor) {
          const window = await settle(
            loader
              .load<unknown>("getSignaturesForAddress", [mint, { limit: COLLECT.MINT_SIGNATURE_PAGE, before: anchor.signature, until: creation.signature, commitment: "confirmed" }], {
                priority: P.EARLY,
              })
              .then((v) => parseSignatures(v)),
          );
          if (window.ok && window.value && window.value.length < COLLECT.MINT_SIGNATURE_PAGE) {
            firstBlockRead = true;
            for (const s of window.value) add(s);
          } else if (!window.ok) explain(window.error, "the coin's first block");
        }
      }
      if (!firstBlockRead) {
        note("Same-block buyers were checked only among the top holders, because this coin's first block could not be read in full.");
        // Only these matter when the first block itself was not read.
        if (unread > 0) note(`${unread} top holder(s) could not be checked for first-block buys (time or request limit).`);
        if (tooLong > 0) note(`${tooLong} top holder(s) have histories too long to tell whether they bought in the first block.`);
      }
      candidates.sort((a, b) => a.slot - b.slot);
      const capped = candidates.length > COLLECT.EARLY_BUY_TX_CAP;
      if (capped) note(`There were more than ${COLLECT.EARLY_BUY_TX_CAP} transactions in the first two blocks; only the first ${COLLECT.EARLY_BUY_TX_CAP} were checked.`);
      const picked = candidates.slice(0, COLLECT.EARLY_BUY_TX_CAP);
      const txs = await Promise.all(picked.map((s) => settle(getTx(s.signature, P.EARLY))));
      const out: EarlyBuyFact[] = [];
      let failed = 0;
      txs.forEach((t, i) => {
        const sig = picked[i];
        if (!sig) return;
        if (!t.ok) {
          failed++;
          explain(t.error, "the coin's first block");
          return;
        }
        for (const trade of mintTrades(t.value, mint)) {
          if (trade.side !== "buy" || trade.wallet === deployer || trade.wallet === curvePda) continue;
          out.push({ wallet: trade.wallet, slot: sig.slot, signature: sig.signature, tokenAmount: trade.tokens, slotsAfterCreate: sig.slot - lo });
        }
      });
      earlyBuysComplete = firstBlockRead && !capped && failed === 0;
      return out;
    } catch (error) {
      explain(error, "the coin's first block");
      return [];
    }
  })();

  // ---- Step: factory (deployer, its funder, the funder's other wallets) ----
  const factoryP: Promise<FactoryFacts | null> = (async () => {
    const deployer = await deployerP;
    if (!deployer) return null;
    const creation = await creationP;
    /**
     * Stays true only while every planned read finishes. Without the creation the launch time (fresh
     * deployer) and the first moves after launch (fast dev sell) can't be checked, so that counts too.
     */
    let complete = creation !== null && creation.deployer === deployer;
    try {
      // The deployer's own token account for this coin shows its buys and sells of it.
      const ata = typeof tokenProgram === "string" ? associatedTokenAddress(deployer, mint, tokenProgram) : null;
      const ataSigsP = ata ? settle(getSigs(ata, COLLECT.DEPLOYER_TOKEN_ACCOUNT_SIGNATURES, P.DEPLOYER)) : null;
      const traced = await traceOrigin(deployer);
      const deployerOrigin = traced?.origin ?? null;
      const deployerSigs = traced?.sigs ?? [];

      // Which deployer transactions to read: the creation, the first moves after it, then the most recent.
      const pick: string[] = [];
      const pickSet = new Set<string>();
      const take = (s: string) => {
        if (pick.length < LIMITS.LAUNCH_TX_SAMPLE && !pickSet.has(s)) {
          pickSet.add(s);
          pick.push(s);
        }
      };
      if (creation && creation.deployer === deployer) take(creation.signature);
      if (ataSigsP && creation) {
        const ataSigs = await ataSigsP;
        if (ataSigs.ok) {
          const after = ataSigs.value.filter((s) => s.ok && s.slot >= creation.slot && s.signature !== creation.signature).reverse();
          for (const s of after.slice(0, COLLECT.DEV_SELL_LOOKAHEAD_TX)) take(s.signature);
        } else {
          complete = false;
          explain(ataSigs.error, "the deployer's first moves after launch");
        }
      }
      if (!traced) complete = false;
      const okSigs = deployerSigs.filter((s) => s.ok);
      // Its oldest transactions were already read to find its funding (no extra request).
      if (deployerOrigin?.historyComplete) for (const s of okSigs.slice(-2)) take(s.signature);
      for (const s of okSigs.slice(0, LIMITS.LAUNCH_SIGNATURE_SAMPLE)) take(s.signature);
      if (okSigs.length > pick.length) note(`We read ${pick.length} of the deployer's ${fmt(deployerSigs.length)}${deployerOrigin?.historyComplete ? "" : "+"} transactions to find its launches and sells.`);
      const deployerTxs = await Promise.all(pick.map((s) => settle(getTx(s, P.DEPLOYER))));
      const okDeployerTxs = deployerTxs.flatMap((t) => (t.ok ? [t.value] : []));
      if (okDeployerTxs.length < deployerTxs.length) {
        complete = false;
        note("Some of the deployer's transactions could not be read.");
      }
      const deployerLaunches = launchesFrom(deployer, okDeployerTxs);
      const deployerTokenTransfers = tokenTransfersFrom(deployer, mint, okDeployerTxs);

      const funder = deployerOrigin?.funder ?? null;
      const base: FactoryFacts = {
        deployer,
        deployerOrigin,
        funder,
        siblings: [],
        deployerLaunches,
        deployerSentBackSol: 0,
        funderSignaturesSampled: 0,
        funderIsVeteran: false,
        deployerTokenTransfers,
        traceComplete: false,
      };
      const finish = () => {
        base.traceComplete = complete;
        return base;
      };
      if (!funder) {
        if (deployerOrigin?.veteran) note(`The deployer has ${fmt(LIMITS.VETERAN_SIGNATURES)}+ transactions, so the wallet that first funded it was not traced.`);
        else if (deployerOrigin) note("The wallet that first funded the deployer could not be identified.");
        return finish();
      }
      base.deployerSentBackSol = round9(okDeployerTxs.reduce<number>((s, tx) => s + solSent(tx, deployer, funder), 0));

      // The funder's history around the moment it funded the deployer: the transactions just before
      // the funding, and the ones between the funding and the launch (signatures are read backwards
      // from the launch transaction, which works because "before" may be any transaction).
      const fundingSig = traced?.fundingSignature ?? null;
      const fundingSlot = traced?.fundingSlot ?? null;
      const half = Math.max(1, Math.floor(LIMITS.FUNDER_TX_SAMPLE / 2));
      const launchSig = creation && creation.deployer === deployer && fundingSlot !== null && creation.slot >= fundingSlot ? creation.signature : null;
      const [olderR, newerR] = await Promise.all([
        settle(getSigs(funder, LIMITS.VETERAN_SIGNATURES, P.FAMILY, fundingSig ?? undefined)),
        launchSig ? settle(getSigs(funder, half, P.FAMILY, launchSig)) : Promise.resolve<Settled<SigInfo[]>>({ ok: true, value: [] }),
      ]);
      if (!olderR.ok) {
        complete = false;
        explain(olderR.error, "the deployer's funder");
        return finish();
      }
      if (!newerR.ok) {
        complete = false;
        explain(newerR.error, "the deployer's funder");
      }
      base.funderIsVeteran = olderR.value.length >= LIMITS.VETERAN_SIGNATURES;
      const olderSide = olderR.value.slice(0, half);
      const olderSet = new Set(olderR.value.map((s) => s.signature));
      const newerSide = newerR.ok
        ? newerR.value.filter((s) => fundingSlot !== null && s.slot >= fundingSlot && s.signature !== fundingSig && !olderSet.has(s.signature))
        : [];
      const window = [...newerSide, ...olderSide].filter((s) => s.ok && s.signature !== fundingSig);
      base.funderSignaturesSampled = window.length + (fundingSig ? 1 : 0);
      if (base.funderIsVeteran) {
        note(
          `The deployer's funder had ${fmt(LIMITS.VETERAN_SIGNATURES)}+ transactions before it funded the deployer; it may be an exchange, a trading service or a launch operation, so the other wallets it paid are not counted as the deployer's family.`,
        );
      }
      if (olderR.value.length > half || (newerR.ok && newerR.value.length >= half)) {
        note(`We read ${base.funderSignaturesSampled} of the funder's transactions around the time it funded the deployer; wallets it funded at other times are not shown.`);
      }
      const funderTxs = await Promise.all(window.map((s) => settle(getTx(s.signature, P.FAMILY))));
      // Never let unread transactions look like "the funder paid nobody else": say so.
      const funderFailed = funderTxs.find((t) => !t.ok);
      if (funderFailed && !funderFailed.ok) {
        complete = false;
        explain(funderFailed.error, "the funder's transactions (some wallets it paid may be missing)");
      }
      const candidates = new Map<string, { sol: number; at: number | null }>();
      for (const t of funderTxs) {
        if (!t.ok || !isPlainTransferTx(t.value)) continue;
        const at = txBasics(t.value)?.blockTime ?? null;
        for (const tr of solMoves(t.value)) {
          if (!tr.topLevel || tr.from !== funder || tr.to === deployer || tr.to === funder) continue;
          if (tr.sol < COLLECT.MIN_SIBLING_FUNDING_SOL || JITO_TIP_ACCOUNTS.has(tr.to) || isOffCurveAddress(tr.to)) continue;
          const prev = candidates.get(tr.to);
          if (!prev || (at !== null && prev.at !== null && at < prev.at)) candidates.set(tr.to, { sol: tr.sol, at });
        }
      }
      const fundedAt = deployerOrigin?.fundedAt ?? null;
      const ranked = [...candidates.entries()].sort((a, b) => {
        const da = fundedAt !== null && a[1].at !== null ? Math.abs(a[1].at - fundedAt) : Number.MAX_SAFE_INTEGER;
        const db = fundedAt !== null && b[1].at !== null ? Math.abs(b[1].at - fundedAt) : Number.MAX_SAFE_INTEGER;
        return da - db || a[0].localeCompare(b[0]);
      });
      if (ranked.length > LIMITS.MAX_SIBLINGS) note(`The funder sent SOL to ${ranked.length} other wallets in our sample; we checked the ${LIMITS.MAX_SIBLINGS} funded closest in time to the deployer.`);
      const chosen = ranked.slice(0, LIMITS.MAX_SIBLINGS);

      base.siblings = await Promise.all(
        chosen.map(async ([wallet, f]): Promise<SiblingFact> => {
          const sibling: SiblingFact = { wallet, fundedSol: round9(f.sol), fundedAt: f.at, launches: [], sentBackSol: 0, signaturesSampled: 0 };
          const sigsR = await settle(getSigs(wallet, LIMITS.LAUNCH_SIGNATURE_SAMPLE, P.FAMILY));
          if (!sigsR.ok) {
            complete = false;
            explain(sigsR.error, "some related wallets");
            return sibling;
          }
          sibling.signaturesSampled = sigsR.value.length;
          const ok = sigsR.value.filter((s) => s.ok);
          let chosenSigs: SigInfo[];
          if (ok.length <= LIMITS.LAUNCH_TX_SAMPLE) chosenSigs = ok;
          else if (sigsR.value.length < LIMITS.LAUNCH_SIGNATURE_SAMPLE) {
            // Whole history visible: launches come right after funding, sweeps at the end.
            const tail = Math.ceil(LIMITS.LAUNCH_TX_SAMPLE * 0.6);
            chosenSigs = [...ok.slice(0, LIMITS.LAUNCH_TX_SAMPLE - tail), ...ok.slice(-tail)];
          } else chosenSigs = ok.slice(0, LIMITS.LAUNCH_TX_SAMPLE);
          const txs = await Promise.all(chosenSigs.map((s) => settle(getTx(s.signature, P.SIBLING_TX))));
          const okTxs = txs.flatMap((t) => (t.ok ? [t.value] : []));
          if (okTxs.length < txs.length) {
            complete = false;
            const failed = txs.find((t) => !t.ok);
            if (failed && !failed.ok) explain(failed.error, "the related wallets' transactions");
          }
          sibling.launches = launchesFrom(wallet, okTxs);
          sibling.sentBackSol = round9(okTxs.reduce<number>((s, tx) => s + solSent(tx, wallet, funder), 0));
          return sibling;
        }),
      );
      const partial = base.siblings.filter((s) => s.signaturesSampled >= LIMITS.LAUNCH_SIGNATURE_SAMPLE).length;
      if (partial > 0) note(`${partial} related wallet(s) have long histories; only their latest ${LIMITS.LAUNCH_SIGNATURE_SAMPLE} transactions were sampled.`);
      return finish();
    } catch (error) {
      explain(error, "the deployer's wallet family");
      return null;
    }
  })();

  // ---- Wait for everything and assemble ----
  const [creation, holders, earlyBuys, factory, dex] = await Promise.all([creationP, holdersP, earlyP, factoryP, dexP]);
  const deployer = await deployerP;
  if (!deployer) note("The deployer of this coin is unknown, so its wallet family was not checked.");
  if (holders === null) note("Holder shares are unknown for this coin.");
  if (dex.status === "not-listed") note("DEX Screener has no trading pair for this coin, so its market numbers are unknown.");
  else if (dex.status === "error") note(`Market numbers are unknown: ${dex.reason}.`);
  if (refusedChecks.length > 0) {
    note(`The Solana provider turned away some of our requests (too many at once), so we could not fully check ${listText(refusedChecks)}.`);
  }
  if (loader.budgetHit) note(`We used all ${requestsText} allowed for one sticker, so some checks were cut short.`);
  if (loader.deadlineHit) note(`We stopped after ${Math.round(opts.deadlineMs / 1000)} seconds and show what we found by then.`);

  const market: MarketFacts | null = dex.status === "ok" ? dex.info.market : null;
  // The DEX pair account itself (e.g. a PumpSwap pool) holding tokens is a pool, not a person.
  const pair = market?.pairAddress ?? null;
  if (holders && pair) for (const h of holders) if (h.owner === pair && h.kind !== "bonding-curve") h.kind = "pool";
  const coin: CoinFacts = {
    mint,
    name: (dex.status === "ok" ? dex.info.name : null) ?? chainName ?? cleanText(creation?.name, 80),
    symbol: (dex.status === "ok" ? dex.info.symbol : null) ?? chainSymbol ?? cleanText(creation?.symbol, 24),
    imageUrl: dex.status === "ok" ? dex.info.imageUrl : null,
    decimals,
    supply,
    launchpad: curve || creation?.source === "pump-create" ? "pump.fun" : "unknown",
    bondingCurve: curve
      ? { address: curvePda, complete: curve.complete, progressPct: curveProgressPct(curve), realSolReserves: round9(Number(curve.realSolReserves) / 1e9) }
      : null,
    creator: deployer,
    createdAt: creation?.createdAt ?? null,
    creationSlot: creation?.slot ?? null,
    creationSignature: creation?.signature ?? null,
    devBuySol: creation?.devBuySol === null || creation?.devBuySol === undefined ? null : round9(creation.devBuySol),
    devBuyTokens: creation?.devBuyTokens === null || creation?.devBuyTokens === undefined ? null : creation.devBuyTokens,
    mintAuthority,
    freezeAuthority,
    market,
  };

  const elapsedMs = Math.max(0, opts.now() - startedAt);
  return {
    coin,
    holders: holders ?? [],
    earlyBuys,
    earlyBuysComplete,
    factory,
    coverage: { rpcRequests: used(), dexRequests, notes, complete: notes.length === 0, elapsedMs },
    collectedAt: opts.now(),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * What a token holder is, from its owner address and the program that owns that address's account
 * (null = no account; undefined = it could not be read).
 *
 * A program-derived (off-curve) owner is infrastructure only when a program owns its account (curve,
 * pool, locker or other program data) or it is a known pool authority. A system-owned or empty
 * off-curve address, such as a multisig vault (seen live: the Squads vault 3UR1Ti... of a coin's team
 * held 7.9% and was left out as "program"), is run by people: "unknown", never left out of the shares
 * and never independent. "unchecked": an ordinary-looking address whose account could not be read.
 */
export function holderKind(
  owner: string,
  ctx: { curve: string | null; deployer: string | null; ownerProgram: string | null | undefined },
): HolderKind | "unchecked" {
  if (ctx.curve && owner === ctx.curve) return "bonding-curve";
  if (owner === PROGRAMS.INCINERATOR || owner === SYSTEM) return "burn";
  if (KNOWN_POOL_AUTHORITIES.has(owner)) return "pool";
  if (ctx.deployer && owner === ctx.deployer) return "creator";
  const offCurve = isOffCurveAddress(owner);
  if (ctx.ownerProgram === undefined) return offCurve ? "unknown" : "unchecked";
  const prog = ctx.ownerProgram;
  if (prog && POOL_PROGRAMS.has(prog)) return "pool";
  if (prog !== null && prog !== SYSTEM) return "program";
  if (offCurve) return "unknown";
  return "wallet";
}

const round9 = (n: number) => Math.round(n * 1e9) / 1e9;

/** Size of a classic SPL token account (Token-2022 accounts can be larger). */
const SPL_TOKEN_ACCOUNT_SIZE = 165;

/**
 * Holder rows from a getProgramAccounts answer with dataSlice {offset 32, length 40} (owner + amount),
 * largest first. Only the `limit` largest are returned; owner addresses are encoded for those only
 * (base58 is the expensive part, and a Worker has little CPU).
 */
export function holderRowsFromProgramAccounts(value: unknown, decimals: number, limit = Number.POSITIVE_INFINITY): HolderRow[] {
  const list = Array.isArray(value) ? value : [];
  const found: { tokenAccount: string; bytes: Uint8Array; raw: bigint }[] = [];
  for (const item of list) {
    if (!isObj(item) || typeof item.pubkey !== "string" || !isObj(item.account)) continue;
    const data = item.account.data;
    const bytes = Array.isArray(data) && typeof data[0] === "string" ? base64ToBytes(data[0]) : null;
    if (!bytes || bytes.length < 40) continue;
    const raw = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(32, true);
    if (raw > 0n) found.push({ tokenAccount: item.pubkey, bytes, raw });
  }
  found.sort((a, b) => (a.raw === b.raw ? a.tokenAccount.localeCompare(b.tokenAccount) : a.raw > b.raw ? -1 : 1));
  return found.slice(0, Math.max(0, limit)).map((f) => ({
    tokenAccount: f.tokenAccount,
    owner: encodeBase58(f.bytes.subarray(0, 32)),
    amount: Number(f.raw) / 10 ** decimals,
  }));
}

/**
 * Plain transfers of `mint` out of `wallet` (no SOL back) among its transactions, one entry per
 * receiver and transaction, oldest first.
 */
export function tokenTransfersFrom(wallet: string, mint: string, txs: unknown[]): TokenTransferFact[] {
  const out: TokenTransferFact[] = [];
  const seen = new Set<string>();
  for (const tx of txs) {
    const b = txBasics(tx);
    if (!b) continue;
    for (const g of tokensSentBy(tx, mint, wallet, COLLECT.TRANSFER_MAX_SOL_BACK)) {
      const key = `${b.signature}:${g.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ to: g.to, tokenAmount: g.tokens, signature: b.signature, at: b.blockTime });
    }
  }
  return out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.signature.localeCompare(b.signature) || a.to.localeCompare(b.to));
}

/** Launches by `wallet` among its transactions, with dev sells seen in the same sample. */
export function launchesFrom(wallet: string, txs: unknown[]): LaunchFact[] {
  const launches = new Map<string, LaunchFact>();
  for (const tx of txs) {
    const c = parsePumpCreate(tx);
    if (!c || c.deployer !== wallet || launches.has(c.mint)) continue;
    launches.set(c.mint, {
      mint: c.mint,
      deployer: wallet,
      signature: c.signature,
      createdAt: c.createdAt,
      slot: c.slot,
      devBuySol: c.devBuySol === null ? null : round9(c.devBuySol),
      firstDevSellAfterMin: null,
      devSold: false,
    });
  }
  for (const launch of launches.values()) {
    for (const tx of txs) {
      const b = txBasics(tx);
      if (!b || b.signature === launch.signature) continue;
      const t = walletTrade(tx, launch.mint, wallet);
      if (t?.side !== "sell") continue;
      launch.devSold = true;
      if (b.blockTime !== null && launch.createdAt !== null && b.blockTime >= launch.createdAt) {
        const minutes = Math.round(((b.blockTime - launch.createdAt) / 60000) * 10) / 10;
        if (launch.firstDevSellAfterMin === null || minutes < launch.firstDevSellAfterMin) launch.firstDevSellAfterMin = minutes;
      }
    }
  }
  return [...launches.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
