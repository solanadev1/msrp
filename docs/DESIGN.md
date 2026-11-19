# MSRP design brief: "the vault" (owner decision, 19 Nov 2026, final)

History: the owner rejected (1) a dark neon "showroom" look as too AI-looking, then (2) a plain printed-label look ("I hate it"). The approved direction is **nerdy-cool, like a personal knowledge vault**: a calm, dark, note-taking-app aesthetic where every coin and wallet is a note, wallet links are `[[wikilinks]]`, the wallet family is a graph view, findings are callouts and "who links here" is backlinks. It's beautiful through restraint and craft, not effects.

**Approved reference: `docs/design/vault.html`** (open it in a browser; screenshots in `docs/design/vault-*.png`). Match it closely. It's our own original design. Don't copy any real app's logo, name or icons.

## Layout (desktop ≥ 1100px): a three-pane app
- **Title bar** (38px): vault name `msrp · solana vault` with a small purple square mark, then tabs (the open note, plus recently opened coins/wallets).
- **Left sidebar** (248px): a search box (`Search or paste address`, `/` shortcut, pasting a valid address opens it). Below it a file tree: `coins` (recently checked), `wallets · this family` (funder, then creator and linked wallets indented, with coloured dots: yellow funder, purple creator, red linked, grey others), and `reference` (Methodology, API, About).
- **Center note** (max 740px): breadcrumb, H1 name + muted `$SYMBOL`, `#tags` as pills, a **Properties** block (key/value grid: mint, created, creator, funded by, authorities, overall stars), three stat cards (Market cap · **Sticker price** in purple with a purple border · Independent %), then `## Ratings` (table), `## Who made it` (a sentence with wikilinks, then the family tree as a code block), `## Who holds it` (thin rounded bar + legend + table with label pills), `## Findings` (callouts), and muted fine print.
- **Right sidebar** (300px): **Local graph** (SVG: funder yellow, coin purple and largest, creator white, linked red, independents green, others grey; thin grey edges for funding and purple edges for "holds this coin"), **Backlinks** (wallets/coins linking here, with a one-line reason) and **Outline**.
- **Status bar** (26px, monospace): `● chain read · 31 rpc calls · 4.2 s · checked 01:40 UTC · sticker v1`. These are real values from `coverage`.
- **Mobile (< 1100px):** a single column. Hide the left sidebar and extra tabs, put the search in the title bar, move the graph, backlinks and outline below the note, and stack the stat cards. The page never scrolls sideways (code blocks may scroll inside themselves).

## Tokens (use exactly)
```
--bg #1b1b1d  --bg2 #141416  --bg3 #232326  --line #2c2c30  --line2 #36363b
--tx #d9d9de  --tx2 #a1a1aa  --tx3 #6b6b74
--acc #a78bfa (purple: links, stars, sticker price)  --accbg rgba(167,139,250,.12)
--red #f2555a  --org #e9973f  --grn #4cc38a  --yel #e5c07b (funder / highlighter)
fonts: Inter (UI), JetBrains Mono (addresses, numbers, code, status bar), Google Fonts with display=swap and system fallbacks
radius: 10px cards, 8px callouts, 999px pills, 7px tabs/inputs
```

## Components
- **Wikilinks**: `[[7xKp…Qe2D]]`, with purple text and muted brackets added by CSS. Every wallet and coin is one.
- **Callouts**: a 3px left border plus a tinted background: danger (red), warning (orange), success (green), question/"Not checked" (grey). A bold title line, then one sentence.
- **Label pills** in holder tables: linked / launch block (red tint), pool / curve (grey), independent (green tint), unknown (grey outline).
- **Stars**: purple ★ and dim ★, never bold, `Not rated` when null.
- **Family tree**: a code block, funder in yellow, wallets in purple, "sold <30m" counts in red, `#` comments muted. Columns aligned.

## The genius details (must work)
1. **Highlighter**: hover or focus any wallet and every occurrence of it, and every wallet linked to it, gets a soft yellow highlight (`rgba(229,192,123,.16)` + a 1px ring) across the note, the sidebars and the graph nodes. Keyboard accessible.
2. **Every number is a receipt**: dotted underline, linking to the transaction or account on Solscan.
3. **Graph is live SVG** computed server-side (deterministic layout), with `<title>` tooltips. Clicking a node opens that wallet on Solscan.
4. **`/` focuses search; pasting a valid address opens it.**
5. **Waiting page** in the same app chrome: the note body shows steps ticking off in monospace (`reading coin … ok`, `tracing creator … ok`, `tracing holders 9/14 …`), then the page refreshes into the sticker.
6. **Works without JavaScript** (JS only adds the highlighter, copy, paste-to-open and polling). CSS ≤ 14 KB, JS ≤ 8 KB.
7. **Badge** (`/badge/<mint>.svg`): a small dark pill in the same palette: purple mark, `msrp`, ★ rating, `39% independent`.
8. **Homepage** = the vault opened on a "Start here" note: what MSRP is in two lines, a big search, recently checked coins as a table, and the three sections (Who made it / Who holds it / Sticker price) as short paragraphs with wikilinks to Methodology.

## Banned
Neon glows, gradient blobs, glassmorphism, emoji, stock icon sets, marketing words ("AI-powered", "revolutionary", "unleash", "next-gen"), and anything that predicts price or says safe/scam/rug/buy/sell.
