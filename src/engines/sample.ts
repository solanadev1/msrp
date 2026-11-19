/**
 * EXAMPLE STICKER for the /example page and visual tests.
 *
 * Everything here is made up: "Example Coin" (EXAMPLE) does not exist, and every address starts
 * with "Examp1e" and is padded to a syntactically valid base58 32-byte (or 64-byte signature)
 * string. The facts follow a launch-factory pattern so the example shows every section of the
 * sticker filled in. coverage.notes says "Example data, not a real coin".
 */
import type { CollectedFacts, EarlyBuyFact, HolderFact, LaunchFact, SiblingFact, Sticker, WalletOrigin } from "../types";
import { buildSticker } from "./sticker";

/** "Examp1e" + label, padded with "1" (base58 zero digits) to 44 chars (32 bytes) or 87 chars (64 bytes). */
function ex(label: string, length = 44): string {
  const s = `Examp1e${label}`;
  return s + "1".repeat(Math.max(0, length - s.length));
}

export const EXAMPLE_MINT = ex("CoinMint");
export const EXAMPLE_NOTE = "Example data, not a real coin";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Fixed times so the example never changes. */
const CREATED_AT = Date.UTC(2026, 9, 14, 15, 0, 0);
const COLLECTED_AT = CREATED_AT + 3 * 60 * MIN;
const CREATION_SLOT = 380_000_000;
const SUPPLY = 1_000_000_000;

const W = {
  deployer: ex("Dep1oyer"),
  funder: ex("MasterFunder"),
  curve: ex("BondingCurve"),
  relay: ex("Re1ay"),
  bundA: ex("BundA"),
  bundB: ex("BundB"),
  bundC: ex("BundC"),
  familyHolder: ex("FamiHo1der"),
  sniper: ex("Sniper"),
  sibA: ex("Sib1ingA"),
  sibB: ex("Sib1ingB"),
  sibC: ex("Sib1ingC"),
  sibD: ex("Sib1ingD"),
  tracedA: ex("TracedA"),
  tracedB: ex("TracedB"),
  tracedFunderA: ex("TracedFunderA"),
  tracedFunderB: ex("TracedFunderB"),
};

function fresh(wallet: string, funder: string, sol: number, minutesBefore: number, sigs: number): WalletOrigin {
  const at = CREATED_AT - minutesBefore * MIN;
  return {
    wallet,
    signaturesSampled: sigs,
    historyComplete: true,
    firstSeenAt: at,
    funder,
    fundedSol: sol,
    fundedAt: at,
    veteran: false,
  };
}

function veteran(wallet: string): WalletOrigin {
  return {
    wallet,
    signaturesSampled: 1000,
    historyComplete: false,
    firstSeenAt: null,
    funder: null,
    fundedSol: null,
    fundedAt: null,
    veteran: true,
  };
}

function partial(wallet: string): WalletOrigin {
  return {
    wallet,
    signaturesSampled: 400,
    historyComplete: false,
    firstSeenAt: CREATED_AT - 20 * DAY,
    funder: null,
    fundedSol: null,
    fundedAt: null,
    veteran: false,
  };
}

function holder(owner: string, pct: number, kind: HolderFact["kind"], origin: WalletOrigin | null): HolderFact {
  return {
    owner,
    tokenAccount: ex(`Ta${owner.slice(7, 15)}`),
    amount: (pct / 100) * SUPPLY,
    pctSupply: pct,
    kind,
    origin,
  };
}

/** Fresh copy of the example facts (callers may mutate it). */
export function exampleFacts(): CollectedFacts {
  let seq = 0;
  /** Base58 has no "0", so launch signatures are numbered with letters. */
  const launch = (deployer: string, mint: string, minutesBeforeExample: number, sellAfterMin: number | null): LaunchFact => {
    const letter = "ABCDEFGHJKLMNPQRSTUVWXYZ"[seq++ % 24] ?? "Z";
    return {
      mint,
      deployer,
      signature: ex(`Launch${letter}Sig`, 87),
      createdAt: CREATED_AT - minutesBeforeExample * MIN,
      slot: CREATION_SLOT - Math.round(minutesBeforeExample * 150),
      devBuySol: 1.2,
      firstDevSellAfterMin: sellAfterMin,
      devSold: sellAfterMin !== null,
    };
  };
  const deployerOrigin = fresh(W.deployer, W.funder, 1.5, 4, 9);

  const holders: HolderFact[] = [
    holder(W.curve, 58, "bonding-curve", null),
    holder(W.bundA, 4.8, "wallet", fresh(W.bundA, W.funder, 1.48, 6, 4)),
    holder(W.bundB, 3.9, "wallet", fresh(W.bundB, W.funder, 1.5, 6, 4)),
    holder(ex("VeteranA"), 3.2, "wallet", veteran(ex("VeteranA"))),
    holder(W.bundC, 3.1, "wallet", fresh(W.bundC, W.relay, 1.52, 5, 3)),
    holder(W.familyHolder, 2.6, "wallet", fresh(W.familyHolder, W.funder, 0.8, 2 * 60, 12)),
    holder(ex("VeteranB"), 2.4, "wallet", veteran(ex("VeteranB"))),
    holder(W.deployer, 2.1, "creator", deployerOrigin),
    holder(ex("VeteranC"), 1.9, "wallet", veteran(ex("VeteranC"))),
    holder(ex("UnknownA"), 1.8, "wallet", partial(ex("UnknownA"))),
    holder(ex("VeteranD"), 1.5, "wallet", veteran(ex("VeteranD"))),
    holder(W.tracedA, 1.4, "wallet", fresh(W.tracedA, W.tracedFunderA, 2.75, 40 * 24 * 60, 210)),
    holder(ex("VeteranE"), 1.2, "wallet", veteran(ex("VeteranE"))),
    holder(ex("UnknownB"), 1.1, "wallet", null),
    holder(ex("VeteranF"), 1.0, "wallet", veteran(ex("VeteranF"))),
    holder(W.tracedB, 0.9, "wallet", fresh(W.tracedB, W.tracedFunderB, 0.35, 9 * 24 * 60, 88)),
    holder(ex("UnknownC"), 0.7, "wallet", null),
    holder(ex("VeteranG"), 0.6, "wallet", veteran(ex("VeteranG"))),
    holder(ex("UnknownD"), 0.5, "wallet", partial(ex("UnknownD"))),
    holder(ex("VeteranH"), 0.4, "wallet", veteran(ex("VeteranH"))),
  ];

  const early = (wallet: string, slotsAfterCreate: number, pct: number, n: number): EarlyBuyFact => ({
    wallet,
    slot: CREATION_SLOT + slotsAfterCreate,
    signature: ex(`EarlyBuy${n}Sig`, 87),
    tokenAmount: (pct / 100) * SUPPLY,
    slotsAfterCreate,
  });
  const earlyBuys: EarlyBuyFact[] = [
    early(W.deployer, 0, 3.4, 1),
    early(W.bundA, 0, 4.8, 2),
    early(W.bundB, 0, 3.9, 3),
    early(W.bundC, 1, 3.1, 4),
    early(W.sniper, 1, 1.6, 5),
  ];

  const sibling = (wallet: string, sentBackSol: number, launches: LaunchFact[], minutesBefore: number): SiblingFact => ({
    wallet,
    fundedSol: 1.5,
    fundedAt: CREATED_AT - minutesBefore * MIN,
    launches,
    sentBackSol,
    signaturesSampled: 60,
  });
  const siblings: SiblingFact[] = [
    sibling(W.sibA, 1.2, [
      launch(W.sibA, ex("MintA1"), 6 * 24 * 60, 31),
      launch(W.sibA, ex("MintA2"), 5 * 24 * 60, 29),
      launch(W.sibA, ex("MintA3"), 4 * 24 * 60, 30),
      launch(W.sibA, ex("MintA4"), 3 * 24 * 60, 27),
    ], 6 * 24 * 60 + 5),
    sibling(W.sibB, 0.9, [
      launch(W.sibB, ex("MintB1"), 2 * 24 * 60, 30),
      launch(W.sibB, ex("MintB2"), 2 * 24 * 60 - 90, 26),
      launch(W.sibB, ex("MintB3"), 2 * 24 * 60 - 180, null),
    ], 2 * 24 * 60 + 6),
    sibling(W.sibC, 0.7, [
      launch(W.sibC, ex("MintC1"), 24 * 60, 28),
      launch(W.sibC, ex("MintC2"), 24 * 60 - 120, 30),
    ], 24 * 60 + 3),
    sibling(W.sibD, 0, [launch(W.sibD, ex("MintD1"), 10 * 60, null)], 10 * 60 + 4),
    sibling(W.bundA, 0, [], 6),
    sibling(W.bundB, 0, [], 6),
  ];

  return {
    coin: {
      mint: EXAMPLE_MINT,
      name: "Example Coin",
      symbol: "EXAMPLE",
      imageUrl: null,
      decimals: 6,
      supply: SUPPLY,
      launchpad: "pump.fun",
      bondingCurve: { address: W.curve, complete: false, progressPct: 38.4, realSolReserves: 31.2 },
      creator: W.deployer,
      createdAt: CREATED_AT,
      creationSlot: CREATION_SLOT,
      creationSignature: ex("CreateSig", 87),
      devBuySol: 1.2,
      mintAuthority: null,
      freezeAuthority: null,
      market: {
        priceUsd: 0.000048,
        marketCapUsd: 48_000,
        fdvUsd: 48_000,
        liquidityUsd: 9_800,
        volume24hUsd: 31_000,
        priceChange24hPct: -12.5,
        dex: "pumpfun",
        pairAddress: W.curve,
        pairUrl: null,
        pairCreatedAt: CREATED_AT,
      },
    },
    holders,
    earlyBuys,
    earlyBuysComplete: true,
    factory: {
      deployer: W.deployer,
      deployerOrigin,
      funder: W.funder,
      siblings,
      deployerLaunches: [
        launch(W.deployer, EXAMPLE_MINT, 0, null),
        launch(W.deployer, ex("MintE1"), 8 * 60, 12),
        launch(W.deployer, ex("MintE2"), 5 * 60, 28),
      ],
      deployerSentBackSol: 0.4,
      funderSignaturesSampled: 40,
      funderIsVeteran: false,
      deployerTokenTransfers: [],
      traceComplete: true,
    },
    coverage: {
      rpcRequests: 31,
      dexRequests: 1,
      notes: [EXAMPLE_NOTE],
      complete: true,
      elapsedMs: 6_400,
    },
    collectedAt: COLLECTED_AT,
  };
}

/** The example sticker: buildSticker run on exampleFacts(). Clearly marked as example data. */
export function sampleSticker(): Sticker {
  return buildSticker(exampleFacts());
}
