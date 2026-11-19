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
import { EVIL, MINT, RULES, evilSticker, goodSticker, recent, uiSticker, unknownSticker } from "./ui-sample";

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

test("no inline scripts, no inline event handlers, no javascript: URLs (strict CSP)", () => {
  for (const [name, html] of Object.entries(allPages())) {
    for (const tag of tags(html)) {
      if (tag.startsWith("<script")) assert.match(tag, /^<script src="\/assets\/msrp\.js" defer>$/, `${name}: ${tag}`);
      assert.doesNotMatch(names(tag), /\son[a-z]+\s*=/i, `${name}: handler in ${tag}`);
      assert.doesNotMatch(tag, /(href|src|action|data)\s*=\s*"\s*(javascript|data|vbscript):/i, `${name}: ${tag}`);
    }
    assert.equal((html.match(/<script/g) ?? []).length, 1, `${name}: one external script`);
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
    renderOgSvg(evil),
    renderOgSvg(sampleSticker()),
    renderOgSvg(unknownSticker()),
    renderOgSvg(nullStars()),
    renderOgDefaultSvg(),
  ];
  for (const svg of svgs) {
    assert.ok(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""), "starts with <svg");
    assert.ok(wellFormedXml(svg), `well-formed: ${svg.slice(0, 120)}`);
    assert.doesNotMatch(svg, /<script/i);
    assert.doesNotMatch(svg, /<foreignObject|<image|href=/i, "self-contained");
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

test("badge: printed label with stars, independent share and date; null sticker says tap to check", () => {
  const s = sampleSticker();
  const badge = renderBadgeSvg(s, s.mint);
  assert.match(badge, /width="\d+" height="22"/);
  assert.ok(badge.includes(">MSRP<"));
  assert.ok(badge.includes("34.5% independent · 14 Oct"));
  assert.equal((badge.match(/<polygon/g) ?? []).length, 5, "five star shapes");
  assert.ok(badge.includes("<desc>MSRP measures"), "disclaimer travels with the badge");
  const empty = renderBadgeSvg(null, s.mint);
  assert.ok(empty.includes("· tap to check"));
  const nr = renderBadgeSvg(nullStars(), MINT);
  assert.ok(nr.includes("Not rated") && !nr.includes("<polygon"));
  const unk = renderBadgeSvg(unknownSticker(), MINT);
  assert.ok(unk.includes("independent share unknown"));
});

test("SolanaView box shows only at 4+ overall stars, labeled as separate from ratings", () => {
  const label = "Sponsored listings are separate from MSRP ratings — payment never changes a sticker";
  const good = renderSticker(ctx, goodSticker());
  assert.ok(good.includes(label));
  assert.ok(good.includes(`https://solanaview.example/promote?ref=msrp&amp;mint=${MINT}`));
  for (const s of [uiSticker(), unknownSticker(), nullStars(), sampleSticker()]) {
    const html = renderSticker(ctx, s);
    assert.ok(!html.includes(label), `hidden at ${String(s.ratings.overall.stars)} stars`);
    assert.ok(!html.includes("/promote?"), "no promote link");
  }
});

test("unknown is never shown as zero; null stars say Not rated", () => {
  const html = renderSticker(ctx, unknownSticker());
  const label = html.slice(html.indexOf('<article class="label"'), html.indexOf("</article>"));
  assert.ok((label.match(/>Unknown</g) ?? []).length >= 10, "Unknown shown for each missing value");
  assert.ok((label.match(/Not rated/g) ?? []).length >= 4);
  assert.doesNotMatch(label, /\$0\b|>0%|>0 SOL|0 of 0/, "no fake zeros");
  assert.ok(label.includes("Unnamed coin"));
  assert.ok(label.includes("Some steps didn't finish in time"), "incomplete coverage explained");
  assert.ok(label.includes("couldn&#39;t find the transaction that created the coin"), "reason next to Unknown");
  assert.ok(renderSticker(ctx, nullStars()).includes('<span class="st nr">Not rated</span>'));
});

test("sticker links: Solscan, SolanaView deployer history, share row, embed and JSON API", () => {
  const s = uiSticker();
  const html = renderSticker(ctx, s);
  assert.ok(html.includes(`https://solscan.io/token/${MINT}`));
  assert.ok(html.includes(`https://solscan.io/account/${s.build.deployer}`));
  assert.ok(html.includes(`href="https://solanaview.example/dev/${s.build.deployer}"`));
  assert.ok(html.includes(">Deployer history on SolanaView</a>"));
  assert.ok(html.includes("https://x.com/intent/tweet?text="));
  assert.ok(html.includes("https://t.me/share/url?url="));
  assert.ok(html.includes(`href="/api/v1/sticker/${MINT}"`));
  assert.ok(html.includes(`&lt;img src=&quot;https://msrp.example/badge/${MINT}.svg&quot;`), "embed snippet");
  assert.ok(html.includes(`https://solscan.io/tx/`), "signatures link to the transaction");
  assert.ok(html.includes('href="https://dexscreener.com/solana/examplepair"'), "pair url kept when safe");
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

test("waiting page: steps, API endpoint for the script, refresh without JavaScript", () => {
  const html = renderPrinting(ctx, MINT);
  assert.ok(html.includes(`id="wait" data-api="/api/v1/sticker/${MINT}" data-next="/coin/${MINT}"`));
  assert.ok(html.includes('<noscript><meta http-equiv="refresh" content="10"></noscript>'));
  assert.ok(html.includes("Reading the coin…"));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
});

test("methodology lists every rule; pricing says ratings can't be bought", () => {
  const html = renderMethodology(ctx, METHODOLOGY);
  for (const r of METHODOLOGY) assert.ok(html.includes(`id="${r.id}"`), r.id);
  const pricing = renderPricing(ctx);
  assert.ok(pricing.includes("Ratings can&#39;t be bought."));
  assert.ok(pricing.includes("https://github.com/solanadev1/msrp/issues"));
  assert.ok(pricing.includes("Coming soon"));
});

test("copy stays neutral: no buy/sell/safe/moon advice words", () => {
  for (const [name, html] of Object.entries(allPages())) {
    if (name.includes("vil") || name === "error" || name === "printingEvil") continue;
    const text = html.replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(text, /\b(moon|scam|rug|guaranteed|safe to buy|buy now|sell now)\b/i, name);
  }
});

test("rendering is deterministic", () => {
  assert.equal(renderSticker(ctx, sampleSticker()), renderSticker(ctx, sampleSticker()));
  assert.equal(renderOgSvg(sampleSticker()), renderOgSvg(sampleSticker()));
});

test("static assets: small, no inline handlers needed, JS parses, favicon is SVG", () => {
  const css = readFileSync(new URL("../public/assets/msrp.css", import.meta.url));
  const js = readFileSync(new URL("../public/assets/msrp.js", import.meta.url), "utf8");
  const icon = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
  assert.ok(css.length < 8 * 1024, `CSS is ${css.length} bytes`);
  assert.ok(js.length < 6 * 1024, `JS is ${js.length} bytes`);
  assert.doesNotThrow(() => new Script(js), "JS is valid");
  assert.doesNotMatch(js, /\beval\(|new Function|innerHTML|document\.write/, "no eval or HTML injection");
  assert.ok(icon.startsWith("<svg") && wellFormedXml(icon.trim()));
});
