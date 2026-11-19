# MSRP design brief: simple (owner decision, 19 Nov 2026, final)

History: the owner rejected a dark neon "showroom" (too AI), a white printed label ("I hate it") and a wordier minimal page ("too much writing, not minimalist and simple enough"). They liked the dark "vault" palette and handed the project over. **Final direction: almost no words. Numbers, dots, one graph. Details on demand.**

**Approved reference: `docs/design/min/`.** Open `sticker.html` and `home.html` with `s.css`; the screenshots are `*-desktop.png` and `*-mobile.png`. Match it exactly in spirit and density. It's our own original design.

## The rule: a word budget
- **Coin page, visible by default:** the coin name, a one-line mono subline, ONE big number with a 4-word caption, the graph, four rows and up to four flags, each flag 1–3 words. **No sentences, no paragraphs and no section headings on the main view.**
- **Everything else** (the full family tree, holder table, all findings with explanations, coverage notes, methodology links, share/embed/JSON/SolanaView links) lives inside ONE collapsed `<details>` element labelled `details ↓`. Inside it, keep it terse: monospace tree, a small table, one line per note.
- **Homepage:** the logo, a tiny mono tagline `who made it · who holds it`, one big underline-only input `paste a solana coin` with `/`, and recently checked coins as rows (name, SYMBOL dim mono, small rating dots, independent %). Nothing else.

## Coin page anatomy (top to bottom)
1. Top line: `● msrp` on the left, a small underline-only search `paste address  /` on the right.
2. `Name $SYMBOL` (26px, 500, symbol dim), then a mono subline `Abcd…pump · pump.fun · 2h` (plus `· example` on the example page).
3. Hero row: the big number (72px, purple) = sticker price, captioned in mono `independent of $1.84M`. When it's unknown, show `—` in dim grey, captioned `holders unknown`. On the right sits the wallet-family graph (about 170px, hairline edges; funder yellow, coin purple and largest, creator white, linked red, others dark grey; `<title>` tooltips).
4. Four hairline rows, each a short grey label and a mono value:
   - `rating`: five 9px dots (purple filled / `#26262b` empty), or `not rated` dim
   - `creator`: `7xKp…Qe2D ← FuNd…9aZt 3m before launch` (creator purple, funder yellow, rest dim)
   - `family`: `9 wallets · 41 launches · 37 sold <30m` (the last part red when > 0)
   - `holders`: a 4px split bar (red linked / dark pool / green independent / darker untraced), then `48 / 22 / 30`
5. Flags: up to four, each a 6px colored dot + 1–3 words (`launch factory`, `linked 48%`, `fresh creator`, `authorities off`, `holders unknown`). Red = warning, yellow = caution, green = fine, grey = unknown. Pick the four most important.
6. `details ↓` (collapsed).
7. Footer: one mono line, `31 calls · 4.2s · 01:40 UTC` on the left, `not financial advice` on the right.

## Tokens (use exactly)
```
--bg #0c0c0e  --tx #ececef  --tx2 #8d8d96  --tx3 #55555d  --hair #1d1d21  dot-off #26262b  pool #2c2c32
--acc #a78bfa  --red #f2555a  --grn #4cc38a  --yel #e5c07b
Inter 400/500 + JetBrains Mono 400 (Google Fonts, display=swap, system fallbacks). 640px column.
```

## Behaviour
- **Highlighter:** hover or focus a wallet and every place it appears, plus the wallets linked to it, gets a soft yellow ring, including graph nodes.
- **Every value links to its evidence** (Solscan) with no visible underline until hover.
- `/` focuses search, and pasting a valid address opens it.
- Works without JavaScript.
- **Waiting page:** the same top line, the big number position shows a dim `…`, and three mono steps tick off. Then the page reloads.
- **Badge:** a dark pill with `● msrp`, five rating dots and `30%`.
- **Share card:** near-black, the coin name and the big purple number.
- **Other pages** (methodology, pricing, about, errors): the same column, a title and terse rows. No long prose; methodology can be a table of rule → threshold.
- **Disclaimer:** the footer says `not financial advice`. The full disclaimer lives inside details and on /about.
- CSS ≤ 8 KB, JS ≤ 6 KB.

## Banned
Paragraphs on the main view, section headings on the main view, sidebars, tabs, cards, boxes, pills, emoji, icons, glows, gradients, more than two weights, marketing words, and any price prediction or safe/scam/rug/buy/sell wording.
