/**
 * Pure parsers over getTransaction results (encoding "jsonParsed").
 *
 * Every function is defensive: malformed input gives null / [] / 0, never an exception.
 * Amounts returned are in human units (SOL, whole tokens).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { PROGRAMS } from "../config";
import { decodeBase58, encodeBase58 } from "./base58";
import { base64ToBytes, readI64LE, readU32LE, readU64LE, startsWith, utf8 } from "./bytes";
import { ANCHOR_EVENT_IX_TAG, LAMPORTS_PER_SOL, WSOL_MINT } from "./constants";

// ---------------------------------------------------------------------------
// Loose shapes of a jsonParsed transaction (everything optional: we validate as we go)
// ---------------------------------------------------------------------------

interface RawTokenBalance {
  accountIndex?: unknown;
  mint?: unknown;
  owner?: unknown;
  uiTokenAmount?: { amount?: unknown; decimals?: unknown };
}
interface RawInstruction {
  programId?: unknown;
  program?: unknown;
  parsed?: unknown;
  accounts?: unknown;
  data?: unknown;
}
interface RawTx {
  slot?: unknown;
  blockTime?: unknown;
  meta?: {
    err?: unknown;
    fee?: unknown;
    preBalances?: unknown;
    postBalances?: unknown;
    preTokenBalances?: unknown;
    postTokenBalances?: unknown;
    logMessages?: unknown;
    innerInstructions?: unknown;
  } | null;
  transaction?: {
    signatures?: unknown;
    message?: { accountKeys?: unknown; instructions?: unknown };
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---------------------------------------------------------------------------
// Basic transaction facts
// ---------------------------------------------------------------------------

export interface TxBasics {
  signature: string;
  slot: number;
  /** Unix ms, null if the node did not give a block time. */
  blockTime: number | null;
  ok: boolean;
  feePayer: string;
  signers: string[];
  accountKeys: string[];
  feeLamports: number;
}

/** Signature, slot, time, success, fee payer and signers. Null if the shape is not a transaction. */
export function txBasics(raw: unknown): TxBasics | null {
  if (!isObj(raw)) return null;
  const tx = raw as RawTx;
  const meta = tx.meta;
  const slot = num(tx.slot);
  const sigs = tx.transaction?.signatures;
  const keys = tx.transaction?.message?.accountKeys;
  if (!isObj(meta) || slot === null || !Array.isArray(sigs) || !Array.isArray(keys)) return null;
  const signature = str(sigs[0]);
  if (!signature) return null;
  const accountKeys: string[] = [];
  const signers: string[] = [];
  for (const k of keys) {
    if (typeof k === "string") {
      accountKeys.push(k);
    } else if (isObj(k) && typeof k.pubkey === "string") {
      accountKeys.push(k.pubkey);
      if (k.signer === true) signers.push(k.pubkey);
    } else {
      return null;
    }
  }
  const feePayer = accountKeys[0];
  if (!feePayer) return null;
  if (signers.length === 0) signers.push(feePayer);
  const bt = num(tx.blockTime);
  return {
    signature,
    slot,
    blockTime: bt === null ? null : bt * 1000,
    ok: meta.err === null || meta.err === undefined,
    feePayer,
    signers,
    accountKeys,
    feeLamports: num(meta.fee) ?? 0,
  };
}

/** All instructions (top level first, then inner ones), with a flag for top level. */
function allInstructions(tx: RawTx): { ix: RawInstruction; topLevel: boolean }[] {
  const out: { ix: RawInstruction; topLevel: boolean }[] = [];
  const top = tx.transaction?.message?.instructions;
  if (Array.isArray(top)) for (const ix of top) if (isObj(ix)) out.push({ ix: ix as RawInstruction, topLevel: true });
  const inner = tx.meta?.innerInstructions;
  if (Array.isArray(inner)) {
    for (const group of inner) {
      if (!isObj(group) || !Array.isArray(group.instructions)) continue;
      for (const ix of group.instructions) if (isObj(ix)) out.push({ ix: ix as RawInstruction, topLevel: false });
    }
  }
  return out;
}

function logs(tx: RawTx): string[] {
  const l = tx.meta?.logMessages;
  return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : [];
}

// ---------------------------------------------------------------------------
// SOL transfers
// ---------------------------------------------------------------------------

export interface SolTransfer {
  from: string;
  to: string;
  lamports: number;
  sol: number;
  topLevel: boolean;
  /** "balance" = read from balance changes of a plain transfer transaction (see solMoves). */
  kind: "transfer" | "createAccount" | "balance";
}

/**
 * System-program SOL movements in a successful transaction: transfer, transferWithSeed, and
 * createAccount(WithSeed) when the new account stays a plain wallet (owner = System program).
 */
export function solTransfers(raw: unknown): SolTransfer[] {
  const basics = txBasics(raw);
  if (!basics || !basics.ok) return [];
  const out: SolTransfer[] = [];
  for (const { ix, topLevel } of allInstructions(raw as RawTx)) {
    if (ix.programId !== PROGRAMS.SYSTEM || !isObj(ix.parsed)) continue;
    const type = ix.parsed.type;
    const info = ix.parsed.info;
    if (!isObj(info)) continue;
    const lamports = num(info.lamports);
    if (lamports === null || lamports <= 0) continue;
    if (type === "transfer" || type === "transferWithSeed") {
      const from = str(info.source);
      const to = str(info.destination);
      if (from && to && from !== to) out.push({ from, to, lamports, sol: lamports / LAMPORTS_PER_SOL, topLevel, kind: "transfer" });
    } else if ((type === "createAccount" || type === "createAccountWithSeed") && info.owner === PROGRAMS.SYSTEM) {
      const from = str(info.source);
      const to = str(info.newAccount);
      if (from && to && from !== to) out.push({ from, to, lamports, sol: lamports / LAMPORTS_PER_SOL, topLevel, kind: "createAccount" });
    }
  }
  return out;
}

const MOVE_ONLY_PROGRAMS: ReadonlySet<string> = new Set([
  PROGRAMS.SYSTEM,
  PROGRAMS.TOKEN,
  PROGRAMS.TOKEN_2022,
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "ComputeBudget111111111111111111111111111111",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
]);

/**
 * True when the transaction only moves SOL / tokens around (System, Token, Associated Token,
 * Compute Budget, Memo programs, at any depth) and includes a System instruction. Funding a
 * wallet looks like this; tips and fees paid inside a trade (DEX / pump.fun programs) do not.
 */
export function isPlainTransferTx(raw: unknown): boolean {
  if (!txBasics(raw)) return false;
  let sawSystem = false;
  let any = false;
  for (const { ix } of allInstructions(raw as RawTx)) {
    if (typeof ix.programId !== "string" || !MOVE_ONLY_PROGRAMS.has(ix.programId)) return false;
    any = true;
    if (ix.programId === PROGRAMS.SYSTEM) sawSystem = true;
  }
  return any && sawSystem;
}

/**
 * SOL moves read from balance changes, for plain transfer transactions with exactly one sender.
 * This also catches the "temporary account" route launch factories use to hide a transfer:
 * create a throw-away wrapped-SOL account with lamports, then close it into the target wallet
 * (no System transfer to the target ever appears). Token accounts are left out on both sides.
 * Null when the picture is ambiguous (several senders).
 */
function balanceMoves(raw: unknown, basics: TxBasics): SolTransfer[] | null {
  const meta = (raw as RawTx).meta;
  const pre = meta?.preBalances;
  const post = meta?.postBalances;
  if (!Array.isArray(pre) || !Array.isArray(post) || pre.length !== basics.accountKeys.length || post.length !== pre.length) return null;
  const tokenAccounts = new Set<number>();
  for (const list of [meta?.preTokenBalances, meta?.postTokenBalances]) {
    if (!Array.isArray(list)) continue;
    for (const b of list) if (isObj(b) && typeof b.accountIndex === "number") tokenAccounts.add(b.accountIndex);
  }
  const senders: number[] = [];
  const receivers: { i: number; d: number }[] = [];
  for (let i = 0; i < pre.length; i++) {
    const a = num(pre[i]);
    const b = num(post[i]);
    if (a === null || b === null) return null;
    const d = b - a + (i === 0 ? basics.feeLamports : 0);
    if (d === 0 || tokenAccounts.has(i)) continue;
    if (d < 0) senders.push(i);
    else receivers.push({ i, d });
  }
  if (senders.length !== 1) return senders.length === 0 ? [] : null;
  const from = basics.accountKeys[senders[0] as number];
  if (!from) return null;
  const out: SolTransfer[] = [];
  for (const r of receivers) {
    const to = basics.accountKeys[r.i];
    if (to && to !== from) out.push({ from, to, lamports: r.d, sol: r.d / LAMPORTS_PER_SOL, topLevel: true, kind: "balance" });
  }
  return out;
}

/**
 * Every SOL move in a successful transaction: from balance changes for plain transfer
 * transactions (see balanceMoves), otherwise from System-program instructions.
 */
export function solMoves(raw: unknown): SolTransfer[] {
  const basics = txBasics(raw);
  if (!basics || !basics.ok) return [];
  if (isPlainTransferTx(raw)) {
    const moves = balanceMoves(raw, basics);
    if (moves) return moves;
  }
  return solTransfers(raw);
}

export interface Funding {
  funder: string;
  sol: number;
  /** Unix ms of the funding transaction (null if no block time). */
  at: number | null;
  signature: string;
  slot: number;
}

/**
 * The SOL funding of `wallet` in this transaction: the largest SOL move INTO the wallet from a
 * different account (System transfer, or a plain-transfer balance change). Null if there is none.
 * Moves below `minLamports` are ignored (e.g. 1-lamport "address poisoning" dust is never funding).
 */
export function findFunding(raw: unknown, wallet: string, minLamports = 0): Funding | null {
  const basics = txBasics(raw);
  if (!basics || !basics.ok) return null;
  let best: SolTransfer | null = null;
  for (const t of solMoves(raw)) {
    if (t.to !== wallet || t.from === wallet || t.lamports < minLamports) continue;
    if (!best || t.lamports > best.lamports) best = t;
  }
  if (!best) return null;
  return { funder: best.from, sol: best.sol, at: basics.blockTime, signature: basics.signature, slot: basics.slot };
}

/** Total SOL moved from `from` to `to` in this transaction. */
export function solSent(raw: unknown, from: string, to: string): number {
  let lamports = 0;
  for (const t of solMoves(raw)) if (t.from === from && t.to === to) lamports += t.lamports;
  return lamports / LAMPORTS_PER_SOL;
}

// ---------------------------------------------------------------------------
// pump.fun events (CreateEvent / TradeEvent), from self-CPI event instructions or "Program data:" logs
// ---------------------------------------------------------------------------

const eventDiscriminator = (name: string) => sha256(utf8(`event:${name}`)).subarray(0, 8);
const TRADE_EVENT = eventDiscriminator("TradeEvent");
const CREATE_EVENT = eventDiscriminator("CreateEvent");

export interface PumpTradeEvent {
  mint: string;
  user: string;
  isBuy: boolean;
  /** SOL moved into (buy) or out of (sell) the curve, in SOL. */
  sol: number;
  /** Raw token units (pump.fun coins have 6 decimals). */
  tokenAmountRaw: bigint;
  /** Unix ms from the event. */
  timestamp: number;
}

export interface PumpCreateEvent {
  name: string;
  symbol: string;
  mint: string;
  bondingCurve: string;
  /** Wallet that signed the create (the deployer). */
  user: string;
  /** Creator-fee recipient recorded at creation (null in older events). */
  creator: string | null;
  timestamp: number | null;
}

function readBorshString(bytes: Uint8Array, offset: number): { value: string; next: number } | null {
  if (offset + 4 > bytes.length) return null;
  const len = readU32LE(bytes, offset);
  if (len > 1000 || offset + 4 + len > bytes.length) return null;
  try {
    const value = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(offset + 4, offset + 4 + len));
    return { value, next: offset + 4 + len };
  } catch {
    return null;
  }
}

function decodeTradeEvent(b: Uint8Array): PumpTradeEvent | null {
  if (b.length < 97 || !startsWith(b, TRADE_EVENT)) return null;
  const flag = b[56];
  if (flag !== 0 && flag !== 1) return null;
  const solLamports = readU64LE(b, 40);
  const tokens = readU64LE(b, 48);
  const ts = Number(readI64LE(b, 89));
  return {
    mint: encodeBase58(b.subarray(8, 40)),
    sol: Number(solLamports) / LAMPORTS_PER_SOL,
    tokenAmountRaw: tokens,
    isBuy: flag === 1,
    user: encodeBase58(b.subarray(57, 89)),
    timestamp: ts * 1000,
  };
}

function decodeCreateEvent(b: Uint8Array): PumpCreateEvent | null {
  if (!startsWith(b, CREATE_EVENT)) return null;
  const name = readBorshString(b, 8);
  if (!name) return null;
  const symbol = readBorshString(b, name.next);
  if (!symbol) return null;
  const uri = readBorshString(b, symbol.next);
  if (!uri) return null;
  let o = uri.next;
  if (o + 96 > b.length) return null;
  const mint = encodeBase58(b.subarray(o, o + 32));
  const bondingCurve = encodeBase58(b.subarray(o + 32, o + 64));
  const user = encodeBase58(b.subarray(o + 64, o + 96));
  o += 96;
  let creator: string | null = null;
  let timestamp: number | null = null;
  if (o + 32 <= b.length) {
    creator = encodeBase58(b.subarray(o, o + 32));
    o += 32;
    if (o + 8 <= b.length) timestamp = Number(readI64LE(b, o)) * 1000;
  }
  return { name: name.value, symbol: symbol.value, mint, bondingCurve, user, creator, timestamp };
}

/** Raw event payloads emitted by the pump.fun program in this transaction. */
function pumpEventPayloads(tx: RawTx): Uint8Array[] {
  // 1) Self-CPI events (inner instruction to the pump program carrying the Anchor event tag).
  const fromIx: Uint8Array[] = [];
  const inner = tx.meta?.innerInstructions;
  if (Array.isArray(inner)) {
    for (const group of inner) {
      if (!isObj(group) || !Array.isArray(group.instructions)) continue;
      for (const ix of group.instructions) {
        if (!isObj(ix) || ix.programId !== PROGRAMS.PUMP || typeof ix.data !== "string") continue;
        const bytes = decodeBase58(ix.data);
        if (bytes && bytes.length > 16 && startsWith(bytes, ANCHOR_EVENT_IX_TAG)) fromIx.push(bytes.subarray(8));
      }
    }
  }
  if (fromIx.length > 0) return fromIx;
  // 2) "Program data:" log lines printed while the pump program is the innermost caller.
  const out: Uint8Array[] = [];
  const stack: string[] = [];
  for (const line of logs(tx)) {
    const invoke = /^Program (\w+) invoke/.exec(line);
    if (invoke?.[1]) {
      stack.push(invoke[1]);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (stack[stack.length - 1] === PROGRAMS.PUMP && line.startsWith("Program data: ")) {
      const bytes = base64ToBytes(line.slice("Program data: ".length));
      if (bytes) out.push(bytes);
    }
  }
  return out;
}

/** pump.fun trade and create events in a successful transaction. */
export function pumpEvents(raw: unknown): { trades: PumpTradeEvent[]; creates: PumpCreateEvent[] } {
  const basics = txBasics(raw);
  if (!basics || !basics.ok) return { trades: [], creates: [] };
  const trades: PumpTradeEvent[] = [];
  const creates: PumpCreateEvent[] = [];
  for (const payload of pumpEventPayloads(raw as RawTx)) {
    const t = decodeTradeEvent(payload);
    if (t) {
      trades.push(t);
      continue;
    }
    const c = decodeCreateEvent(payload);
    if (c) creates.push(c);
  }
  return { trades, creates };
}

/** True if the pump.fun program ran an instruction whose log name matches. */
function pumpInstructionLogged(tx: RawTx, pattern: RegExp): boolean {
  const stack: string[] = [];
  for (const line of logs(tx)) {
    const invoke = /^Program (\w+) invoke/.exec(line);
    if (invoke?.[1]) {
      stack.push(invoke[1]);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (stack[stack.length - 1] === PROGRAMS.PUMP && line.startsWith("Program log: Instruction: ")) {
      if (pattern.test(line.slice("Program log: Instruction: ".length))) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// pump.fun create detection
// ---------------------------------------------------------------------------

export interface PumpCreate {
  mint: string;
  /** Wallet that signed the create (from the CreateEvent, else the fee payer). */
  deployer: string;
  /** Creator-fee recipient recorded in the event (may differ from the deployer). */
  creatorField: string | null;
  name: string | null;
  symbol: string | null;
  /** SOL the deployer put into the curve inside this transaction (0 = no dev buy; null = unclear). */
  devBuySol: number | null;
  /** Whole tokens (6 decimals) the deployer bought inside this transaction. */
  devBuyTokens: number | null;
  signature: string;
  slot: number;
  createdAt: number | null;
}

/** A successful pump.fun "Create"/"CreateV2" transaction. Null for anything else. */
export function parsePumpCreate(raw: unknown): PumpCreate | null {
  const basics = txBasics(raw);
  if (!basics || !basics.ok) return null;
  const tx = raw as RawTx;
  if (!pumpInstructionLogged(tx, /^Create(V2)?$/)) return null;
  const { trades, creates } = pumpEvents(raw);
  const event = creates[0] ?? null;

  let mint = event?.mint ?? null;
  if (!mint) {
    // Fallback: the mint initialised in this transaction.
    for (const { ix } of allInstructions(tx)) {
      if (!isObj(ix.parsed)) continue;
      const t = ix.parsed.type;
      const info = ix.parsed.info;
      if ((t === "initializeMint" || t === "initializeMint2") && isObj(info) && typeof info.mint === "string") {
        mint = info.mint;
        break;
      }
    }
  }
  if (!mint) return null;
  const deployer = event?.user ?? basics.feePayer;

  let devBuySol: number | null = null;
  let devBuyTokens: number | null = null;
  const devTrades = trades.filter((t) => t.mint === mint && t.user === deployer && t.isBuy);
  if (devTrades.length > 0) {
    devBuySol = devTrades.reduce((s, t) => s + t.sol, 0);
    devBuyTokens = devTrades.reduce((s, t) => s + Number(t.tokenAmountRaw), 0) / 1e6;
  } else if (!pumpInstructionLogged(tx, /^Buy/)) {
    devBuySol = 0;
    devBuyTokens = 0;
  } else {
    // A buy ran but no event was readable: fall back to the deployer's token balance change.
    const delta = tokenDeltaByOwner(raw, mint).get(deployer);
    devBuyTokens = delta !== undefined && delta > 0 ? delta : null;
  }
  return {
    mint,
    deployer,
    creatorField: event?.creator ?? null,
    name: event?.name ?? null,
    symbol: event?.symbol ?? null,
    devBuySol,
    devBuyTokens,
    signature: basics.signature,
    slot: basics.slot,
    createdAt: basics.blockTime ?? event?.timestamp ?? null,
  };
}

// ---------------------------------------------------------------------------
// Token balances and trades of one mint
// ---------------------------------------------------------------------------

function tokenBalances(list: unknown, mint: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!isObj(item)) continue;
    const b = item as RawTokenBalance;
    if (b.mint !== mint || typeof b.owner !== "string") continue;
    const amount = typeof b.uiTokenAmount?.amount === "string" ? Number(b.uiTokenAmount.amount) : NaN;
    const decimals = typeof b.uiTokenAmount?.decimals === "number" ? b.uiTokenAmount.decimals : NaN;
    if (!Number.isFinite(amount) || !Number.isFinite(decimals)) continue;
    out.set(b.owner, (out.get(b.owner) ?? 0) + amount / 10 ** decimals);
  }
  return out;
}

/** Change of each owner's balance of `mint` in this transaction (whole tokens; + received, - sent). */
export function tokenDeltaByOwner(raw: unknown, mint: string): Map<string, number> {
  const out = new Map<string, number>();
  const basics = txBasics(raw);
  if (!basics || !basics.ok) return out;
  const meta = (raw as RawTx).meta;
  const pre = tokenBalances(meta?.preTokenBalances, mint);
  const post = tokenBalances(meta?.postTokenBalances, mint);
  for (const owner of new Set([...pre.keys(), ...post.keys()])) {
    const d = (post.get(owner) ?? 0) - (pre.get(owner) ?? 0);
    if (Math.abs(d) > 1e-12) out.set(owner, d);
  }
  return out;
}

/** SOL change of `wallet` (lamports + wrapped SOL), with the network fee added back if it paid it. */
function solDeltaOf(raw: unknown, basics: TxBasics, wallet: string): number {
  const meta = (raw as RawTx).meta;
  let lamports = 0;
  const idx = basics.accountKeys.indexOf(wallet);
  const pre = meta?.preBalances;
  const post = meta?.postBalances;
  if (idx >= 0 && Array.isArray(pre) && Array.isArray(post)) {
    const a = num(pre[idx]);
    const b = num(post[idx]);
    if (a !== null && b !== null) lamports = b - a;
  }
  if (wallet === basics.feePayer) lamports += basics.feeLamports;
  const wsolPre = tokenBalances(meta?.preTokenBalances, WSOL_MINT).get(wallet) ?? 0;
  const wsolPost = tokenBalances(meta?.postTokenBalances, WSOL_MINT).get(wallet) ?? 0;
  return lamports / LAMPORTS_PER_SOL + (wsolPost - wsolPre);
}

export interface WalletTrade {
  wallet: string;
  side: "buy" | "sell";
  /** Whole tokens bought or sold (positive). */
  tokens: number;
  /** SOL paid (buy) or received (sell); null if not measurable. */
  sol: number | null;
  source: "pump-event" | "balances";
}

/**
 * Buys and sells of `mint` in this transaction, per wallet.
 * pump.fun curve trades come from its TradeEvents (exact). Anything else (PumpSwap, Raydium, routers)
 * comes from token balance changes by owner: tokens up and SOL down = buy, tokens down and SOL up = sell.
 * A plain token transfer (no SOL moving the other way) is not a trade.
 */
export function mintTrades(raw: unknown, mint: string): WalletTrade[] {
  const basics = txBasics(raw);
  if (!basics || !basics.ok) return [];
  const pump = pumpEvents(raw).trades.filter((t) => t.mint === mint);
  if (pump.length > 0) {
    const byKey = new Map<string, WalletTrade>();
    for (const t of pump) {
      const side = t.isBuy ? "buy" : "sell";
      const key = `${t.user}:${side}`;
      const prev = byKey.get(key);
      const tokens = Number(t.tokenAmountRaw) / 1e6;
      if (prev) {
        prev.tokens += tokens;
        prev.sol = (prev.sol ?? 0) + t.sol;
      } else {
        byKey.set(key, { wallet: t.user, side, tokens, sol: t.sol, source: "pump-event" });
      }
    }
    return [...byKey.values()];
  }
  const out: WalletTrade[] = [];
  for (const [owner, delta] of tokenDeltaByOwner(raw, mint)) {
    // Only owners that are part of the transaction's account list can be measured for SOL.
    const sol = solDeltaOf(raw, basics, owner);
    if (delta > 0 && sol < 0) out.push({ wallet: owner, side: "buy", tokens: delta, sol: -sol, source: "balances" });
    else if (delta < 0 && sol > 0) out.push({ wallet: owner, side: "sell", tokens: -delta, sol, source: "balances" });
  }
  return out;
}

/** The buy or sell `wallet` made of `mint` in this transaction (null if it did neither). */
export function walletTrade(raw: unknown, mint: string, wallet: string): WalletTrade | null {
  const trades = mintTrades(raw, mint).filter((t) => t.wallet === wallet);
  if (trades.length === 0) return null;
  // If a wallet both bought and sold in one tx, report the larger side.
  return trades.reduce((a, b) => (b.tokens > a.tokens ? b : a));
}

/** Mints `wallet` sold in this transaction (used to spot dev sells across many coins). */
export function mintsSoldBy(raw: unknown, wallet: string): string[] {
  const basics = txBasics(raw);
  if (!basics || !basics.ok) return [];
  const sold = new Set<string>();
  for (const t of pumpEvents(raw).trades) if (t.user === wallet && !t.isBuy) sold.add(t.mint);
  const meta = (raw as RawTx).meta;
  const mints = new Set<string>();
  for (const list of [meta?.preTokenBalances, meta?.postTokenBalances]) {
    if (!Array.isArray(list)) continue;
    for (const b of list) if (isObj(b) && b.owner === wallet && typeof b.mint === "string" && b.mint !== WSOL_MINT) mints.add(b.mint);
  }
  for (const m of mints) {
    if (sold.has(m)) continue;
    const t = walletTrade(raw, m, wallet);
    if (t?.side === "sell") sold.add(m);
  }
  return [...sold];
}

export interface MintInit {
  mint: string;
  /** Fee payer of the transaction that created the mint. */
  payer: string;
  signature: string;
  slot: number;
  createdAt: number | null;
}

/** A successful transaction that initialised `mint` (any launchpad). Null otherwise. */
export function parseMintInit(raw: unknown, mint: string): MintInit | null {
  const basics = txBasics(raw);
  if (!basics || !basics.ok) return null;
  for (const { ix } of allInstructions(raw as RawTx)) {
    if (!isObj(ix.parsed)) continue;
    const t = ix.parsed.type;
    const info = ix.parsed.info;
    if ((t === "initializeMint" || t === "initializeMint2") && isObj(info) && info.mint === mint) {
      return { mint, payer: basics.feePayer, signature: basics.signature, slot: basics.slot, createdAt: basics.blockTime };
    }
  }
  return null;
}
