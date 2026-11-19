import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import type { PageContext, RecentSticker, Sticker } from "../src/types";
import { buildSticker } from "../src/engines/sticker";
import { listLabel } from "../src/ui/pages";
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
  PRINT_STEPS,
} from "../src/ui";
import { exampleFacts, sampleSticker } from "../src/engines/sample";
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

/** The sticker article only (no shell). */
function article(html: string): string {
  return html.slice(html.indexOf('<article id="sticker"'), html.indexOf("</article>"));
}

/** The main view: the article without the collapsed details block. */
function mainView(html: string): string {
  const a = article(html);
  return a.slice(0, a.indexOf('<details class="more"'));
}

/** Everything inside the one collapsed details block. */
function details(html: string): string {
  const a = article(html);
  return a.slice(a.indexOf('<details class="more"'));
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

/** Visible words: SVG, screen-reader-only text and tags removed. */
function visibleWords(html: string): string[] {
  const t = html
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<span class="vh">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ");
  return t.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
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

// ---------------------------------------------------------------------------
// Shell, safety, CSP
// ---------------------------------------------------------------------------

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

test("dark shell: Google Fonts (escaped URL), one stylesheet, the mark, one address field, one-line footer", () => {
  for (const [name, html] of Object.entries(allPages())) {
    assert.ok(
      html.includes('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&amp;family=JetBrains+Mono:wght@400&amp;display=swap">'),
      name,
    );
    assert.ok(html.includes('<link rel="stylesheet" href="/assets/msrp.css">'), name);
    assert.ok(html.includes('<meta name="theme-color" content="#0c0c0e">'), name);
    assert.ok(html.includes('<a class="mark" href="/" aria-label="MSRP home"><i></i>msrp</a>'), name);
    assert.equal((html.match(/<input id="q" name="mint"/g) ?? []).length, 1, `${name}: one address field`);
    assert.match(html, /<footer class="foot"><span>[\s\S]*<\/span><span class="t2">not financial advice<\/span><\/footer>/, `${name}: footer`);
  }
  const home = renderHome(ctx, recent());
  assert.ok(home.includes('<form class="field" action="/check" method="get" role="search">'), "home has the big field");
  assert.ok(home.includes('placeholder="paste a solana coin"'));
  assert.ok(home.includes("<h1>who made it · who holds it</h1>"));
  assert.ok(home.includes('<a class="how" href="/methodology">how</a>'), "home top line links to how it works");
  const coin = renderSticker(ctx, uiSticker());
  assert.ok(coin.includes('<form class="q" action="/check" method="get" role="search">') && coin.includes('placeholder="paste address"'));
  assert.ok(coin.includes('<kbd title="Press / to jump here">/</kbd>'));
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

test("every in-page link points at an element that exists", () => {
  for (const [name, html] of Object.entries(allPages())) {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `${name}: #${m[1]}`);
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

// ---------------------------------------------------------------------------
// Badge and share card
// ---------------------------------------------------------------------------

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
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), "starts with <svg");
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

test("badge: dark pill, purple dot, msrp, five rating dots and the independent share; edge cases", () => {
  const s = sampleSticker();
  const badge = renderBadgeSvg(s, s.mint);
  assert.match(badge, /width="\d+" height="20"/);
  assert.ok(badge.includes('rx="9.5" fill="#0c0c0e"'), "dark pill");
  assert.ok(badge.includes(">msrp</text>"));
  // The same basis as the coin page's main view: share of TOTAL supply (14.5%), not of circulating (34.5%).
  assert.ok(badge.includes(">14.5%</text>"), "independent share of total supply");
  assert.ok(!badge.includes(">34.5%</text>"));
  assert.ok(badge.includes("14.5% of supply held by independent wallets"));
  assert.ok(text(mainView(renderSticker(ctx, s))).includes("/14.5/"), "the badge figure is the one the coin page shows");
  const dots = badge.match(/<circle [^>]*r="2\.4"[^>]*>/g) ?? [];
  assert.equal(dots.length, 5, "five rating dots");
  assert.equal(dots.filter((d) => d.includes("#a78bfa")).length, 1, "one filled for 1 star");
  assert.ok(!/★|<polygon/.test(badge), "dots, not stars");
  assert.ok(renderBadgeSvg(null, s.mint).includes(">tap to check</text>"));
  const nr = renderBadgeSvg(nullStars(), MINT);
  assert.ok(nr.includes(">not rated ·</text>") && !nr.includes('r="2.4"'));
  const unk = renderBadgeSvg(unknownSticker(), MINT);
  assert.ok(unk.includes(">share unknown</text>"));
  assert.ok(!unk.includes(">0%<"), "unknown share is not zero");
  assert.ok(unk.includes("independent share unknown"), "the label says why");
});

test("share card: near-black, coin name, big purple number with a mono caption; unknown stays unknown", () => {
  const og = renderOgSvg(sampleSticker());
  assert.ok(og.includes('fill="#0c0c0e"'), "near-black");
  assert.match(og, /fill="#a78bfa"[^>]*>\$6\.96K<\/text>/, "purple sticker price");
  assert.ok(og.includes(">independent of $48K</text>"), "caption");
  assert.ok(og.includes(">Example Coin</text>") && og.includes(">$EXAMPLE</text>"));
  assert.ok(og.includes(">not financial advice</text>"));
  assert.ok(og.includes(">Exam…1111 · checked 14 Oct 18:00 UTC</text>"), "the check date is on the card");
  const unk = renderOgSvg(unknownSticker());
  assert.match(unk, /fill="#55555d"[^>]*>—<\/text>/, "dim dash, not a number");
  assert.ok(unk.includes(">market cap unknown</text>") && !unk.includes(">$0"), "unknown, never $0");
  assert.ok(unk.includes(">Unnamed coin</text>"));
  assert.ok(renderOgSvg(untracedSticker()).includes(">holders untraced</text>"));
  assert.ok(renderOgDefaultSvg().includes(">who made it.</text>"));
});

// ---------------------------------------------------------------------------
// The coin page: word budget and anatomy
// ---------------------------------------------------------------------------

test("coin page main view: almost no words, no headings, no paragraphs, one collapsed details", () => {
  for (const [name, make] of Object.entries(stickers)) {
    const html = renderSticker(ctx, make());
    const main = mainView(html);
    assert.doesNotMatch(main, /<h[2-6][\s>]/, `${name}: no section headings on the main view`);
    assert.doesNotMatch(main, /<p(?! class="(sub|cap)")[\s>]/, `${name}: only the subline and caption are <p>`);
    assert.doesNotMatch(main, /<table|<pre|<details/, `${name}: tree, table and notes live inside details`);
    assert.equal((article(html).match(/<details class="more"/g) ?? []).length, 1, `${name}: one details block`);
    assert.ok(article(html).includes('<details class="more" id="more"><summary>details ↓</summary>'), `${name}: collapsed by default`);
    if (name !== "evil") assert.ok(visibleWords(main).length <= 50, `${name}: ${visibleWords(main).length} words: ${visibleWords(main).join(" ")}`);
  }
});

test("coin page anatomy: name, mono subline, big number, graph, four rows, up to four short flags", () => {
  const html = renderSticker(ctx, sampleSticker());
  const main = mainView(html);
  assert.ok(main.includes("<h1>Example Coin <span>$EXAMPLE</span></h1>"));
  assert.match(main, /<p class="sub"><a href="https:\/\/solscan\.io\/token\/Examp1eCoinMint[^"]*"[^>]*>Examp1eC…1111<\/a> · pump\.fun · <time [^>]*>3h<\/time> · <span class="ex">example data<\/span><\/p>/);
  assert.ok(main.includes('<div class="hero"><div><a class="big" href="#holders"'), "big number links to the holder table");
  assert.ok(text(main).includes("$6.96Kindependent of $48K"));
  assert.ok(main.includes('<svg class="graph" viewBox="0 0 170 140"'));
  const labels = [...main.matchAll(/<div class="row"><dt>([^<]+)<\/dt>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["rating", "creator", "family", "holders"]);
  const flags = [...main.matchAll(/<li><a href="#([^"]+)"><i class="([rygc])"><\/i>([^<]+)<\/a><\/li>/g)];
  assert.deepEqual(
    flags.map((m) => [m[3], m[2]]),
    [["launch factory", "r"], ["linked 16.5%", "r"], ["fresh creator", "y"], ["launch-block buys", "y"]],
  );
  for (const [name, make] of Object.entries(stickers)) {
    const f = [...mainView(renderSticker(ctx, make())).matchAll(/<\/i>([^<]+)<\/a><\/li>/g)].map((m) => m[1] ?? "");
    assert.ok(f.length >= 1 && f.length <= 4, `${name}: ${f.length} flags`);
    for (const t of f) assert.ok(t.split(" ").length <= 3, `${name}: flag "${t}" is 1-3 words`);
  }
});

test("rating row: five dots for the overall rating; null stars say not rated", () => {
  const main = mainView(renderSticker(ctx, uiSticker()));
  assert.ok(main.includes('<span class="dots" role="img" aria-label="1 of 5"><i class="on"></i><i></i><i></i><i></i><i></i></span>'));
  const nr = renderSticker(ctx, nullStars());
  assert.ok(mainView(nr).includes('<span class="nr">not rated</span>'));
  assert.ok(!mainView(nr).includes('class="dots'), "no dots without a rating");
  const ratings = details(nr).slice(details(nr).indexOf('<section id="ratings">'), details(nr).indexOf('<section id="family">'));
  assert.equal((ratings.match(/<span class="nr">not rated<\/span>/g) ?? []).length, 4, "all four ratings in details");
  const d = details(renderSticker(ctx, sampleSticker()));
  assert.ok(d.includes("Lowest section rating: build (1 star); plus 1 danger finding."), "overall reason inside details");
  assert.ok(renderHome(ctx, recent()).includes('<span class="nr">not rated</span>'), "home rows too");
});

test("creator and family rows: creator ← funder with timing, family counts linked to the tree", () => {
  const s = sampleSticker();
  const main = mainView(renderSticker(ctx, s));
  assert.ok(main.includes(`<a class="wl a" href="https://solscan.io/account/${s.build.deployer}"`), "creator purple, on Solscan");
  assert.ok(main.includes(`<a class="wl y" href="https://solscan.io/account/${s.build.funder}"`), "funder yellow, on Solscan");
  assert.ok(text(main).includes("←Examp1eMa…11114m before launch"));
  assert.ok(text(main).includes("7 wallets · 13 launches · 9 sold <30m"));
  assert.ok(main.includes('<a class="r" href="#tree"'), "fast sells red, linked to the tree");
  const nf = mainView(renderSticker(ctx, noFunderSticker()));
  assert.ok(text(nf).includes("←unknown"), "unknown funder");
  assert.ok(text(nf).includes("wallets unknown · 6 launches · 5 sold <30m"), "family size unknown without a funder");
  assert.ok(text(nf).includes("funder unknown"), "flag");
});

test("holders row: split of total supply; the untraced remainder is shown, never counted as independent", () => {
  const ui = renderSticker(ctx, uiSticker());
  // ui sticker: linked 37.6, pool 22, independent 30.7, untraced 2 + outside the top 5 7.7 = 9.7.
  const main = mainView(ui);
  assert.ok(text(main).includes("37.6/22/30.7/9.7"));
  assert.ok(main.includes('<span style="flex:9.7;background:#222227"></span>'), "untraced slice in the bar");
  assert.match(main, /aria-label="Total supply: 37\.6% linked, 22% pools, 30\.7% independent, 9\.7% untraced or not checked"/);
  const d = details(ui);
  assert.ok(text(d).includes("untraced: 2% not traced · 7.7% outside top 5, not checked · never counted as independent"));
  assert.ok(d.includes('<td class="t3">outside top 5</td><td class="pc t3">7.7%</td><td class="t3">not checked</td>'));
  assert.ok(text(d).includes("of circulating: linked 48.2% · independent 39.4%"), "circulating shares from the headline");
  assert.ok(d.includes('<td class="t2">untraced</td>'), "untraced is readable grey, not dim");
  const ex = renderSticker(ctx, sampleSticker());
  assert.ok(text(mainView(ex)).includes("16.5/58/14.5/11"), "4.1% untraced + 6.9% outside");
  assert.ok(text(details(ex)).includes("curve 58%"));
  assert.equal((details(ex).match(/<tr><td class="t3">\d+<\/td>/g) ?? []).length, 20, "all 20 holders inside details");
});

test("unknown is never shown as zero", () => {
  const html = renderSticker(ctx, unknownSticker());
  const main = mainView(html);
  assert.ok(main.includes('<span class="big unk" title="Sticker price unknown">?<span class="vh"> unknown</span></span>'));
  assert.ok(main.includes('<p class="cap"><span class="t2">market cap unknown</span></p>'));
  for (const label of ["creator", "family", "holders"]) {
    assert.ok(main.includes(`<dt>${label}</dt><dd class="v"><span class="t2">unknown</span></dd>`), label);
  }
  assert.ok(main.includes("Unnamed coin"));
  assert.ok(!main.includes('<svg class="graph"'), "no graph without a creator or funder");
  const a = article(html);
  assert.doesNotMatch(text(a), /\$0\b|\b0%|\b0 SOL|0 of 0|\b0 launches|\b0 sold/, "no fake zeros");
  assert.ok((text(a).match(/unknown/g) ?? []).length >= 10);
  assert.ok(text(a).includes("some steps didn't finish in time"), "incomplete coverage explained");
  assert.ok(text(a).includes("creator unknown · creation transaction not found"), "reason for the missing creator");
  assert.ok(!a.includes('<pre class="tree"'), "no tree without a creator");
});

test("headline edge cases: untraced over half and no market give a dash with a short reason", () => {
  const ut = renderSticker(ctx, untracedSticker());
  assert.ok(mainView(ut).includes('<p class="cap"><span class="t2">holders untraced</span></p>'));
  assert.ok(text(details(ut)).includes("circulating shares unknown · untraced wallets hold over half of what we checked"));
  assert.doesNotMatch(text(details(ut)), /of circulating: linked/, "no independent share claimed");
  const nm = renderSticker(ctx, noMarketSticker());
  assert.ok(mainView(nm).includes('<p class="cap"><span class="t2">market cap unknown</span></p>'));
  assert.ok(text(details(nm)).includes("unknown · no trading pair on DEX Screener"));
  assert.ok(text(mainView(nm)).includes("no market"), "flag");
  assert.ok(text(details(nm)).includes("of circulating: linked 48.2% · independent 39.4%"), "independent share still known");
});

test("details: ratings, aligned monospace family tree, holder table, market, one line per note, share", () => {
  const s = sampleSticker();
  const d = details(renderSticker(ctx, s));
  for (const id of ["ratings", "family", "holders", "market", "notes", "share"]) assert.ok(d.includes(`<section id="${id}"><h2>`), id);
  const tree = d.slice(d.indexOf('<pre class="tree"'), d.indexOf("</pre>"));
  assert.ok(tree.includes('<span class="a">this coin</span>'));
  assert.ok(tree.includes('<span class="r">holds 4.8%</span>'), "siblings that hold the coin are marked");
  assert.ok(tree.includes("├─ ") && tree.includes("└─ "));
  const plain = tree.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").split("\n").slice(1);
  assert.ok(plain.length >= 7, "creator + siblings");
  const ends = plain.map((l) => l.search(/launch(es)?\b/) + (l.match(/launch(es)?\b/)?.[0].length ?? 0));
  assert.equal(new Set(ends).size, 1, `aligned: ${JSON.stringify(plain)}`);
  // Every finding is one line (its own little disclosure), and flags link to them.
  assert.equal((d.match(/<details class="nd"/g) ?? []).length, s.findings.length);
  assert.ok(d.includes('<details class="nd" id="f-build.factory-pattern"><summary><i class="r"></i>7 linked wallets launched 13 coins</summary>'));
  assert.ok(d.includes("Example data, not a real coin"), "coverage notes");
  assert.ok(d.includes("MSRP measures who made a coin"), "full disclaimer");
});

test("wallet graph: hairline, deterministic, coloured by role, every node linked and highlightable", () => {
  const s = sampleSticker();
  const main = mainView(renderSticker(ctx, s));
  const graph = main.slice(main.indexOf('<svg class="graph"'), main.indexOf("</svg>") + 6);
  assert.ok(wellFormedXml(graph), "graph is well-formed");
  for (const color of ["#e5c07b", "#a78bfa", "#ececef", "#f2555a"]) assert.ok(graph.includes(`fill="${color}"`), color);
  assert.ok(graph.includes(`href="https://solscan.io/account/${s.build.funder}"`), "nodes link to Solscan");
  assert.ok(graph.includes(`href="https://solscan.io/token/${s.mint}"`), "the coin links to its token page");
  assert.ok(graph.includes("<title>Funder: sent the creator its first SOL"), "tooltips");
  assert.ok(graph.includes(`data-w="${s.build.deployer}"`), "graph nodes join the highlighter");
  for (const m of graph.matchAll(/c([xy])="([\d.]+)"/g)) {
    const v = Number(m[2]);
    assert.ok(v >= 0 && v <= (m[1] === "x" ? 170 : 140), `inside the viewBox: ${m[0]}`);
  }
  assert.equal(renderSticker(ctx, s), renderSticker(ctx, sampleSticker()), "deterministic layout");
  assert.ok(mainView(renderSticker(ctx, noFunderSticker())).includes('<svg class="graph"'), "creator-centred graph without a funder");
});

test("example pages say example data clearly", () => {
  const html = renderSticker(ctx, sampleSticker());
  assert.ok(mainView(html).includes('<span class="ex">example data</span>'));
  assert.ok(html.includes("Example data, not a real coin"));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(!renderSticker(ctx, uiSticker()).includes('class="ex"'));
});

test("footer line comes from real coverage data; disclaimer on every sticker", () => {
  const html = renderSticker(ctx, sampleSticker());
  assert.ok(html.includes('<footer class="foot"><span>32 calls · 6.4s · 14 Oct 18:00 UTC</span><span class="t2">not financial advice</span></footer>'));
  for (const make of Object.values(stickers)) assert.ok(renderSticker(ctx, make()).includes("MSRP measures who made a coin"), "disclaimer");
  const home = renderHome(ctx, []);
  assert.ok(home.includes('<nav aria-label="Site"><a href="/methodology">how</a><a href="/pricing">pricing</a><a href="/about">about</a>'));
});

test("SolanaView line shows only at 4+ overall stars, quiet, inside details and labelled separate from ratings", () => {
  const label = "sponsored · separate from ratings · payment never changes a sticker";
  const good = renderSticker(ctx, goodSticker());
  const d = details(good);
  assert.ok(d.includes(`<aside class="promo" aria-label="Sponsored, separate from ratings"><span class="t3">${label}</span>`));
  assert.ok(d.includes(`https://solanaview.example/promote?ref=msrp&amp;mint=${MINT}`));
  assert.ok(!mainView(good).includes("promo"), "never on the main view");
  for (const s of [uiSticker(), unknownSticker(), nullStars(), sampleSticker()]) {
    const html = renderSticker(ctx, s);
    assert.ok(!html.includes(label), `hidden at ${String(s.ratings.overall.stars)} stars`);
    assert.ok(!html.includes("/promote?"), "no promote link");
    assert.ok(!html.includes('class="promo"'));
  }
});

test("sticker links: Solscan, SolanaView deployer history, share, embed and JSON API", () => {
  const s = uiSticker();
  const html = renderSticker(ctx, s);
  assert.ok(html.includes(`https://solscan.io/token/${MINT}`));
  assert.ok(html.includes(`https://solscan.io/account/${s.build.deployer}`));
  assert.ok(html.includes(`href="https://solanaview.example/dev/${s.build.deployer}"`));
  assert.ok(html.includes('title="Deployer history on SolanaView">SolanaView ↗</a>'));
  assert.ok(html.includes("https://x.com/intent/tweet?text="));
  assert.ok(html.includes("https://t.me/share/url?url="));
  assert.ok(html.includes(`href="/api/v1/sticker/${MINT}"`));
  assert.ok(html.includes(`&lt;img src=&quot;https://msrp.example/badge/${MINT}.svg&quot;`), "embed snippet");
  assert.ok(html.includes("https://solscan.io/tx/"), "signatures link to the transaction");
  assert.ok(html.includes('href="https://dexscreener.com/solana/examplepair"'), "pair url kept when safe");
  assert.ok(html.includes('data-copy="https://msrp.example/coin/'), "copy link button (shown by the script)");
  assert.ok(renderSticker(ctx, evilSticker()).includes(`https://dexscreener.com/solana/${MINT}`), "unsafe pair url replaced");
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
  assert.ok(groupsOf(deployer).some((g) => groupsOf(member).includes(g)), "creator and cluster member are linked");
  const independent = s.crowd.topHolders.find((h) => h.label === "independent");
  assert.ok(independent);
  assert.ok(!html.includes(`data-w="${independent.owner}" data-g=`), "independent wallet has no group");
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

// ---------------------------------------------------------------------------
// Other pages
// ---------------------------------------------------------------------------

test("waiting page: same column, dim … in the number's place, three mono steps, works without JavaScript", () => {
  const html = renderPrinting(ctx, MINT);
  assert.deepEqual([...PRINT_STEPS], ["creator", "family", "holders"]);
  assert.ok(html.includes(`id="wait" data-api="/api/v1/sticker/${MINT}" data-next="/coin/${MINT}"`));
  assert.ok(html.includes('<span class="big unk" aria-hidden="true">…</span>'));
  // Without JavaScript it moves on to the route that computes the sticker (?wait=1), never reloads itself.
  assert.ok(html.includes(`<noscript><meta http-equiv="refresh" content="1;url=/coin/${MINT}?wait=1"></noscript>`));
  assert.ok(html.includes(`<noscript><p class="cap"><a href="/coin/${MINT}?wait=1">check now</a></p></noscript>`));
  assert.doesNotMatch(html, /content="10"/);
  assert.equal((html.match(/<li><span>(creator|family|holders)<\/span><b class="ok">…<\/b><\/li>/g) ?? []).length, 3);
  assert.ok(html.includes('id="wait-status" aria-live="polite"'));
  assert.ok(html.includes(`<span class="mint">${MINT}</span>`));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
});

test("home: logo, tagline, one big field and recent rows (name, symbol, small dots, independent %)", () => {
  const home = renderHome(ctx, recent());
  assert.ok(home.includes(`<a class="rec" href="/coin/${MINT}"><span class="nm">Window Dog <span class="sym">WDOG</span></span>`));
  assert.ok(home.includes('<span class="dots sm" role="img" aria-label="1 of 5">'));
  assert.ok(home.includes('>39.4%<span class="vh"> independent</span></span>'));
  assert.ok(home.includes('<span class="pc t3" title="Independent share of total supply">—<span class="vh"> independent: unknown</span></span>'));
  assert.ok(!/>0%</.test(home));
  assert.ok(visibleWords(home.slice(home.indexOf("<main"), home.indexOf("</main>"))).length <= 40, "almost no words");
  assert.ok(renderHome(ctx, []).includes(`<a class="rec ex" href="/example">`), "empty list offers the example");
});

test("methodology lists every rule; pricing says ratings can't be bought; about documents the API", () => {
  const html = renderMethodology(ctx, METHODOLOGY);
  for (const r of METHODOLOGY) assert.ok(html.includes(`<details class="rule" id="${r.id}">`), r.id);
  assert.ok(html.includes("market cap × independent share of total supply"));
  const pricing = renderPricing(ctx);
  assert.ok(pricing.includes("ratings can&#39;t be bought"));
  assert.ok(pricing.includes("https://github.com/solanadev1/msrp/issues"));
  assert.ok(pricing.includes("https://solanaview.example/?ref=msrp"));
  const about = renderAbout(ctx);
  assert.ok(about.includes('<h2 class="lb" id="api">api</h2>') && about.includes("GET /api/v1/sticker/&lt;address&gt;"));
  assert.ok(about.includes("MSRP measures who made a coin"), "full disclaimer on /about");
  assert.ok(renderNotFound(ctx).includes("<h1>not found</h1>"));
  assert.ok(renderError(ctx, "Too many new checks", "try again later", 429).includes("429 · try again later"));
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
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  assert.ok(bytes(css) <= 8 * 1024, `CSS is ${bytes(css)} bytes`);
  assert.ok(bytes(js) <= 6 * 1024, `JS is ${bytes(js)} bytes`);
  for (const token of ["--bg:#0c0c0e", "--tx:#ececef", "--tx2:#8d8d96", "--tx3:#55555d", "--hair:#1d1d21", "--acc:#a78bfa", "--red:#f2555a", "--grn:#4cc38a", "--yel:#e5c07b", "--off:#26262b"]) {
    assert.ok(css.includes(token), token);
  }
  assert.ok(css.includes(".w{max-width:640px"), "640px column");
  assert.ok(css.includes(".hl{background:rgba(229,192,123,.13);box-shadow:0 0 0 1px rgba(229,192,123,.3)"), "soft yellow highlighter ring");
  assert.ok(css.includes(".graph .hl circle{stroke:rgba(229,192,123,.4)"), "graph nodes get the ring too");
  assert.doesNotMatch(css, /gradient|backdrop-filter|text-shadow/i, "no gradients or glows");
  assert.doesNotMatch(css, /font-weight:\s*(?!400|500)\d+|font-weight:\s*bold|font:\s*(600|700|bold)/i, "two weights only");
  assert.doesNotThrow(() => new Script(js), "JS is valid");
  assert.doesNotMatch(js, /\beval\(|new Function|innerHTML|document\.write/, "no eval or HTML injection");
  assert.ok(js.includes('up(x, "tr")'), "rows light up with their wallet");
  assert.ok(js.includes('p.tagName === "DETAILS"'), "links into details open it");
  assert.ok(icon.startsWith("<svg") && wellFormedXml(icon.trim()));
});

// ---------------------------------------------------------------------------
// Reviewer findings, Nov 19 2026
// ---------------------------------------------------------------------------

test("deployer history never traced: launches and sells are unknown, never '1 launch · 0 sold <30m'", () => {
  const f = exampleFacts();
  f.factory = null; // the trace failed (budget, deadline or RPC errors)
  f.coverage.notes = ["We ran out of time (20 seconds) before we could check the deployer's history."];
  const s = buildSticker(f);
  assert.equal(s.build.traced, false);
  const html = renderSticker(ctx, s);
  const main = mainView(html);
  assert.ok(main.includes('<dt>family</dt><dd class="v"><span class="t2">unknown</span></dd>'), "family row");
  assert.doesNotMatch(text(main), /sold <30m|1 launch/);
  const tree = html.slice(html.indexOf('<pre class="tree"'), html.indexOf("</pre>"));
  assert.ok(text(tree).includes("launches unknown"));
  assert.doesNotMatch(text(tree), /sold <30m|1 launch/);
});

test("partial trace: a zero fast-sell count is 'sells unknown', a found one still shows", () => {
  const f = exampleFacts();
  if (f.factory) {
    f.factory.traceComplete = false;
    f.factory.siblings = [];
    f.factory.deployerLaunches = f.factory.deployerLaunches.map((l) => ({ ...l, firstDevSellAfterMin: null, devSold: false }));
  }
  const main = mainView(renderSticker(ctx, buildSticker(f)));
  assert.ok(text(main).includes("sells unknown"));
  assert.doesNotMatch(text(main), /0 sold <30m/);
  const g = exampleFacts();
  if (g.factory) g.factory.traceComplete = false;
  assert.match(text(mainView(renderSticker(ctx, buildSticker(g)))), /\d+ sold <30m/, "signs we saw still show");
});

test("an active mint authority (danger) is never pushed off the four flags by warnings", () => {
  const f = exampleFacts();
  f.coin.mintAuthority = "Examp1eMintAuth1111111111111111111111111111";
  if (f.factory) {
    f.factory.siblings = [];
    const first = f.factory.deployerLaunches[0];
    if (first) {
      first.firstDevSellAfterMin = 5;
      first.devSold = true;
    }
  }
  const s = buildSticker(f);
  assert.ok(s.findings.some((x) => x.id === "build.mint-authority" && x.severity === "danger"));
  const warnings = s.findings.filter((x) => x.severity === "warning").length;
  assert.ok(warnings >= 3, `${warnings} warnings compete for the four flags`);
  const flags = mainView(renderSticker(ctx, s)).match(/<ul class="flags">([\s\S]*?)<\/ul>/)?.[1] ?? "";
  const items = text(flags.replace(/<\/li>/g, "|")).split("|").filter(Boolean);
  assert.equal(items.length, 4);
  // Two dangers here (fresh deployer that sold within 5 minutes, and the active mint authority):
  // both show, ahead of every warning.
  assert.deepEqual(items.slice(0, 2).sort(), ["launch & sell", "mint on"], "the dangers come first");
});

test("launch & sell: a fresh deployer that sold this coin fast is a danger that caps overall at 2", () => {
  const f = exampleFacts();
  const first = f.factory?.deployerLaunches[0];
  assert.ok(first && f.factory, "example has a deployer launch");
  first.firstDevSellAfterMin = 0.3;
  first.devSold = true;
  const s = buildSticker(f);
  const d = s.findings.find((x) => x.id === "build.launch-and-sell");
  assert.ok(d && d.severity === "danger", "launch-and-sell finding is a danger");
  assert.ok(s.ratings.overall.stars !== null && s.ratings.overall.stars <= 2, "overall capped at 2");
  const flags = text(mainView(renderSticker(ctx, s)).match(/<ul class="flags">([\s\S]*?)<\/ul>/)?.[1] ?? "");
  assert.ok(flags.includes("launch & sell"), "flag shown");
  assert.ok(!flags.includes("creator sold") && !flags.includes("fresh creator"), "no duplicate flags");
  for (const banned of [/scam/i, /\brug/i, /\bsafe\b/i]) assert.ok(!banned.test(`${d.title} ${d.detail}`));

  // Not a danger when the deployer was funded long before launch.
  const g = exampleFacts();
  const firstG = g.factory?.deployerLaunches[0];
  if (firstG && g.factory?.deployerOrigin) {
    firstG.firstDevSellAfterMin = 0.3;
    firstG.devSold = true;
    g.factory.deployerOrigin.fundedAt = (g.coin.createdAt ?? 0) - 3 * 86_400_000;
    g.factory.deployerOrigin.firstSeenAt = g.factory.deployerOrigin.fundedAt;
    assert.ok(!buildSticker(g).findings.some((x) => x.id === "build.launch-and-sell"), "old wallet: no danger");
  }
});

test("contrast and focus: no near-invisible text, visible focus on the graph, no hidden tab stop", () => {
  const css = readFileSync("public/assets/msrp.css", "utf8");
  assert.ok(!css.includes(".t4"), "the 1.7:1 grey is gone");
  assert.match(css, /\.graph a:focus-visible circle\{stroke:var\(--tx2\)/, "focus ring contrasts with every node colour");
  assert.ok(!/\.graph a:focus-visible circle\{stroke:var\(--acc\)/.test(css), "not purple on the purple coin node");
  assert.ok(css.includes(".nr{color:var(--tx2)"), "'not rated' readable");
  for (const make of Object.values(stickers)) {
    const html = renderSticker(ctx, make());
    assert.ok(!html.includes('class="t4"'), "untraced share at least --tx3");
    assert.ok(!/<span class="t3">unknown/.test(html), "unknown values in --tx2");
    assert.ok(html.includes('<span class="t2">not financial advice</span>'));
  }
  assert.ok(renderHome(ctx, []).includes('<button class="vh" type="submit" tabindex="-1">Check</button>'));
});

test("home list: link-like or claim-style coin names are replaced by the short address (no XSS either way)", () => {
  const rows: RecentSticker[] = [
    { mint: MINT, name: "claim msrp airdrop at evil.example", symbol: "EVL", imageUrl: null, overallStars: null, independentPct: null, computedAt: 1 },
    { mint: MINT, name: "Glass Cat", symbol: "t.me/scam", imageUrl: null, overallStars: null, independentPct: null, computedAt: 1 },
    { mint: MINT, name: "Visit https://x.example", symbol: null, imageUrl: null, overallStars: null, independentPct: null, computedAt: 1 },
  ];
  const home = renderHome(ctx, rows);
  assert.doesNotMatch(home, /evil\.example|airdrop|t\.me|x\.example/);
  assert.ok(home.includes("<span class=\"nm\">$EVL</span>"), "a clean symbol is kept");
  assert.ok(home.includes('<span class="nm">Glass Cat</span>'), "a clean name is kept, the bad symbol dropped");
  assert.ok(home.includes(`<span class="nm">${MINT.slice(0, 4)}…${MINT.slice(-4)}</span>`), "otherwise the short address");
  assert.equal(listLabel("Window Dog", 40), "Window Dog");
  assert.equal(listLabel("pump.fun king", 40), null);
});

test("/about documents what the API really returns", () => {
  const about = renderAbout(ctx);
  assert.ok(about.includes("HEAD 202 if not checked yet"));
  assert.doesNotMatch(about, /202 while checking/);
  const js = readFileSync("public/assets/msrp.js", "utf8");
  assert.ok(!js.includes("202"), "no dead 202 branch in the waiting page script");
});
