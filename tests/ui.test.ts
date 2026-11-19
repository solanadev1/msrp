import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import type { PageContext, Sticker } from "../src/types";
import {
  renderAbout,
  renderBadgeSvg,
  renderError,
  renderHome,
  renderMethodology,
  renderNotFound,
  renderOgDefaultSvg,
  renderOgSvg,
  renderPricing,
  renderPrinting,
  renderSticker,
} from "../src/ui";
import { sampleSticker } from "../src/engines/sample";
import { METHODOLOGY } from "../src/engines/methodology";
import {
  EVIL,
  MINT,
  RULES,
  evilSticker,
  goodSticker,
  noFunderSticker,
  noMarketSticker,
  recent,
  uiSticker,
  unknownSticker,
  untracedSticker,
} from "./ui-sample";

const ctx: PageContext = { publicUrl: "https://msrp.example", solanaviewUrl: "https://solanaview.example" };

function nullStars(): Sticker {
  const s = uiSticker();
  for (const k of ["build", "crowd", "market", "overall"] as const) s.ratings[k] = { stars: null, reason: "Not enough evidence." };
  return s;
}

const stickers: Record<string, () => Sticker> = {
  engineSample: sampleSticker,
  ui: uiSticker,
  unknown: unknownSticker,
  good: goodSticker,
  evil: evilSticker,
  nullStars,
  untraced: untracedSticker,
  noMarket: noMarketSticker,
  noFunder: noFunderSticker,
};

function allPages(): Record<string, string> {
  const pages: Record<string, string> = {
    home: renderHome(ctx, recent()),
    homeEmpty: renderHome(ctx, []),
    printing: renderPrinting(ctx, MINT),
    printingEvil: renderPrinting(ctx, EVIL),
    methodology: renderMethodology(ctx, METHODOLOGY),
    methodologyLocal: renderMethodology(ctx, RULES),
    pricing: renderPricing(ctx),
    about: renderAbout(ctx),
    notFound: renderNotFound(ctx),
    error: renderError(ctx, EVIL, EVIL, 500),
  };
  for (const [name, make] of Object.entries(stickers)) pages[`sticker:${name}`] = renderSticker(ctx, make());
  return pages;
}

/** All start tags in a document (text '<' is always escaped, so every '<x' is a real tag). */
function tags(html: string): string[] {
  return html.match(/<[a-zA-Z][^>]*>/g) ?? [];
}

/** A tag with its quoted attribute values blanked, so only attribute NAMES remain to inspect. */
function names(tag: string): string {
  return tag.replace(/"[^"]*"/g, '""');
}

/** The sticker article only (no shell, no share row). */
function article(html: string): string {
  return html.slice(html.indexOf('<article id="sticker"'), html.indexOf("</article>"));
}

/** Visible text of an HTML fragment: tags removed (inline, so no extra spaces), entities decoded. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** Minimal XML well-formedness check: balanced tags, quoted attributes, no stray '<' or bare '&'. */
function wellFormedXml(xml: string): boolean {
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const textOk = (t: string) => !t.includes("<") && !/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(t);
  while ((m = re.exec(xml))) {
    if (!textOk(xml.slice(last, m.index))) return false;
    for (const v of (m[3] ?? "").match(/"[^"]*"/g) ?? []) if (!textOk(v)) return false;
    last = re.lastIndex;
    const name = m[2] ?? "";
    if (m[1]) {
      if (stack.pop() !== name) return false;
    } else if (!m[4]) stack.push(name);
  }
  return textOk(xml.slice(last)) && stack.length === 0;
}

test("every page renders a full document with title, description, canonical and Open Graph tags", () => {
  for (const [name, html] of Object.entries(allPages())) {
    assert.ok(html.startsWith("<!doctype html>"), name);
    assert.match(html, /<title>[^<]+<\/title>/, name);
    assert.match(html, /<meta name="description" content="[^"]+">/, name);
    assert.match(html, /<link rel="canonical" href="https:\/\/msrp\.example\/[^"]*">/, name);
    assert.match(html, /<meta property="og:title" content="[^"]+">/, name);
    assert.match(html, /<meta property="og:image" content="https:\/\/msrp\.example\/og\/[^"]+\.svg">/, name);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${name}: exactly one h1`);
    assert.ok(html.trimEnd().endsWith("</html>"), name);
  }
});

test("dark theme shell: Google Fonts (escaped URL), one stylesheet, the mark and the address field", () => {
  for (const [name, html] of Object.entries(allPages())) {
    assert.ok(
      html.includes('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap">'),
      name,
    );
    assert.ok(html.includes('<link rel="stylesheet" href="/assets/msrp.css">'), name);
    assert.ok(html.includes('<meta name="theme-color" content="#0c0c0e">'), name);
    assert.ok(html.includes('<a class="mark" href="/" aria-label="MSRP home"><i></i>msrp</a>'), name);
    assert.equal((html.match(/<input id="q" name="mint"/g) ?? []).length, 1, `${name}: one address field`);
    assert.ok(html.includes('<form class="'), name);
    assert.ok(html.includes("public data · not financial advice"), `${name}: footer`);
  }
  const home = renderHome(ctx, recent());
  assert.ok(home.includes('<form class="big" action="/check" method="get" role="search">'), "home has the big field");
  assert.ok(home.includes('<h1>Who made it.<br><span>Who holds it.</span></h1>'));
});

test("no inline scripts, no inline event handlers, no javascript: URLs (strict CSP)", () => {
  for (const [name, html] of Object.entries(allPages())) {
    for (const tag of tags(html)) {
      if (tag.startsWith("<script")) assert.match(tag, /^<script src="\/assets\/msrp\.js" defer>$/, `${name}: ${tag}`);
      assert.doesNotMatch(names(tag), /\son[a-z]+\s*=/i, `${name}: handler in ${tag}`);
      assert.doesNotMatch(tag, /(href|src|action|data)\s*=\s*"\s*(javascript|data|vbscript):/i, `${name}: ${tag}`);
    }
    assert.equal((html.match(/<script/g) ?? []).length, 1, `${name}: one external script`);
    assert.equal((html.match(/<style/g) ?? []).length, 0, `${name}: no style blocks`);
    assert.doesNotMatch(html, /javascript:/i, name);
  }
});

test("every link that opens a new tab has rel=noopener", () => {
  for (const [name, html] of Object.entries(allPages())) {
    for (const tag of tags(html).filter((t) => /target="_blank"/.test(t))) {
      assert.match(tag, /rel="[^"]*\bnoopener\b[^"]*"/, `${name}: ${tag}`);
    }
  }
});

test("hostile token metadata is rendered as inert text in HTML", () => {
  const html = renderSticker(ctx, evilSticker());
  assert.ok(!html.includes("<script>alert"), "no live script tag");
  assert.ok(!html.includes("<img src=x"), "no live img tag");
  assert.ok(!html.includes("<svg onload"), "no live svg tag");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "escaped script text");
  assert.ok(html.includes("&quot;onerror=alert(2)"), "escaped quote before handler");
  assert.ok(!html.includes("javascript:alert(5)"), "image URL never printed");
  const home = renderHome(ctx, recent());
  assert.ok(!home.includes("<script>alert") && home.includes("&lt;script&gt;"), "home recent list escaped");
  const err = renderError(ctx, EVIL, EVIL, 500);
  assert.ok(!err.includes("<script>alert"), "error page escaped");
  const wait = renderPrinting(ctx, EVIL);
  assert.ok(!wait.includes("<script>alert") && !wait.includes("<img src=x"), "waiting page escaped");
  for (const page of [html, home, err, wait]) {
    for (const tag of tags(page)) assert.doesNotMatch(names(tag), /\son[a-z]+\s*=/i, tag);
  }
});

test("hostile metadata is inert in the badge and share card SVG, and both are well-formed", () => {
  const evil = evilSticker();
  const svgs = [
    renderBadgeSvg(evil, evil.mint),
    renderBadgeSvg(null, EVIL),
    renderBadgeSvg(sampleSticker(), sampleSticker().mint),
    renderBadgeSvg(unknownSticker(), MINT),
    renderBadgeSvg(nullStars(), MINT),
    renderOgSvg(evil),
    renderOgSvg(sampleSticker()),
    renderOgSvg(unknownSticker()),
    renderOgSvg(untracedSticker()),
    renderOgSvg(nullStars()),
    renderOgDefaultSvg(),
  ];
  for (const svg of svgs) {
    assert.ok(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""), "starts with <svg");
    assert.ok(wellFormedXml(svg), `well-formed: ${svg.slice(0, 120)}`);
    assert.doesNotMatch(svg, /<script/i);
    assert.doesNotMatch(svg, /<foreignObject|<image|href=/i, "self-contained");
    assert.ok(svg.includes("<desc>MSRP measures"), "disclaimer travels with the image");
    for (const tag of tags(svg)) assert.doesNotMatch(names(tag), /\son[a-z]+\s*=/i, tag);
  }
  assert.ok(renderOgSvg(evil).includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("the XML checker itself rejects broken markup", () => {
  assert.equal(wellFormedXml("<svg><g></svg>"), false);
  assert.equal(wellFormedXml("<svg><text>a < b</text></svg>"), false);
  assert.equal(wellFormedXml("<svg><text>R&D</text></svg>"), false);
  assert.equal(wellFormedXml('<svg a="1"><text>R&amp;D</text></svg>'), true);
});

test("badge: dark pill, purple dot, msrp, five rating dots, independent share; edge cases", () => {
  const s = sampleSticker();
  const badge = renderBadgeSvg(s, s.mint);
  assert.match(badge, /width="\d+" height="20"/);
  assert.ok(badge.includes('rx="9.5" fill="#0c0c0e"'), "dark pill");
  assert.ok(badge.includes(">msrp</text>"));
  assert.ok(badge.includes(">34.5%</text>") && badge.includes(">independent</text>"));
  const dots = badge.match(/<circle [^>]*r="2\.4"[^>]*>/g) ?? [];
  assert.equal(dots.length, 5, "five rating dots");
  assert.equal(dots.filter((d) => d.includes("#a78bfa")).length, 1, "one filled for 1 star");
  assert.ok(!/★|<polygon/.test(badge), "dots, not stars");
  const empty = renderBadgeSvg(null, s.mint);
  assert.ok(empty.includes(">tap to check</text>"));
  const nr = renderBadgeSvg(nullStars(), MINT);
  assert.ok(nr.includes(">not rated</text>") && !nr.includes('r="2.4"'));
  const unk = renderBadgeSvg(unknownSticker(), MINT);
  assert.ok(unk.includes(">independent share unknown</text>"));
  assert.ok(!unk.includes(">0%<"), "unknown share is not zero");
});

test("share card: big purple sticker price with the coin name; unknown stays unknown", () => {
  const og = renderOgSvg(sampleSticker());
  assert.ok(og.includes('fill="#0c0c0e"'), "near-black");
  assert.match(og, /fill="#a78bfa"[^>]*>\$6\.96K<\/text>/, "purple sticker price");
  assert.ok(og.includes(">/ $48K</text>"), "market cap after it, dim");
  assert.ok(og.includes(">Example Coin</text>") && og.includes(">$EXAMPLE</text>"));
  const unk = renderOgSvg(unknownSticker());
  assert.ok(unk.includes(">Unknown</text>") && !unk.includes(">$0"), "unknown, never $0");
  assert.ok(unk.includes(">Unnamed coin</text>"));
  assert.ok(renderOgSvg(untracedSticker()).includes("too many holders untraced"));
  assert.ok(renderOgDefaultSvg().includes(">Who made it.</text>"));
});

test("SolanaView line shows only at 4+ overall stars, quiet and labelled separate from ratings", () => {
  const label = "Sponsored listings are separate from MSRP ratings — payment never changes a sticker";
  const good = renderSticker(ctx, goodSticker());
  assert.ok(good.includes(label));
  assert.ok(good.includes('<aside class="promo" aria-label="Sponsored, separate from ratings"><small>Separate from ratings</small>'));
  assert.ok(good.includes(`https://solanaview.example/promote?ref=msrp&amp;mint=${MINT}`));
  assert.ok(good.indexOf("</article>") < good.indexOf('class="promo"'), "outside the sticker itself");
  for (const s of [uiSticker(), unknownSticker(), nullStars(), sampleSticker()]) {
    const html = renderSticker(ctx, s);
    assert.ok(!html.includes(label), `hidden at ${String(s.ratings.overall.stars)} stars`);
    assert.ok(!html.includes("/promote?"), "no promote link");
    assert.ok(!html.includes('class="promo"'));
  }
});

test("ratings are dots in four columns; null stars say Not rated", () => {
  const html = renderSticker(ctx, uiSticker());
  const rates = html.slice(html.indexOf('<div class="rates"'), html.indexOf('<p class="why">'));
  for (const label of ["Who made it", "Who holds it", "Market", "Overall"]) assert.ok(rates.includes(`<small>${label}</small>`), label);
  assert.equal((rates.match(/<span class="dots" role="img" aria-label="\d of 5">/g) ?? []).length, 4);
  assert.ok(rates.includes('aria-label="1 of 5"><i class="on"></i><i></i><i></i><i></i><i></i></span>'), "1 star = 1 purple dot");
  assert.ok(html.includes("Lowest section rating: build (1 star)."), "overall reason is shown");
  const nr = renderSticker(ctx, nullStars());
  const nrRates = nr.slice(nr.indexOf('<div class="rates"'), nr.indexOf('<p class="why">'));
  assert.equal((nrRates.match(/<span class="nr">Not rated<\/span>/g) ?? []).length, 4);
  assert.ok(!nrRates.includes('class="dots"'));
  const home = renderHome(ctx, recent());
  assert.ok(home.includes('<span class="nr">Not rated</span>'), "home rows too");
});

test("unknown is never shown as zero, with the reason next to it", () => {
  const html = renderSticker(ctx, unknownSticker());
  const a = article(html);
  assert.ok((a.match(/>Unknown</g) ?? []).length >= 9, "Unknown shown for each missing value");
  assert.doesNotMatch(text(a), /\$0\b|\b0%|\b0 SOL|0 of 0|0 launches/, "no fake zeros");
  assert.ok(a.includes("Unnamed coin"));
  assert.ok(a.includes('<em class="u">Unknown</em>'), "big number says Unknown");
  assert.ok(!a.includes('class="of"'), "no '/ market cap' when there is none");
  assert.ok(text(a).includes("Some steps didn't finish in time"), "incomplete coverage explained");
  assert.ok(text(a).includes("couldn't find the transaction that created this coin"), "reason for the missing creator");
  assert.ok(a.includes('<small class="rs"> · couldn&#39;t read the coin&#39;s settings</small>'), "reason next to Unknown");
  assert.ok(!a.includes('<svg class="graph"'), "no graph without a creator or funder");
  assert.ok(!a.includes('<pre class="tree"'), "no tree without a creator");
});

test("headline: sticker price / market cap with a plain sentence, every number linked to evidence", () => {
  const html = renderSticker(ctx, sampleSticker());
  assert.ok(html.includes('<p class="n"><a class="ev" href="#holders"'), "sticker price links to the holder rows");
  assert.ok(html.includes("<em>$6.96K</em></a>"));
  assert.match(html, /<span class="of">\/ <a class="ev" href="https:\/\/dexscreener\.com\/solana\/Examp1eCoinMint[^"]*"[^>]*>\$48K<\/a><\/span>/);
  assert.ok(text(html).includes("Of this coin's $48K market cap, $6.96K is held by wallets with no link we could find"));
  assert.ok(text(html).includes("That's 34.5% of the supply outside the bonding curve."), "independent share is of circulating supply");
  // Holder % and wallets link to Solscan.
  assert.ok(html.includes('<td class="pc"><a class="ev" href="https://solscan.io/account/Examp1eBundA'));
});

test("headline: untraced over half gives no price and no shares, and says why", () => {
  const html = renderSticker(ctx, untracedSticker());
  const a = article(html);
  assert.ok(a.includes('<em class="u">Unknown</em>'));
  assert.ok(a.includes("/ <a class=\"ev\""), "market cap still shown and linked");
  assert.ok(text(a).includes("wallets we couldn't trace hold more than half of the supply we checked"));
  assert.ok(text(a).includes("Too much of the supply is untraced to give insider and independent shares"));
  assert.doesNotMatch(text(a), /independent wallets hold \d/, "no independent share claimed");
});

test("headline: no market gives no price but keeps the independent share", () => {
  const a = article(renderSticker(ctx, noMarketSticker()));
  assert.ok(a.includes('<em class="u">Unknown</em>'));
  assert.ok(text(a).includes("DEX Screener had no market cap for this coin when we checked. Independent wallets hold 39.4%"));
  assert.ok(a.includes("DEX Screener had no trading pair when we checked"));
});

test("who holds it: shares of total supply; the untraced remainder is never counted as independent", () => {
  const a = article(renderSticker(ctx, uiSticker()));
  // ui sticker: pool 22, linked 37.6, independent 30.7, untraced 2, outside the top 5 = 7.7.
  assert.ok(a.includes("<span><b>37.6%</b>linked</span>"));
  assert.ok(a.includes("<span><b>22%</b>pools</span>"));
  assert.ok(a.includes("<span><b>30.7%</b>independent</span>"));
  assert.ok(a.includes('<span class="dim"><b>9.7%</b>untraced</span>'), "untraced + not checked shown together");
  assert.ok(a.includes('<span class="ut" style="flex-grow:9.7"'), "untraced slice in the bar");
  assert.ok(text(a).includes("Untraced: 2% in top holders we couldn't trace and 7.7% outside the top 5, counted as neither linked nor independent."));
  assert.ok(a.includes('<td>outside the top 5</td><td class="pc">7.7%</td><td class="lb c">not checked</td>'));
  assert.ok(text(a).includes("independent wallets hold 39.4% and linked wallets 48.2%"), "circulating shares from the headline");
  assert.ok(a.includes('<td class="lb c">untraced</td>'));
  // The engine example: 20 holders, 10 visible, 10 behind "show more".
  const ex = article(renderSticker(ctx, sampleSticker()));
  assert.ok(ex.includes("<summary>Show 10 more holders</summary>"));
  assert.ok(ex.includes('<span class="dim"><b>11%</b>untraced</span>'), "4.1% untraced + 6.9% outside");
  assert.ok(ex.includes("<b>58%</b>curve"));
});

test("who made it: plain sentence, aligned monospace family tree and the wallet graph", () => {
  const s = sampleSticker();
  const a = article(renderSticker(ctx, s));
  assert.ok(text(a).includes("That wallet funded 6 other wallets. Together they launched 13 coins and sold within 30 minutes on 9."));
  assert.ok(text(a).includes("3.2 SOL went back to the funder."));
  const tree = a.slice(a.indexOf('<pre class="tree"'), a.indexOf("</pre>"));
  const lines = text(tree.replace(/\n/g, "\u0000")).split("\u0000");
  assert.ok(lines.length >= 7, "funder + creator + siblings");
  assert.ok(tree.includes('<span class="t">this coin</span>'));
  assert.ok(tree.includes('<span class="r">holds 4.8%</span>'), "siblings that hold the coin are marked");
  assert.ok(tree.includes("├─ ") && tree.includes("└─ "));
  // Columns line up: every "launches" column ends at the same character.
  const plain = tree.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").split("\n").slice(1);
  const ends = plain.map((l) => l.search(/launch(es)?\b/) + (l.match(/launch(es)?\b/)?.[0].length ?? 0));
  assert.equal(new Set(ends).size, 1, `aligned: ${JSON.stringify(plain)}`);

  const graph = a.slice(a.indexOf('<svg class="graph"'), a.indexOf("</svg>") + 6);
  assert.ok(wellFormedXml(graph), "graph is well-formed");
  assert.ok(graph.includes('fill="#e5c07b"') && graph.includes('fill="#a78bfa"') && graph.includes('fill="#ececef"'), "funder, coin, creator colours");
  assert.ok(graph.includes(`href="https://solscan.io/account/${s.build.funder}"`), "nodes link to Solscan");
  assert.ok(graph.includes(`href="https://solscan.io/token/${s.mint}"`), "the coin links to its token page");
  assert.ok(graph.includes("<title>Funder: sent the creator its first SOL"), "tooltips");
  assert.ok(graph.includes(`data-w="${s.build.deployer}"`), "graph nodes join the highlighter");
  assert.equal(renderSticker(ctx, s), renderSticker(ctx, sampleSticker()), "deterministic layout");

  const nf = article(renderSticker(ctx, noFunderSticker()));
  assert.ok(text(nf).includes("so its funder and family are unknown"));
  assert.ok(nf.includes('<span class="c">? funder unknown</span>'));
  assert.ok(nf.includes('<svg class="graph"'), "creator-centred graph without a funder");
});

test("example pages say example data clearly", () => {
  const html = renderSticker(ctx, sampleSticker());
  assert.ok(html.includes('<span class="ex">example data</span>'));
  assert.ok(html.includes("Example data, not a real coin"));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(!renderSticker(ctx, uiSticker()).includes('class="ex"'));
});

test("footer line comes from real coverage data; disclaimer on every sticker", () => {
  const s = sampleSticker();
  const html = renderSticker(ctx, s);
  assert.match(html, /<footer class="foot"><p><span>31 rpc calls · 6\.4s · checked \d{1,2} Oct \d\d:\d\d UTC<\/span><span>public data · not financial advice<\/span><\/p>/);
  for (const make of Object.values(stickers)) assert.ok(renderSticker(ctx, make()).includes("MSRP measures who made a coin"), "disclaimer");
  assert.ok(renderHome(ctx, []).includes("<span>read-only · no wallet · no sign-up</span>"));
});

test("sticker links: Solscan, SolanaView deployer history, share row, embed and JSON API", () => {
  const s = uiSticker();
  const html = renderSticker(ctx, s);
  assert.ok(html.includes(`https://solscan.io/token/${MINT}`));
  assert.ok(html.includes(`https://solscan.io/account/${s.build.deployer}`));
  assert.ok(html.includes(`href="https://solanaview.example/dev/${s.build.deployer}"`));
  assert.ok(html.includes('title="Deployer history on SolanaView">on SolanaView ↗</a>'));
  assert.ok(html.includes("https://x.com/intent/tweet?text="));
  assert.ok(html.includes("https://t.me/share/url?url="));
  assert.ok(html.includes(`href="/api/v1/sticker/${MINT}"`));
  assert.ok(html.includes('<a href="#embed">Embed</a>') && html.includes('<section class="embed" id="embed">'), "embed opens with :target, no JS");
  assert.ok(html.includes(`&lt;img src=&quot;https://msrp.example/badge/${MINT}.svg&quot;`), "embed snippet");
  assert.ok(html.includes(`https://solscan.io/tx/`), "signatures link to the transaction");
  assert.ok(html.includes('href="https://dexscreener.com/solana/examplepair"'), "pair url kept when safe");
  assert.ok(html.includes('data-copy="https://msrp.example/coin/'), "copy link button (shown by the script)");
  const evil = renderSticker(ctx, evilSticker());
  assert.ok(evil.includes(`https://dexscreener.com/solana/${MINT}`), "unsafe pair url replaced");
});

test("highlighter data: linked wallets share a group, independent wallets don't", () => {
  const s = sampleSticker();
  const html = renderSticker(ctx, s);
  const groupsOf = (addr: string) => {
    const m = html.match(new RegExp(`data-w="${addr}" data-g="([^"]+)"`));
    return m?.[1]?.split(" ") ?? [];
  };
  const deployer = s.build.deployer ?? "";
  const cluster = s.crowd.clusters[0];
  assert.ok(cluster);
  const member = cluster.wallets.find((w) => w !== deployer) ?? "";
  const shared = groupsOf(deployer).filter((g) => groupsOf(member).includes(g));
  assert.ok(shared.length > 0, "creator and cluster member are linked");
  const independent = s.crowd.topHolders.find((h) => h.label === "independent");
  assert.ok(independent);
  assert.ok(!html.includes(`data-w="${independent.owner}" data-g=`), "independent wallet has no group");
  assert.ok(html.includes(`<a class="wl f" href="https://solscan.io/account/${s.build.funder}"`), "funder is yellow");
});

test("short addresses stay distinguishable on a page", async () => {
  const { makeShortener } = await import("../src/ui/format");
  const a = "Examp1eBundA11111111111111111111111111111111";
  const b = "Examp1eBundB11111111111111111111111111111111";
  const c = "7xKpQe2DzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzQe2D";
  const short = makeShortener([a, b, c]);
  assert.notEqual(short(a), short(b));
  assert.equal(short(c), "7xKp…Qe2D");
  assert.equal(short("abc"), "abc");
});

test("waiting page: same column, monospace steps, API endpoint for the script, refresh without JavaScript", () => {
  const html = renderPrinting(ctx, MINT);
  assert.ok(html.includes(`id="wait" data-api="/api/v1/sticker/${MINT}" data-next="/coin/${MINT}"`));
  assert.ok(html.includes('<noscript><meta http-equiv="refresh" content="10"></noscript>'));
  assert.ok(html.includes('<li><span>reading the coin</span><i aria-hidden="true"></i><b class="ok">…</b></li>'));
  assert.equal((html.match(/<b class="ok">/g) ?? []).length, 9);
  assert.ok(html.includes('<p class="status" id="wait-status" aria-live="polite">working</p>'));
  assert.ok(html.includes(`<span class="m">${MINT}</span>`));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
});

test("home: recently checked rows with dots, independent share and time; unknown share is a dash", () => {
  const home = renderHome(ctx, recent());
  assert.ok(home.includes(`<a class="rec" href="/coin/${MINT}">`));
  assert.ok(home.includes('<span class="m faint">$WDOG</span>'));
  assert.ok(home.includes(">39.4%<span class=\"vh\"> independent</span>"));
  assert.ok(home.includes('<span class="r faint" title="Independent share of circulating supply">—<span class="vh"> independent</span>'));
  assert.ok(home.includes("data-ago>19 Nov 01:40</time>"));
  assert.ok(!/>0%</.test(home));
  assert.ok(renderHome(ctx, []).includes("Nothing checked yet."));
});

test("methodology lists every rule; pricing says ratings can't be bought; about documents the API", () => {
  const html = renderMethodology(ctx, METHODOLOGY);
  for (const r of METHODOLOGY) assert.ok(html.includes(`id="${r.id}"`), r.id);
  const pricing = renderPricing(ctx);
  assert.ok(pricing.includes("Ratings can&#39;t be bought."));
  assert.ok(pricing.includes("https://github.com/solanadev1/msrp/issues"));
  assert.ok(pricing.includes("Coming soon"));
  const about = renderAbout(ctx);
  assert.ok(about.includes('<section id="api">') && about.includes("GET /api/v1/sticker/&lt;address&gt;"));
  assert.ok(renderHome(ctx, []).includes('<a href="/about#api">API</a>'));
});

test("copy stays neutral: no buy/sell/safe/moon advice words", () => {
  for (const [name, html] of Object.entries(allPages())) {
    if (name.includes("vil") || name === "error" || name === "printingEvil") continue;
    const t = html.replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(t, /\b(moon|scam|scammer|rug|guaranteed|safe to buy|buy now|sell now)\b/i, name);
    assert.doesNotMatch(t, /AI-powered|revolutionary|unleash|next-gen/i, name);
  }
});

test("rendering is deterministic", () => {
  assert.equal(renderSticker(ctx, sampleSticker()), renderSticker(ctx, sampleSticker()));
  assert.equal(renderOgSvg(sampleSticker()), renderOgSvg(sampleSticker()));
  assert.equal(renderBadgeSvg(sampleSticker(), MINT), renderBadgeSvg(sampleSticker(), MINT));
});

test("static assets: within budget, design tokens, two weights, no gradients; JS parses, favicon is SVG", () => {
  const css = readFileSync(new URL("../public/assets/msrp.css", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/assets/msrp.js", import.meta.url), "utf8");
  const icon = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
  assert.ok(Buffer.byteLength(css) <= 10 * 1024, `CSS is ${Buffer.byteLength(css)} bytes`);
  assert.ok(Buffer.byteLength(js) <= 8 * 1024, `JS is ${Buffer.byteLength(js)} bytes`);
  for (const token of ["--bg:#0c0c0e", "--tx:#ececef", "--tx2:#8d8d96", "--tx3:#55555d", "--hair:#1d1d21", "--acc:#a78bfa", "--red:#f2555a", "--grn:#4cc38a", "--yel:#e5c07b"]) {
    assert.ok(css.includes(token), token);
  }
  assert.ok(css.includes(".hl{background:rgba(229,192,123,.13);box-shadow:0 0 0 1px rgba(229,192,123,.3)"), "soft yellow highlighter ring");
  assert.ok(css.includes(".embed:target{display:block}"), "embed works without JS");
  assert.doesNotMatch(css, /gradient|backdrop-filter|text-shadow/i, "no gradients or glows");
  assert.doesNotMatch(css, /font-weight:\s*(?!400|500)\d+|font-weight:\s*bold|font:\s*(600|700|bold)/i, "two weights only");
  assert.doesNotThrow(() => new Script(js), "JS is valid");
  assert.doesNotMatch(js, /\beval\(|new Function|innerHTML|document\.write/, "no eval or HTML injection");
  assert.ok(js.includes('up(x, "tr")'), "rows light up with their wallet");
  assert.ok(icon.startsWith("<svg") && wellFormedXml(icon.trim()));
});
