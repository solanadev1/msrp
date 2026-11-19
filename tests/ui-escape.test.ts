import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanLabel, cleanText, esc, isAddress, isSignature, safeUrl } from "../src/ui/escape";
import { dateTime, pct, sol, starText, usdPrice, usdShort } from "../src/ui/format";
import { textWidth } from "../src/ui/svg";

test("esc escapes the five HTML/XML specials", () => {
  assert.equal(esc(`<script>alert("x")</script>&'`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;");
  assert.equal(esc(`"onerror=alert(1)`), "&quot;onerror=alert(1)");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(42), "42");
});

test("cleanText strips control, bidi-override and lone-surrogate characters", () => {
  assert.equal(cleanText("a\u0000b\u0007c\u001bd"), "abcd");
  assert.equal(cleanText("SAFE‮evil"), "SAFEevil");
  assert.equal(cleanText("x⁦y⁩"), "xy");
  assert.equal(cleanText("ok\uD800"), "ok");
  assert.equal(cleanText("emoji 🐶 stays"), "emoji 🐶 stays");
  assert.equal(cleanText("tab\tand\nnewline"), "tab\tand\nnewline");
});

test("cleanLabel collapses whitespace, caps length and returns null for empty", () => {
  assert.equal(cleanLabel("  Dog   Coin\n ", 20), "Dog Coin");
  assert.equal(cleanLabel("abcdefghij", 5), "abcd…");
  assert.equal(cleanLabel("‮\u0000", 5), null);
  assert.equal(cleanLabel(null, 5), null);
  assert.equal(cleanLabel("🐶🐶🐶🐶", 3), "🐶🐶…", "never splits an emoji");
});

test("safeUrl only allows absolute http(s) URLs", () => {
  assert.equal(safeUrl("https://example.com/a.png"), "https://example.com/a.png");
  assert.equal(safeUrl("http://example.com"), "http://example.com/");
  for (const bad of [
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "java\u0000script:alert(1)",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "vbscript:x",
    "/relative.png",
    "//evil.example/x.png",
    "ftp://example.com/x",
    "https://user:pass@example.com/",
    "",
    null,
    undefined,
  ]) {
    assert.equal(safeUrl(bad as string | null | undefined), null, String(bad));
  }
  assert.ok(!(safeUrl('https://x.example/"><script>') ?? "").includes('"'), "quotes are percent-encoded by the URL parser");
});

test("address and signature shape checks", () => {
  assert.equal(isAddress("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"), true);
  assert.equal(isAddress("0OIl"), false);
  assert.equal(isSignature("5".repeat(88)), true);
  assert.equal(isSignature("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"), false);
});

test("formatters print Unknown for missing values, never 0", () => {
  assert.equal(usdShort(null), "Unknown");
  assert.equal(pct(null), "Unknown");
  assert.equal(sol(null), "Unknown");
  assert.equal(usdPrice(null), "Unknown");
  assert.equal(dateTime(null), "Unknown");
  assert.equal(usdShort(48_000), "$48K");
  assert.equal(usdShort(6_960), "$6.96K");
  assert.equal(usdShort(1_840_000), "$1.84M");
  assert.equal(pct(34.52), "34.5%");
  assert.equal(pct(0.04), "<0.1%");
  assert.equal(pct(0), "0%");
  assert.equal(usdPrice(0.000048), "$0.0000480");
  assert.equal(dateTime(Date.UTC(2026, 9, 14, 18, 0)), "14 Oct 2026 18:00 UTC");
  assert.equal(starText(2), "★★☆☆☆");
  assert.equal(starText(null), "Not rated");
});

test("SVG text width estimate is sane", () => {
  assert.ok(textWidth("MSRP", 12, true) > textWidth("MSRP", 12));
  assert.ok(Math.abs(textWidth("independent", 12) - 66) < 4);
});
