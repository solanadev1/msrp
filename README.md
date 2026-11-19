# msrp

**The window sticker for Solana coins.** Paste a coin address and MSRP reads the blockchain to show who made the coin, who funded the people who made it, what else they launched, and how much of the coin independent wallets really hold.

It's read-only. There's no wallet connection, no sign-up and no keys, and it's not financial advice.

## What a sticker shows
- **The big number (sticker price):** the part of the market cap held by wallets with no detected link to the creator or to each other.
- **Rating:** five dots. It measures how open the ownership is, not where the price goes.
- **Creator:** the wallet that made the coin, the wallet that funded it, and how long before launch.
- **Family:** other wallets the same funder paid, the coins they launched, and how often the creator sold within 30 minutes.
- **Holders:** linked / pools / independent / untraced.
- **Flags:** up to four, such as `launch & sell`, `linked 48%` or `authorities off`. Everything else is under **details**.

## Where it comes from
MSRP joins three projects:
- **dev.x** knows how launch factories work: fund a fresh wallet, launch with a dev buy, sell fast, sweep SOL back. MSRP runs that playbook backwards.
- **trade.x** brings holder forensics: shared funders, same-block bundles, creator holdings.
- **SolanaView** is the storefront and market data.

See [docs/CONCEPT.md](docs/CONCEPT.md).

## For the owner
- Put it online: [docs/MY_ACTIONS.md](docs/MY_ACTIONS.md) (one-time Cloudflare connection, a free Helius key, a free database).
- How it makes money: [docs/MONEY.md](docs/MONEY.md).
- What's done and every decision made: [docs/PROGRESS.md](docs/PROGRESS.md).
- What could come next: [NEXT_STEPS.md](NEXT_STEPS.md).
- Design rules: [docs/DESIGN.md](docs/DESIGN.md).

## For developers
```bash
npm ci
npm run check      # typecheck, lint, tests, Cloudflare dry-run
npm run dev        # local site on http://localhost:8787
npm run smoke:live # live check on 3 current coins (public Solana RPC)
```
Cloudflare Worker, TypeScript, no framework. `src/chain` reads Solana and DEX Screener, `src/engines` turns facts into a sticker, `src/ui` renders it and `src/web` handles routes, caching and limits. Every limit is in `src/config.ts`.
