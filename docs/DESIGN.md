# MSRP design brief (owner decision, 19 Nov 2026)

The owner rejected the dark "showroom" look as too AI-looking ("wayyy less AI") and also wants the interface to be "a work of genius". Both hold at once: **the genius is in the craft and the details, not in visual effects.** It should look like a real printed label made by a careful person, and reward anyone who looks closely.

Approved reference: `docs/design/reference.html` (open it in a browser). Match its look.

## Look: a printed form
- White page, black ink. Arial/Helvetica (system fonts only, **no web fonts**). Addresses and numbers you'd copy use a monospace (`ui-monospace, "Courier New", monospace`).
- Classic blue underlined links (`#00e`). One red (`#b00000`) used **only** for warnings. A yellow highlighter (`#ff0`) used only for the hover highlight described below. No other colors.
- The sticker is a box with a 2px black border and 1px black rules between sections, like a car window sticker or a government form.
- Section titles: short, bold, uppercase, 13px, no letter-spacing tricks.
- Sentence case everywhere else. Short, blunt, human copy. Numbers first.

## Banned (these read as "AI-made")
Dark backgrounds, gradients, glows, neon, glassmorphism, drop shadows, rounded cards, pill badges and chips, emoji, icon sets, decorative grids or noise, animated "printing" effects, hero illustrations, letter-spaced uppercase labels everywhere, and marketing words: "AI-powered", "revolutionary", "unleash", "seamless", "next-gen", "cutting-edge", "game-changer".

## Where the genius goes (build all of these)
1. **Every number is a receipt.** Each figure links to the on-chain evidence behind it (the funding transaction, the create transaction, the wallet on Solscan) with a dotted underline. Nothing on the sticker is unexplained.
2. **Highlighter linking.** Hover or focus any wallet and every other place that wallet appears, and every wallet linked to it (same funder, same block), gets a yellow highlighter background across the whole page. It works with the keyboard too. It should feel like someone went over the page with a marker.
3. **The family tree is plain text**, a monospace tree like a file listing:
   ```
   FuNd…9aZt  funder
   ├─ 7xKp…Qe2D  this coin's creator   6 launches, 5 sold within 30 min
   ├─ 3hQz…Lm8P                        9 launches, 9 sold within 30 min
   └─ 9pRw…Tt4K                        no launches seen
   ```
4. **Holders as a plain table** (rank, wallet, % of supply, label, linked-to). At most one thin printed-style stacked bar (black = linked, grey = pools, white with a black border = independent). No dot maps or constellations.
5. **Prints perfectly.** The print stylesheet fits the sticker on one Letter/A4 page, hides site chrome and prints the full URL under each link.
6. **Fast and small.** CSS under 8 KB, JS under 6 KB, no fonts and no libraries. Every page works with JavaScript off. JavaScript only adds the highlighter, copy buttons and the waiting-page refresh.
7. **Keyboard.** `/` focuses the address box. Pasting a valid address submits it.
8. **Waiting page** (while a new sticker is computed): plain text lines that tick off as steps finish, for example "Reading the coin… done", "Finding who made it… done", "Tracing who funded the holders…". No spinner art, and it refreshes into the sticker when done.
9. **The badge looks like a tiny printed label**: white, 1px black border, black text, `MSRP ★★☆☆☆ 39% independent · 19 Nov`. Nothing else.
10. **Stars:** plain text `★☆☆☆☆`, never bold (bold ☆ looks filled). "Not rated" when null.
11. **Homepage**: the address box, one paragraph saying what MSRP is, a short list of recently checked coins (name, stars, independent %, time) and links. It should feel like a tool, not a landing page.

Mobile: same layout in one column. Tables stay readable at 375px wide, long addresses are shortened in the middle (`7xKp…Qe2D`), and the page never scrolls sideways.
