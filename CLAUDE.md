# MSRP: standing instructions for every session

MSRP prints a "window sticker" for any Solana meme coin. It shows who built the coin (deployer and its family of linked wallets), who really holds it (insider vs independent wallets), and the "sticker price" (market cap held by independent wallets). It runs as its own Cloudflare Worker, separate from SolanaView.

The owner is not a developer. Write in plain language. Work autonomously. When unsure, choose the safest option, write it under DECISIONS in docs/PROGRESS.md and keep going. If you run out of obvious work, add ideas to NEXT_STEPS.md and push.

## DESIGN: owner decision, binding (final: "simple")
The interface must follow **docs/DESIGN.md** and match **docs/design/min/** (sticker.html, home.html, s.css and screenshots): dark, almost no words. The coin page shows the name, one big purple number, the wallet graph, four one-line rows and up to four 1-3 word flags. Everything else goes behind one collapsed "details". This **overrides any other design brief or task prompt**, including earlier "showroom", printed-label, three-pane vault or wordier minimal designs (all rejected by the owner).

## Never
- Hold, ask for or store a private key or seed phrase. Never build, sign or send a blockchain transaction. MSRP is read-only.
- Promise returns, predict prices or say "safe", "buy", "sell" or "moon". Ratings measure transparency of ownership, not future price.
- Let payment change a rating. Promotion links (SolanaView) never affect a sticker.
- Copy code from the private dev.x repository into this public repository. Use its knowledge (how launch factories work), not its code.
- Put secrets in code, wrangler.jsonc vars or environment files. Use Cloudflare secrets (SOLANA_RPC_URL).
- Touch SolanaView's Worker, storage, payment flags or treasury from here.
- Invent numbers. Unknown is shown as unknown, with the reason in `coverage.notes`.

## Always
- Run `npm run check` (typecheck, lint, tests, deploy dry-run) before every commit. Only call something done if it passed.
- Keep each sticker within the request budget in src/config.ts (Cloudflare allows 50 outbound requests per visit on the Free plan).
- Use neutral wording for wallet links: "linked", "funded by the same wallet", "pattern". Never "scammer" or "rug" about a specific wallet.
- Keep the disclaimer on every sticker, badge page and API response.

## Map
- src/types.ts: the contract between layers. src/config.ts: every limit and threshold.
- src/chain: reads Solana and DEX Screener. src/engines: turns facts into a sticker. src/ui: HTML and SVG. src/worker.ts: routes, cache, limits.
- docs/: concept, methodology, money plan, owner actions, progress.
