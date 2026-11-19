import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  CoinFacts,
  CollectedFacts,
  EarlyBuyFact,
  FactoryFacts,
  Finding,
  HolderFact,
  LaunchFact,
  MarketFacts,
  Rating,
  SiblingFact,
  Sticker,
  WalletOrigin,
} from "../src/types";
import { DISCLAIMER, LIMITS, THRESHOLDS } from "../src/config";
import { buildSticker, stickerPrice } from "../src/engines/sticker";
import { analyzeCrowd, crowdInputFromFacts, similarFunding, type CrowdInput } from "../src/engines/crowd";
import { analyzeBuild } from "../src/engines/build";
import { analyzeMarket } from "../src/engines/market";
import {
  rateCrowd,
  rateMarket,
  rateOverall,
  starsFromInsiderPct,
  starsFromLiquidityPct,
  starsFromSigns,
} from "../src/engines/ratings";
import { sortFindings } from "../src/engines/findings";
import { METHODOLOGY } from "../src/engines/methodology";
import { ENGINE_RULES } from "../src/engines/rules";
import { EXAMPLE_MINT, EXAMPLE_NOTE, exampleFacts, sampleSticker } from "../src/engines/sample";
import { fmtMinutes, fmtPct, fmtSol, fmtUsd } from "../src/engines/format";

// ---------------------------------------------------------------------------------------------
// Builders (hand-made facts; no network)
// ---------------------------------------------------------------------------------------------

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);
const MINT = "MintCoin";
const CREATOR = "Creator";

function origin(wallet: string, o: Partial<WalletOrigin> = {}): WalletOrigin {
  return {
    wallet,
    signaturesSampled: 50,
    historyComplete: true,
    firstSeenAt: T0 - 30 * DAY,
    funder: `F-${wallet}`,
    fundedSol: 2,
    fundedAt: T0 - 30 * DAY,
    veteran: false,
    ...o,
  };
}
const veteranOrigin = (wallet: string): WalletOrigin =>
  origin(wallet, { veteran: true, historyComplete: false, funder: null, fundedSol: null, fundedAt: null, signaturesSampled: 1000 });
const freshOrigin = (wallet: string, funder: string | null, sol: number, minutesBefore: number): WalletOrigin =>
  origin(wallet, { funder, fundedSol: sol, fundedAt: T0 - minutesBefore * MIN, firstSeenAt: T0 - minutesBefore * MIN });
const partialOrigin = (wallet: string): WalletOrigin =>
  origin(wallet, { historyComplete: false, funder: null, fundedSol: null, fundedAt: null, signaturesSampled: 300 });

function h(owner: string, pct: number, kind: HolderFact["kind"] = "wallet", o: WalletOrigin | null = null): HolderFact {
  return { owner, tokenAccount: `ta-${owner}`, amount: pct * 1e7, pctSupply: pct, kind, origin: o };
}

function market(o: Partial<MarketFacts> = {}): MarketFacts {
  return {
    priceUsd: 0.002,
    marketCapUsd: 2_000_000,
    fdvUsd: 2_000_000,
    liquidityUsd: 300_000,
    volume24hUsd: 500_000,
    priceChange24hPct: 3,
    dex: "pumpswap",
    pairAddress: "Pair1",
    pairUrl: "https://dexscreener.com/solana/pair1",
    pairCreatedAt: T0,
    ...o,
  };
}

function coin(o: Partial<CoinFacts> = {}): CoinFacts {
  return {
    mint: MINT,
    name: "Test Coin",
    symbol: "TEST",
    imageUrl: null,
    decimals: 6,
    supply: 1_000_000_000,
    launchpad: "pump.fun",
    bondingCurve: { address: "Curve1", complete: true, progressPct: 100, realSolReserves: 0 },
    creator: CREATOR,
    createdAt: T0,
    creationSlot: 1_000,
    creationSignature: "CreateSig",
    devBuySol: 0.5,
    mintAuthority: null,
    freezeAuthority: null,
    market: market(),
    ...o,
  };
}

function launch(mint: string, deployer: string, sellMin: number | null): LaunchFact {
  return {
    mint,
    deployer,
    signature: `sig-${mint}`,
    createdAt: T0,
    slot: 1,
    devBuySol: 1,
    firstDevSellAfterMin: sellMin,
    devSold: sellMin !== null,
  };
}

function sibling(wallet: string, launches: LaunchFact[], sentBackSol = 0): SiblingFact {
  return { wallet, fundedSol: 1.5, fundedAt: T0 - 60 * MIN, launches, sentBackSol, signaturesSampled: 60 };
}

function factory(o: Partial<FactoryFacts> = {}): FactoryFacts {
  return {
    deployer: CREATOR,
    deployerOrigin: origin(CREATOR, { funder: "CreatorFunder", fundedSol: 3, fundedAt: T0 - 5 * DAY }),
    funder: "CreatorFunder",
    siblings: [],
    deployerLaunches: [launch(MINT, CREATOR, null)],
    deployerSentBackSol: 0,
    funderSignaturesSampled: 40,
    funderIsVeteran: false,
    ...o,
  };
}

function facts(o: Partial<CollectedFacts> = {}): CollectedFacts {
  return {
    coin: coin(),
    holders: [],
    earlyBuys: [],
    factory: factory(),
    coverage: { rpcRequests: 20, dexRequests: 1, notes: [], complete: true, elapsedMs: 4000 },
    collectedAt: T0 + 30 * DAY,
    ...o,
  };
}

function early(wallet: string, slotsAfterCreate: number): EarlyBuyFact {
  return { wallet, slot: 1_000 + slotsAfterCreate, signature: `eb-${wallet}`, tokenAmount: 1, slotsAfterCreate };
}

/** A coin with nothing to hide: graduated, pool 30%, 19 independent wallets of 2% each. */
function cleanFacts(): CollectedFacts {
  const holders: HolderFact[] = [h("Pool", 30, "pool")];
  for (let i = 1; i <= 19; i++) {
    const w = `W${String(i).padStart(2, "0")}`;
    holders.push(h(w, 2, "wallet", i % 2 === 0 ? veteranOrigin(w) : origin(w)));
  }
  return facts({ holders });
}

/** Factory pattern: fresh deployer, family of 4 with many fast sells, sweeps. */
function factoryFacts(): CollectedFacts {
  const f = factory({
    deployerOrigin: freshOrigin(CREATOR, "Master", 1.5, 4),
    funder: "Master",
    siblings: [
      sibling("SibA", [launch("A1", "SibA", 10), launch("A2", "SibA", 25), launch("A3", "SibA", 45)], 1.2),
      sibling("SibB", [launch("B1", "SibB", 30), launch("B2", "SibB", null)], 0.8),
      sibling("SibC", [launch("C1", "SibC", 5)], 0.5),
    ],
    deployerLaunches: [launch(MINT, CREATOR, 20), launch("D1", CREATOR, 12)],
    deployerSentBackSol: 0.5,
  });
  const holders: HolderFact[] = [
    h("Curve1", 60, "bonding-curve"),
    h(CREATOR, 6, "creator", f.deployerOrigin),
    h("SibA", 4, "wallet", null),
    h("V1", 3, "wallet", veteranOrigin("V1")),
    h("V2", 3, "wallet", veteranOrigin("V2")),
    h("V3", 3, "wallet", veteranOrigin("V3")),
  ];
  return facts({
    coin: coin({ bondingCurve: { address: "Curve1", complete: false, progressPct: 40, realSolReserves: 30 } }),
    holders,
    factory: f,
  });
}

/** Bundle: four wallets (long histories, different funders) bought in the creation block / next. */
function bundleFacts(): CollectedFacts {
  const holders: HolderFact[] = [
    h("Curve1", 50, "bonding-curve"),
    h("B1", 7, "wallet", veteranOrigin("B1")),
    h("B2", 6, "wallet", veteranOrigin("B2")),
    h("B3", 6, "wallet", origin("B3")),
    h("B4", 5, "wallet", origin("B4")),
    h(CREATOR, 1, "creator", null),
  ];
  for (let i = 1; i <= 10; i++) holders.push(h(`V${i}`, 1, "wallet", veteranOrigin(`V${i}`)));
  return facts({
    coin: coin({ bondingCurve: { address: "Curve1", complete: false, progressPct: 55, realSolReserves: 40 } }),
    holders,
    earlyBuys: [early(CREATOR, 0), early("B1", 0), early("B2", 0), early("B3", 1), early("B4", 1), early("Late", 2)],
  });
}

/** Unknown-heavy: no trace, no creation slot, most holders untraceable. */
function unknownFacts(): CollectedFacts {
  const holders: HolderFact[] = [h("Curve1", 40, "bonding-curve")];
  for (let i = 1; i <= 12; i++) holders.push(h(`U${i}`, 4, "wallet", i % 3 === 0 ? partialOrigin(`U${i}`) : null));
  holders.push(h("V1", 2, "wallet", veteranOrigin("V1")));
  return facts({
    coin: coin({ creationSlot: null, createdAt: null, devBuySol: null }),
    holders,
    factory: null,
  });
}

function crowdInput(o: Partial<CrowdInput> = {}): CrowdInput {
  return {
    holders: [],
    earlyBuys: [],
    creator: CREATOR,
    supply: 1_000_000_000,
    createdAt: T0,
    earlyBuysChecked: true,
    creatorOrigin: null,
    creatorFunder: null,
    familyWallets: [],
    ignoredFunders: [],
    ...o,
  };
}

const byId = (s: Sticker, id: string): Finding | undefined => s.findings.find((f) => f.id === id);
const holderView = (s: Sticker, owner: string) => s.crowd.topHolders.find((v) => v.owner === owner);

/** Every number in the object is finite; no undefined anywhere. */
function assertClean(value: unknown, path = "sticker"): void {
  if (value === undefined) assert.fail(`${path} is undefined`);
  if (typeof value === "number") assert.ok(Number.isFinite(value), `${path} = ${value}`);
  if (Array.isArray(value)) value.forEach((v, i) => assertClean(v, `${path}[${i}]`));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertClean(v, `${path}.${k}`);
  }
}

const BANNED = [/\bscam/i, /\brug/i, /\bsafe/i, /buy now/i, /\bmoon/i, /guaranteed?\b/i, /sell signal/i, /\bscammer/i];

function texts(s: Sticker): string[] {
  return [
    ...s.findings.flatMap((f) => [f.title, f.detail]),
    ...Object.values(s.ratings).map((r: Rating) => r.reason),
  ];
}

function assertNeutral(lines: string[]): void {
  for (const line of lines) {
    for (const re of BANNED) assert.ok(!re.test(line), `banned wording ${re} in: ${line}`);
    assert.ok(!/NaN|undefined|Infinity|null/.test(line), `leaked value in: ${line}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

describe("clean coin", () => {
  const s = buildSticker(cleanFacts());

  it("gets high stars everywhere", () => {
    assert.equal(s.ratings.build.stars, 5);
    assert.equal(s.ratings.crowd.stars, 5);
    assert.equal(s.ratings.market.stars, 5);
    assert.equal(s.ratings.overall.stars, 5);
    assert.match(s.ratings.overall.reason, /Lowest section rating/);
  });

  it("computes shares on the documented bases", () => {
    assert.equal(s.crowd.infrastructurePct, 30);
    assert.equal(s.crowd.top10Pct, 20);
    assert.equal(s.headline.insiderPct, 0);
    // 38% of total supply, out of 70% circulating.
    assert.equal(s.headline.independentPct, 54.29);
    assert.equal(s.headline.stickerPriceUsd, 760_000);
    assert.equal(s.headline.marketCapUsd, 2_000_000);
    assert.equal(s.crowd.clusters.length, 0);
    assert.equal(s.crowd.clusteredPct, 0);
    assert.equal(s.crowd.bundlePct, 0);
  });

  it("does not claim the creator holds zero when it is just outside a full top-20 list", () => {
    assert.equal(s.crowd.creatorPct, null);
    const f = byId(s, "crowd.creator");
    assert.ok(f);
    assert.match(f.title, /not among the top 20/);
    assert.match(f.detail, /less than 2%/);
  });

  it("reports good findings and no danger", () => {
    for (const id of ["build.no-factory-signs", "crowd.no-links", "crowd.no-bundle", "build.mint-authority"]) {
      assert.equal(byId(s, id)?.severity, "good", id);
    }
    assert.ok(!s.findings.some((f) => f.severity === "danger"));
    assert.equal(holderView(s, "Pool")?.label, "infrastructure");
    assert.ok(s.crowd.topHolders.filter((v) => v.kind === "wallet").every((v) => v.label === "independent"));
  });

  it("passes through identity, coverage and disclaimer", () => {
    const f = cleanFacts();
    const st = buildSticker(f);
    assert.equal(st.version, 1);
    assert.equal(st.mint, MINT);
    assert.equal(st.computedAt, f.collectedAt);
    assert.equal(st.disclaimer, DISCLAIMER);
    assert.deepEqual(st.coverage, f.coverage);
    st.coverage.notes.push("mutated");
    assert.equal(f.coverage.notes.length, 0, "coverage is copied, not shared");
    assert.equal(st.build.graduated, true);
    assert.equal(st.build.familySize, 1);
    assert.equal(st.build.deployerLaunchCount, 1);
    assertClean(st);
  });
});

describe("factory coin", () => {
  const s = buildSticker(factoryFacts());

  it("rebuilds the family", () => {
    assert.equal(s.build.deployer, CREATOR);
    assert.equal(s.build.funder, "Master");
    assert.equal(s.build.deployerFundedBeforeLaunchMin, 4);
    assert.equal(s.build.deployerLaunchCount, 2);
    assert.equal(s.build.familySize, 4);
    assert.equal(s.build.familyLaunchCount, 8);
    // MINT(20) D1(12) A1(10) A2(25) B1(30) C1(5) -> 6; A3(45) and B2(no sell) are not fast.
    assert.equal(s.build.familyFastDevSellCount, 6);
    assert.equal(s.build.sentBackToFunderSol, 3);
    assert.deepEqual(
      s.build.family.map((m) => [m.role, m.wallet, m.launches, m.launchesWithFastDevSell]),
      [
        ["funder", "Master", 0, 0],
        ["deployer", CREATOR, 2, 2],
        ["sibling", "SibA", 3, 2],
        ["sibling", "SibB", 2, 1],
        ["sibling", "SibC", 1, 1],
      ],
    );
  });

  it("rates the build 1 star and caps overall", () => {
    assert.equal(s.ratings.build.stars, 1);
    assert.match(s.ratings.build.reason, /^4 signs found: deployer funded 4 minutes before launch;/);
    assert.ok((s.ratings.overall.stars ?? 99) <= ENGINE_RULES.DANGER_MAX_STARS);
  });

  it("explains each sign with neutral findings", () => {
    const fp = byId(s, "build.factory-pattern");
    assert.equal(fp?.severity, "danger");
    assert.equal(fp?.title, "4 linked wallets launched 8 coins");
    assert.match(fp?.detail ?? "", /pattern consistent with an automated launch operation/);
    assert.match(byId(s, "build.fresh-deployer")?.title ?? "", /funded 4 minutes before launch/);
    assert.equal(byId(s, "build.fast-dev-sells")?.title, "6 of 8 launches had a dev sell within 30 minutes");
    assert.equal(byId(s, "build.sweep")?.title, "3 SOL sent back to the funder");
    assert.deepEqual(byId(s, "build.sweep")?.evidence, [CREATOR, "SibA", "SibB", "SibC", "Master"]);
    assert.equal(byId(s, "build.current-dev-sell")?.severity, "warning");
    assert.match(byId(s, "build.current-dev-sell")?.title ?? "", /20 minutes after launch/);
  });

  it("links the sibling holder to the creator through the shared funder", () => {
    assert.equal(s.crowd.clusters.length, 1);
    const c = s.crowd.clusters[0];
    assert.ok(c);
    assert.deepEqual(c.wallets, [CREATOR, "SibA"]);
    assert.deepEqual(c.reasons, ["shared-funder"]);
    assert.equal(c.funder, "Master");
    assert.equal(c.pctSupply, 10);
    assert.equal(holderView(s, "SibA")?.label, "insider");
    assert.equal(holderView(s, "SibA")?.funder, "Master");
    // insiders 10 of 40 circulating
    assert.equal(s.headline.insiderPct, 25);
    assert.equal(s.ratings.crowd.stars, 3);
  });

  it("ignores the family when the funder is a long-history wallet", () => {
    const f = factoryFacts();
    if (f.factory) f.factory.funderIsVeteran = true;
    const st = buildSticker(f);
    assert.equal(st.build.familySize, 1);
    assert.equal(st.build.familyLaunchCount, 2);
    assert.equal(st.build.sentBackToFunderSol, 0.5);
    assert.ok(byId(st, "build.funder-veteran"));
    assert.equal(holderView(st, "SibA")?.label, "unknown");
    assert.equal(st.crowd.clusters.length, 0);
  });
});

describe("bundle coin", () => {
  const s = buildSticker(bundleFacts());

  it("measures same-block buyers still holding (creator excluded)", () => {
    assert.equal(s.crowd.bundlePct, 24);
    const f = byId(s, "crowd.bundle");
    assert.equal(f?.severity, "warning");
    assert.match(f?.detail ?? "", /^4 wallets bought in the creation block or the next one/);
    assert.ok(f?.evidence.includes("Late") === false, "slot +2 is outside the bundle window");
  });

  it("links the bundle and labels it insider", () => {
    const c = s.crowd.clusters[0];
    assert.ok(c);
    assert.deepEqual(c.reasons, ["same-block-buy"]);
    assert.deepEqual([...c.wallets].sort(), ["B1", "B2", "B3", "B4"]);
    for (const w of ["B1", "B2", "B3", "B4", CREATOR]) assert.equal(holderView(s, w)?.label, "insider", w);
    // pure same-block cluster is described by crowd.bundle, not a second finding
    assert.equal(byId(s, "crowd.cluster.c1"), undefined);
  });

  it("insiders at half of circulating supply is danger, 1 crowd star, overall capped", () => {
    assert.equal(s.headline.insiderPct, 50);
    assert.equal(byId(s, "crowd.insiders")?.severity, "danger");
    assert.equal(s.ratings.crowd.stars, 1);
    assert.equal(s.ratings.overall.stars, 1);
  });
});

describe("unknown-heavy coin", () => {
  const s = buildSticker(unknownFacts());

  it("does not rate what it could not see", () => {
    assert.equal(s.ratings.build.stars, null);
    assert.equal(s.ratings.crowd.stars, null);
    assert.equal(s.ratings.overall.stars, null);
    assert.match(s.ratings.build.reason, /^Not rated/);
    assert.match(s.ratings.crowd.reason, /^Not rated/);
    assert.match(s.ratings.overall.reason, /^Not rated: the build and crowd section/);
  });

  it("fabricates no numbers", () => {
    assert.equal(s.headline.independentPct, null);
    assert.equal(s.headline.insiderPct, null);
    assert.equal(s.headline.stickerPriceUsd, null);
    assert.equal(s.crowd.bundlePct, null);
    assert.equal(s.build.deployerFundedBeforeLaunchMin, null);
    assert.equal(s.build.funder, null);
    assert.equal(s.build.devBuySol, null);
    assert.equal(s.build.createdAt, null);
    assertClean(s);
  });

  it("labels untraced wallets unknown and says so", () => {
    const unknown = s.crowd.topHolders.filter((v) => v.label === "unknown");
    assert.equal(unknown.length, 12);
    assert.equal(holderView(s, "V1")?.label, "independent");
    assert.equal(byId(s, "crowd.untraced")?.title, "Couldn't trace 12 of 13 holders");
    assert.equal(byId(s, "crowd.untraced")?.severity, "unknown");
    assert.ok(byId(s, "build.trace-missing"));
    assert.ok(byId(s, "crowd.bundle-unknown"));
  });

  it("can still rate low from insiders it did find, without inventing headline shares", () => {
    const f = unknownFacts();
    f.holders[0] = h("Curve1", 10, "bonding-curve");
    f.holders.push(h(CREATOR, 30, "creator", null));
    const st = buildSticker(f);
    assert.equal(st.crowd.creatorPct, 30);
    // 30 of 90 circulating is at least 33%: 2 stars, even though most wallets are untraced.
    assert.equal(st.ratings.crowd.stars, 2);
    assert.match(st.ratings.crowd.reason, /at least/);
    assert.equal(st.headline.insiderPct, null);
    assert.equal(st.headline.stickerPriceUsd, null);
    assert.match(byId(st, "crowd.insiders")?.title ?? "", /at least/);
  });

  it("with no holders at all, every crowd number is null", () => {
    const st = buildSticker(facts({ holders: [] }));
    assert.equal(st.crowd.holdersAnalyzed, 0);
    for (const k of ["creatorPct", "bundlePct", "clusteredPct", "infrastructurePct", "top10Pct"] as const) {
      assert.equal(st.crowd[k], null, k);
    }
    assert.equal(st.ratings.crowd.stars, null);
    assert.ok(byId(st, "crowd.no-holders"));
  });
});

describe("zero / NaN guards", () => {
  function brokenFacts(): CollectedFacts {
    const f = facts({
      coin: coin({
        supply: 0,
        createdAt: Number.NaN,
        creationSlot: Number.NaN,
        devBuySol: Number.NaN,
        bondingCurve: { address: "C", complete: false, progressPct: Number.NaN, realSolReserves: Number.NaN },
        market: market({
          marketCapUsd: Number.NaN,
          liquidityUsd: -1,
          volume24hUsd: Number.POSITIVE_INFINITY,
          priceUsd: 0,
          priceChange24hPct: Number.NaN,
        }),
      }),
      holders: [
        h("Curve1", Number.NaN, "bonding-curve"),
        { ...h("X1", Number.NaN), amount: Number.NaN },
        h("X2", -5, "wallet", origin("X2", { fundedSol: Number.NaN, fundedAt: Number.NaN })),
        h("X3", 150, "wallet", veteranOrigin("X3")),
        h("X4", 10, "wallet", origin("X4")),
      ],
      earlyBuys: [early("X4", Number.NaN)],
      factory: factory({
        deployerOrigin: origin(CREATOR, { fundedAt: Number.NaN, signaturesSampled: Number.NaN }),
        deployerSentBackSol: Number.NaN,
        siblings: [sibling("S1", [launch("M1", "S1", Number.NaN)], -3)],
      }),
      collectedAt: Number.NaN,
    });
    return f;
  }

  it("never emits NaN, Infinity or undefined", () => {
    const s = buildSticker(brokenFacts());
    assertClean(s);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    assertNeutral(texts(s));
  });

  it("treats unreadable values as unknown, not zero", () => {
    const s = buildSticker(brokenFacts());
    assert.equal(s.headline.marketCapUsd, null);
    assert.equal(s.headline.stickerPriceUsd, null);
    assert.equal(s.market?.liquidityUsd, null);
    assert.equal(s.market?.volume24hUsd, null);
    assert.equal(s.market?.priceUsd, null);
    assert.equal(s.ratings.market.stars, null);
    assert.equal(s.build.curveProgressPct, null);
    assert.equal(s.build.sentBackToFunderSol, 0);
    assert.equal(s.build.familyFastDevSellCount, 0);
    assert.equal(s.computedAt, 0);
    assert.ok(byId(s, "crowd.unreadable"), "unreadable holders are reported");
    assert.ok(byId(s, "crowd.scaled"), "shares above 100% are scaled down");
    const total = s.crowd.topHolders.reduce((a, v) => a + v.pctSupply, 0);
    assert.ok(total <= 100.05, `total ${total}`);
  });

  it("stickerPrice guards its inputs", () => {
    assert.equal(stickerPrice(null, 50), null);
    assert.equal(stickerPrice(1000, null), null);
    assert.equal(stickerPrice(Number.NaN, 50), null);
    assert.equal(stickerPrice(1000, 150), 1000);
    assert.equal(stickerPrice(1000, 12.5), 125);
  });

  it("formatters never print raw floats", () => {
    assert.equal(fmtPct(0.004), "<0.01%");
    assert.equal(fmtPct(12.345), "12.35%");
    assert.equal(fmtSol(0.0004), "<0.001 SOL");
    assert.equal(fmtUsd(48000.4), "$48,000");
    assert.equal(fmtUsd(1234567), "$1,234,567");
    assert.equal(fmtUsd(0.5), "$0.50");
    assert.equal(fmtMinutes(0.3), "under 1 minute");
    assert.equal(fmtMinutes(1), "1 minute");
    assert.equal(fmtMinutes(4.25), "4.3 minutes");
    assert.equal(fmtMinutes(180), "3 hours");
    assert.equal(fmtMinutes(5 * 24 * 60), "5 days");
  });
});

describe("no-market coin", () => {
  const s = buildSticker(facts({ ...cleanFacts(), coin: coin({ market: null }) }));

  it("leaves market unrated and overall from build + crowd", () => {
    assert.equal(s.market, null);
    assert.equal(s.ratings.market.stars, null);
    assert.equal(s.headline.marketCapUsd, null);
    assert.equal(s.headline.stickerPriceUsd, null);
    assert.equal(s.headline.independentPct, 54.29, "ownership shares do not depend on market data");
    assert.equal(s.ratings.overall.stars, 5);
    assert.equal(byId(s, "market.no-data")?.severity, "unknown");
  });
});

describe("graduated coin with pool holding", () => {
  const f = cleanFacts();
  f.holders = [
    h("PoolVault", 25, "pool"),
    h("Incinerator", 5, "burn"),
    h("SomePda", 2, "program"),
    h("Big", 8, "wallet", veteranOrigin("Big")),
    ...Array.from({ length: 12 }, (_, i) => h(`G${i}`, 3, "wallet", origin(`G${i}`))),
  ];
  const s = buildSticker(f);

  it("treats pools, burn and program accounts as infrastructure", () => {
    assert.equal(s.crowd.infrastructurePct, 32);
    for (const w of ["PoolVault", "Incinerator", "SomePda"]) assert.equal(holderView(s, w)?.label, "infrastructure");
    assert.equal(s.crowd.top10Pct, 35, "top 10 excludes infrastructure");
    assert.equal(s.build.graduated, true);
    assert.ok(byId(s, "market.graduated"));
    assert.match(byId(s, "crowd.infrastructure")?.title ?? "", /32% sits in trading pools, the burn address and program accounts/);
  });

  it("uses the complete list to say the creator holds nothing", () => {
    assert.equal(s.crowd.creatorPct, 0);
    assert.equal(byId(s, "crowd.creator")?.title, "Creator holds none of the supply");
  });

  it("caps crowd stars for a single large wallet", () => {
    assert.equal(s.crowd.topHolders.find((v) => v.owner === "Big")?.label, "independent");
    assert.equal(s.ratings.crowd.stars, ENGINE_RULES.CONCENTRATION_MAX_STARS);
    assert.match(s.ratings.crowd.reason, /capped at 3 stars/);
    assert.ok(byId(s, "crowd.concentration"));
  });
});

// ---------------------------------------------------------------------------------------------
// Crowd linking rules
// ---------------------------------------------------------------------------------------------

describe("crowd linking rules", () => {
  const fresh = (w: string, funder: string, sol: number, minutesBefore: number) =>
    h(w, 5, "wallet", freshOrigin(w, funder, sol, minutesBefore));

  it("similar funding links brand-new wallets funded in the same hour", () => {
    const c = analyzeCrowd(crowdInput({ holders: [fresh("A", "FA", 1.0, 30), fresh("B", "FB", 1.05, 10)] }));
    assert.equal(c.clusters.length, 1);
    assert.deepEqual(c.clusters[0]?.reasons, ["similar-funding"]);
  });

  for (const [name, b] of [
    ["funded 3 hours apart", fresh("B", "FB", 1.05, 210)],
    ["amounts 17% apart", fresh("B", "FB", 1.2, 10)],
    ["funded days before creation", h("B", 5, "wallet", freshOrigin("B", "FB", 1.0, 3 * 24 * 60))],
    ["incomplete history", h("B", 5, "wallet", { ...freshOrigin("B", "FB", 1.0, 10), historyComplete: false })],
    ["veteran", h("B", 5, "wallet", { ...freshOrigin("B", "FB", 1.0, 10), veteran: true })],
  ] as const) {
    it(`similar funding does not link: ${name}`, () => {
      const c = analyzeCrowd(crowdInput({ holders: [fresh("A", "FA", 1.0, 30), b] }));
      assert.equal(c.clusters.length, 0);
    });
  }

  it("similar funding needs the creation time", () => {
    const c = analyzeCrowd(crowdInput({ createdAt: null, holders: [fresh("A", "FA", 1.0, 30), fresh("B", "FB", 1.0, 30)] }));
    assert.equal(c.clusters.length, 0);
  });

  it("similarFunding uses the larger amount as the base", () => {
    assert.equal(similarFunding({ sol: 1, at: 0 }, { sol: 1.1, at: 0 }), true);
    assert.equal(similarFunding({ sol: 1, at: 0 }, { sol: 1.12, at: 0 }), false);
    assert.equal(similarFunding({ sol: 1, at: 0 }, { sol: 1, at: 61 * MIN }), false);
  });

  it("shared funder forms a cluster naming the funder", () => {
    const c = analyzeCrowd(
      crowdInput({ holders: [h("A", 5, "wallet", origin("A", { funder: "F" })), h("B", 3, "wallet", origin("B", { funder: "F" }))] }),
    );
    assert.equal(c.clusters.length, 1);
    assert.equal(c.clusters[0]?.funder, "F");
    assert.equal(c.clusters[0]?.pctSupply, 8);
    assert.deepEqual(c.clusters[0]?.wallets, ["A", "B"]);
  });

  it("a holder that funded another holder joins its group", () => {
    const c = analyzeCrowd(crowdInput({ holders: [h("A", 5, "wallet", origin("A")), h("B", 3, "wallet", origin("B", { funder: "A" }))] }));
    assert.deepEqual(c.clusters[0]?.wallets, ["A", "B"]);
  });

  it("a long-history holder is never used as a funder link (could be an exchange)", () => {
    const c = analyzeCrowd(
      crowdInput({
        holders: [
          h("Ex", 6, "wallet", veteranOrigin("Ex")),
          h("A", 5, "wallet", origin("A", { funder: "Ex" })),
          h("B", 3, "wallet", origin("B", { funder: "Ex" })),
        ],
      }),
    );
    assert.equal(c.clusters.length, 0);
  });

  it("ignored funders never link", () => {
    const c = analyzeCrowd(
      crowdInput({
        ignoredFunders: ["F"],
        holders: [h("A", 5, "wallet", origin("A", { funder: "F" })), h("B", 3, "wallet", origin("B", { funder: "F" }))],
      }),
    );
    assert.equal(c.clusters.length, 0);
  });

  it("creator-funded wallets are linked to the creator even when it holds nothing", () => {
    const c = analyzeCrowd(crowdInput({ holders: [h("A", 5, "wallet", origin("A", { funder: CREATOR }))] }));
    assert.equal(c.clusters.length, 1);
    assert.deepEqual(c.clusters[0]?.wallets, ["A", CREATOR]);
    assert.deepEqual(c.clusters[0]?.reasons, ["creator-funded"]);
    assert.equal(c.clusters[0]?.pctSupply, 5);
    assert.equal(c.topHolders[0]?.label, "insider");
  });

  it("untraced wallets are independent only when veteran or fully traced", () => {
    const c = analyzeCrowd(
      crowdInput({
        holders: [
          h("Vet", 5, "wallet", veteranOrigin("Vet")),
          h("Full", 5, "wallet", origin("Full", { funder: null })),
          h("Part", 5, "wallet", partialOrigin("Part")),
          h("None", 5, "wallet", null),
        ],
      }),
    );
    const label = (w: string) => c.topHolders.find((v) => v.owner === w)?.label;
    assert.equal(label("Vet"), "independent");
    assert.equal(label("Full"), "independent");
    assert.equal(label("Part"), "unknown");
    assert.equal(label("None"), "unknown");
  });

  it("merges token accounts of the same owner", () => {
    const c = analyzeCrowd(crowdInput({ holders: [h("A", 2, "wallet", origin("A")), { ...h("A", 3), tokenAccount: "ta-A2" }] }));
    assert.equal(c.holdersAnalyzed, 1);
    assert.equal(c.topHolders[0]?.pctSupply, 5);
  });

  it("repairs a missing percentage from the amount and supply", () => {
    const c = analyzeCrowd(crowdInput({ holders: [{ ...h("A", Number.NaN), amount: 25_000_000 }] }));
    assert.equal(c.topHolders[0]?.pctSupply, 2.5);
  });

  it("falls back to the holder marked creator when the deployer is unknown", () => {
    const c = analyzeCrowd(
      crowdInput({ creator: null, holders: [h("Dev", 7, "creator", null), h("A", 5, "wallet", origin("A", { funder: "Dev" }))] }),
    );
    assert.equal(c.creator, "Dev");
    assert.equal(c.creatorPct, 7);
    assert.deepEqual(c.clusters[0]?.reasons, ["creator-funded"]);
    assert.ok(c.topHolders.every((v) => v.label === "insider"));
  });

  it("crowdInputFromFacts passes the family only when the funder is not long-history", () => {
    const f = factoryFacts();
    assert.deepEqual(crowdInputFromFacts(f).familyWallets, ["SibA", "SibB", "SibC"]);
    if (f.factory) f.factory.funderIsVeteran = true;
    const input = crowdInputFromFacts(f);
    assert.deepEqual(input.familyWallets, []);
    assert.deepEqual(input.ignoredFunders, ["Master"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Build and market engines
// ---------------------------------------------------------------------------------------------

describe("build engine", () => {
  it("counts the current coin once and dedupes launches", () => {
    const b = analyzeBuild(
      coin(),
      factory({ deployerLaunches: [launch(MINT, CREATOR, null), launch(MINT, CREATOR, null), launch("Z", CREATOR, 31)] }),
    );
    assert.equal(b.section.deployerLaunchCount, 2);
    assert.equal(b.section.familyFastDevSellCount, 0, "31 minutes is not a fast sell");
  });

  it("the fast-sell boundary is inclusive", () => {
    const b = analyzeBuild(coin(), factory({ deployerLaunches: [launch("Z", CREATOR, THRESHOLDS.FAST_DEV_SELL_MIN)] }));
    assert.equal(b.section.familyFastDevSellCount, 1);
  });

  it("an unknown deployer has nothing to rate", () => {
    const s = buildSticker(facts({ coin: coin({ creator: null }), factory: null }));
    assert.equal(s.build.deployer, null);
    assert.equal(s.build.familySize, 0);
    assert.equal(s.build.deployerLaunchCount, 0);
    assert.equal(s.ratings.build.stars, null);
    assert.ok(byId(s, "build.deployer-unknown"));
  });

  it("a partial trace with an active mint authority rates at most 3 and overall at most 2", () => {
    const f = cleanFacts();
    f.factory = null;
    f.coin.mintAuthority = "AuthWallet";
    const s = buildSticker(f);
    assert.equal(s.ratings.build.stars, 3);
    assert.match(s.ratings.build.reason, /Partial trace/);
    assert.equal(byId(s, "build.mint-authority")?.severity, "danger");
    assert.deepEqual(byId(s, "build.mint-authority")?.evidence, ["AuthWallet"]);
    assert.equal(s.ratings.overall.stars, 2);
    assert.match(s.ratings.overall.reason, /Capped at 2 stars by a danger finding: Mint authority is still active/);
  });

  it("unknown authorities are reported as unknown, not as renounced", () => {
    const s = buildSticker(facts({ coin: coin({ mintAuthority: "unknown", freezeAuthority: "unknown" }) }));
    assert.equal(byId(s, "build.mint-authority")?.severity, "unknown");
    assert.equal(byId(s, "build.freeze-authority")?.severity, "unknown");
  });

  it("a deployer funded long before launch is not fresh", () => {
    const b = analyzeBuild(coin(), factory());
    assert.equal(b.section.deployerFundedBeforeLaunchMin, 5 * 24 * 60);
    assert.equal(b.signs.freshDeployer, false);
  });
});

describe("market engine", () => {
  const curve = { graduated: true, curveProgressPct: 100 };

  it("liquidity tiers and the zero-volume penalty", () => {
    assert.equal(rateMarket(analyzeMarket(market({ liquidityUsd: 200_000 }), curve)).stars, 5);
    assert.equal(rateMarket(analyzeMarket(market({ liquidityUsd: 100_000 }), curve)).stars, 4);
    assert.equal(rateMarket(analyzeMarket(market({ liquidityUsd: 40_000 }), curve)).stars, 3);
    const thin = analyzeMarket(market({ liquidityUsd: 10_000, volume24hUsd: 0 }), curve);
    assert.equal(thin.liquidityToMcapPct, 0.5);
    const r = rateMarket(thin);
    assert.equal(r.stars, 1);
    assert.match(r.reason, /no trading in the last 24 hours/);
  });

  it("low liquidity is a warning finding", () => {
    const s = buildSticker(facts({ coin: coin({ market: market({ liquidityUsd: 20_000 }) }) }));
    assert.equal(byId(s, "market.low-liquidity")?.severity, "warning");
    assert.equal(byId(s, "market.low-liquidity")?.title, "Liquidity is 1% of market cap");
  });

  it("missing liquidity on the bonding curve is not rated", () => {
    const m = analyzeMarket(market({ liquidityUsd: null }), { graduated: false, curveProgressPct: 20 });
    assert.equal(rateMarket(m).stars, null);
    assert.match(rateMarket(m).reason, /bonding curve/);
  });
});

// ---------------------------------------------------------------------------------------------
// Rating rules
// ---------------------------------------------------------------------------------------------

describe("rating rules", () => {
  const r = (stars: Rating["stars"]): Rating => ({ stars, reason: "x" });
  const danger: Finding = { id: "x.d", engine: "build", severity: "danger", title: "Danger thing", detail: "", evidence: [] };

  it("tier boundaries", () => {
    assert.equal(starsFromInsiderPct(0), 5);
    assert.equal(starsFromInsiderPct(4.99), 5);
    assert.equal(starsFromInsiderPct(5), 4);
    assert.equal(starsFromInsiderPct(49.99), 2);
    assert.equal(starsFromInsiderPct(50), 1);
    assert.equal(starsFromLiquidityPct(10), 5);
    assert.equal(starsFromLiquidityPct(9.99), 4);
    assert.equal(starsFromLiquidityPct(0.5), 1);
    assert.equal(starsFromSigns(0), 5);
    assert.equal(starsFromSigns(4), 1);
    assert.equal(starsFromSigns(9), 1);
  });

  it("overall is the weakest link", () => {
    assert.equal(rateOverall({ build: r(4), crowd: r(3), market: r(5) }, []).stars, 3);
    assert.equal(rateOverall({ build: r(4), crowd: r(5), market: r(null) }, []).stars, 4);
  });

  it("a danger finding caps overall", () => {
    const o = rateOverall({ build: r(5), crowd: r(5), market: r(5) }, [danger]);
    assert.equal(o.stars, 2);
    assert.match(o.reason, /Danger thing/);
    assert.equal(rateOverall({ build: r(1), crowd: r(5), market: r(5) }, [danger]).stars, 1);
  });

  it("missing build or crowd means not rated, unless a danger finding settles it", () => {
    assert.equal(rateOverall({ build: r(5), crowd: r(null), market: r(5) }, []).stars, null);
    assert.equal(rateOverall({ build: r(5), crowd: r(null), market: r(5) }, [danger]).stars, 2);
    assert.equal(rateOverall({ build: r(null), crowd: r(null), market: r(null) }, [danger]).stars, 2);
  });

  it("crowd is capped when most circulating supply is outside the top holders", () => {
    const holders = [h("Pool", 10, "pool"), ...Array.from({ length: 20 }, (_, i) => h(`T${i}`, 1, "wallet", origin(`T${i}`)))];
    const c = analyzeCrowd(crowdInput({ holders }));
    assert.equal(c.tailOfCirculatingPct, 77.78);
    const rating = rateCrowd(c);
    assert.equal(rating.stars, ENGINE_RULES.TAIL_MAX_STARS);
    assert.match(rating.reason, /outside the top 20/);
  });

  it("findings sort by severity, then engine, then id", () => {
    const f = (id: string, engine: Finding["engine"], severity: Finding["severity"]): Finding => ({
      id,
      engine,
      severity,
      title: id,
      detail: "",
      evidence: [],
    });
    const sorted = sortFindings([f("m.a", "market", "info"), f("c.b", "crowd", "danger"), f("b.c", "build", "info"), f("b.a", "build", "danger")]);
    assert.deepEqual(sorted.map((x) => x.id), ["b.a", "c.b", "b.c", "m.a"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Whole-sticker properties
// ---------------------------------------------------------------------------------------------

const ALL_SCENARIOS: [string, () => CollectedFacts][] = [
  ["clean", cleanFacts],
  ["factory", factoryFacts],
  ["bundle", bundleFacts],
  ["unknown", unknownFacts],
  ["example", exampleFacts],
];

describe("every scenario", () => {
  for (const [name, make] of ALL_SCENARIOS) {
    it(`${name}: neutral wording, unique stable ids, clean numbers`, () => {
      const s = buildSticker(make());
      assertNeutral(texts(s));
      assertClean(s);
      const ids = s.findings.map((f) => f.id);
      assert.equal(new Set(ids).size, ids.length, "finding ids are unique");
      for (const id of ids) assert.match(id, /^(build|crowd|market)\.[a-z0-9.-]+$/);
      for (const f of s.findings) {
        assert.ok(f.title.length > 0 && f.detail.length > 0, f.id);
        assert.ok(f.evidence.length <= ENGINE_RULES.MAX_EVIDENCE, f.id);
        assert.ok(f.id.startsWith(`${f.engine}.`), f.id);
      }
      for (const v of s.crowd.topHolders) assert.ok(v.pctSupply >= 0 && v.pctSupply <= 100);
      const { insiderPct, independentPct } = s.headline;
      if (insiderPct !== null && independentPct !== null) assert.ok(insiderPct + independentPct <= 100.01);
    });

    it(`${name}: deterministic, and independent of input order`, () => {
      const a = buildSticker(make());
      assert.deepEqual(buildSticker(make()), a);
      const shuffled = make();
      shuffled.holders.reverse();
      shuffled.earlyBuys.reverse();
      shuffled.factory?.siblings.reverse();
      shuffled.factory?.deployerLaunches.reverse();
      assert.deepEqual(buildSticker(shuffled), a);
    });
  }

  it("the sticker price equals market cap x independent share of total supply", () => {
    const s = buildSticker(factoryFacts());
    const independentOfTotal = s.crowd.topHolders.filter((v) => v.label === "independent").reduce((a, v) => a + v.pctSupply, 0);
    assert.equal(independentOfTotal, 9);
    assert.equal(s.headline.stickerPriceUsd, Math.round(2_000_000 * 0.09 * 100) / 100);
  });
});

// ---------------------------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------------------------

describe("methodology", () => {
  it("has unique ids and complete text", () => {
    const ids = METHODOLOGY.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const r of METHODOLOGY) {
      for (const k of ["title", "rule", "why", "limits"] as const) assert.ok(r[k].length > 10, `${r.id}.${k}`);
      assert.ok(r.id.startsWith(`${r.engine}.`), r.id);
    }
    for (const id of ["build.stars", "crowd.stars", "market.stars", "overall.stars", "overall.sticker-price", "crowd.long-tail"]) {
      assert.ok(ids.includes(id), id);
    }
  });

  it("prints the numbers the code uses", () => {
    const all = METHODOLOGY.map((r) => `${r.rule} ${r.limits}`).join("\n");
    assert.ok(all.includes(`${THRESHOLDS.FAST_DEV_SELL_MIN} minutes`));
    assert.ok(all.includes(`${THRESHOLDS.FRESH_DEPLOYER_MIN} minutes`));
    assert.ok(all.includes(`${Math.round(THRESHOLDS.SIMILAR_FUNDING_FRACTION * 100)}%`));
    assert.ok(all.includes(`${THRESHOLDS.WALLET_CONCENTRATION_PCT}%`));
    assert.ok(all.includes(`${THRESHOLDS.BUNDLE_WARNING_PCT}%`));
    assert.ok(all.includes(`${THRESHOLDS.FACTORY_LAUNCHES} or more coins`));
    assert.ok(all.includes(`top ${LIMITS.TOP_HOLDERS}`));
    assert.ok(all.includes(`${ENGINE_RULES.SIMILAR_FUNDING_WINDOW_MIN} minutes of each other`));
    assert.ok(all.includes(`capped at ${ENGINE_RULES.DANGER_MAX_STARS}`));
    for (const t of ENGINE_RULES.INSIDER_STAR_TIERS) assert.ok(all.includes(`under ${t.below}% = ${t.stars}`));
    for (const t of ENGINE_RULES.LIQUIDITY_STAR_TIERS) assert.ok(all.includes(`${t.atLeast}%+ = ${t.stars}`));
  });

  it("uses neutral wording", () => {
    assertNeutral(METHODOLOGY.flatMap((r) => [r.title, r.rule, r.why, r.limits]));
  });
});

// ---------------------------------------------------------------------------------------------
// Example sticker (for the /example page)
// ---------------------------------------------------------------------------------------------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Length(s: string): number {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return -1;
    n = n * 58n + BigInt(i);
  }
  let bytes = 0;
  while (n > 0n) {
    n >>= 8n;
    bytes++;
  }
  let lead = 0;
  while (s[lead] === "1") lead++;
  return bytes + lead;
}

describe("example sticker", () => {
  const s = sampleSticker();

  it("is clearly marked as an example", () => {
    assert.equal(s.name, "Example Coin");
    assert.equal(s.symbol, "EXAMPLE");
    assert.equal(s.mint, EXAMPLE_MINT);
    assert.ok(s.mint.startsWith("Examp1e"));
    assert.equal(s.coverage.notes[0], EXAMPLE_NOTE);
    assert.equal(EXAMPLE_NOTE, "Example data, not a real coin");
    assert.equal(s.disclaimer, DISCLAIMER);
  });

  it("uses syntactically valid fake addresses and signatures", () => {
    const addresses = new Set<string>([
      s.mint,
      ...(s.build.deployer ? [s.build.deployer] : []),
      ...(s.build.funder ? [s.build.funder] : []),
      ...s.build.family.map((m) => m.wallet),
      ...s.crowd.topHolders.map((v) => v.owner),
      ...s.crowd.clusters.flatMap((c) => c.wallets),
    ]);
    for (const a of addresses) {
      assert.ok(a.startsWith("Examp1e"), a);
      assert.equal(base58Length(a), 32, a);
    }
    for (const e of s.findings.flatMap((f) => f.evidence)) {
      assert.ok(e.startsWith("Examp1e"), e);
      assert.ok([32, 64].includes(base58Length(e)), e);
    }
    const f = exampleFacts();
    assert.equal(base58Length(f.coin.creationSignature ?? ""), 64);
  });

  it("shows the factory pattern end to end", () => {
    assert.equal(s.computedAt, exampleFacts().collectedAt);
    assert.equal(s.ratings.build.stars, 1);
    assert.equal(s.ratings.crowd.stars, 2);
    assert.equal(s.ratings.market.stars, 5);
    assert.equal(s.ratings.overall.stars, 1);
    assert.equal(s.build.familyLaunchCount, 13);
    assert.equal(s.build.familyFastDevSellCount, 9);
    assert.equal(s.build.sentBackToFunderSol, 3.2);
    assert.equal(s.crowd.clusters.length, 1);
    assert.equal(s.crowd.clusters[0]?.pctSupply, 16.5);
    assert.equal(s.headline.insiderPct, 39.29);
    assert.equal(s.headline.independentPct, 34.52);
    assert.equal(s.headline.stickerPriceUsd, 6960);
    assert.ok(s.crowd.topHolders.some((v) => v.label === "unknown"));
    assert.ok(byId(s, "build.factory-pattern"));
    assert.ok(byId(s, "build.sweep"));
    assert.ok(byId(s, "crowd.bundle"));
    assert.ok(byId(s, "crowd.untraced"));
  });

  it("is the same every time", () => {
    assert.deepEqual(sampleSticker(), s);
  });
});
