# MSRP design brief: ultra minimal (owner decision, 19 Nov 2026, final)

History: the owner rejected a dark neon "showroom" (too AI-looking) and a plain white printed label ("I hate it"). They liked a nerdy dark "knowledge vault" look, then asked for it to be **"ultra minimalist and modern"** and handed the project over. This is the final direction: the vault's soul (dark, calm, purple accent, monospace details, family tree, wallet graph), stripped to one quiet column.

**Approved reference: `docs/design/min/`.** Open `sticker.html` and `home.html` in a browser; the screenshots are `*-desktop.png` and `*-mobile.png`. Match it closely. It's our own original design.

## Principles
- **One column**, max 680px, centered, generous whitespace. No sidebars, tabs, cards, boxes, pills, chips, badges, shadows, gradients or icons.
- **Hairlines only** (`#1d1d21`) to separate things. Hierarchy comes from size, weight and grey levels, never from containers.
- **One big number** per coin: the sticker price in purple, then `/ market cap` in dim grey, at 64px (48px on phones), followed by one plain sentence explaining it.
- **Ratings are dots**: five 7px circles, filled purple for the score and `#26262b` for the rest, in a four-column row (two columns on phones) labelled Who made it / Who holds it / Market / Overall. Show "not rated" text when the score is null.
- **Section labels** are tiny (12px), grey (`#55555d`) and sentence case: "Who made it", "Who holds it", "Notes".
- **Wallets** are monospace in purple. The funder is yellow. Linked is red, independent is green, and pools/infrastructure are grey.
- **Notes** are plain sentences with a 6px colored dot (red = warning, yellow = caution, green = fine, grey = not checked), separated by hairlines.
- **Nerdy details that stay:**
  - the family tree as aligned monospace text, with no box
  - a small hairline wallet graph (about 200px) beside the "Who made it" sentence on desktop and below it on phones, with funder yellow, coin purple, creator white, linked red, others dark grey, `<title>` tooltips, and nodes linking to Solscan
  - a one-line monospace footer from real coverage data: `31 rpc calls · 4.2s · checked 01:40 UTC` on the left, `public data · not financial advice` on the right
  - `/` to search
- **Homepage**: a big two-line headline "Who made it. / Who holds it." (the second line dim), one sentence, an underline-only monospace address field with a `/` hint, then "Recently checked" rows (name, $SYMBOL in dim monospace, rating dots, independent %, age).

## Tokens (use exactly)
```
--bg #0c0c0e  --tx #ececef  --tx2 #8d8d96  --tx3 #55555d  --hair #1d1d21
--acc #a78bfa  --red #f2555a  --grn #4cc38a  --yel #e5c07b  dot-off #26262b  pool-grey #2c2c32
fonts: Inter 400/500 (UI) + JetBrains Mono 400/500 (addresses, numbers, tree, footer), Google Fonts with display=swap and system fallbacks
weights: 400 and 500 only. Headings 500 with tight tracking (-0.03em to -0.045em).
```

## Behaviour (must work)
1. **Highlighter**: hover or focus a wallet and every occurrence of it, and every wallet linked to it, gets a soft yellow ring (`rgba(229,192,123,.13)` background + 1px `rgba(229,192,123,.3)` ring), including the graph nodes. Keyboard accessible.
2. **Every number links to its evidence** (Solscan transaction or account) with a subtle dotted underline on hover.
3. **Pasting a valid address opens it.** `/` focuses the field.
4. **Waiting page**: same column. The steps tick off in monospace (`reading coin … ok`), then the page refreshes into the sticker.
5. **Works without JavaScript.** JS only adds the highlighter, copy, paste-to-open and polling. CSS ≤ 10 KB, JS ≤ 8 KB.
6. **Holder table**: a 3px rounded split bar (linked / pools / independent, plus "untraced" in dark grey when present), the three big percentages under it, then hairline rows: rank, wallet, %, label in its color.
7. **Badge** (`/badge/<mint>.svg`): a tiny dark pill with a purple dot, `msrp`, the five rating dots, then `39% independent`.
8. **Share card (OG)**: the big purple sticker price on near-black with the coin name, nothing else.
9. **Methodology, pricing, about and error pages** use the same column: a big title, then plain sections.

## Banned
Sidebars, tabs, cards, boxed callouts, pills, emoji, icon sets, glows, gradients, glassmorphism, more than two font weights, marketing words ("AI-powered", "revolutionary", "unleash", "next-gen"), and anything that predicts price or says safe/scam/rug/buy/sell.
