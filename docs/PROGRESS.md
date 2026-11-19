# MSRP progress

## Current position
Nov 19 2026: v0.1 built. Coin stickers (build sheet, crowd X-ray, sticker price), badge, share card, API, methodology, pricing, about and example pages. Read-only, tested on real Solana data. Not yet online: needs the one-time Cloudflare connection in docs/MY_ACTIONS.md.

## DECISIONS
- **Not a launch → promote → trade machine.** The literal combination of dev.x, SolanaView and trade.x would let one operator create, promote and trade the same coins: a pump-and-dump. Instead, dev.x's knowledge of how launch factories work and trade.x's forensic heuristics power a public, read-only "window sticker" that protects buyers, and SolanaView is the storefront.
- **No dev.x code in this public repo.** dev.x is private and is a launcher. Only its *knowledge* (the pattern) is used. trade.x is public, so porting its small decoder logic is fine.
- **No "pre-check before launch" feature for launchers**, ever: it would help factories avoid detection.
- **Ratings can't be bought.** The SolanaView promotion box appears only on stickers with 4+ overall stars and is labeled as separate from ratings.
- **Separate Worker named `msrp`, no cron.** It can't touch SolanaView's Worker, storage, flags or treasury, and it uses no Cloudflare resources while nobody is visiting.
- **Deploy via Cloudflare's GitHub connection (owner clicks once)** because the Cloudflare credential in this environment was rejected by the Cloudflare API.
- **Public Solana network as fallback**, with Helius via the `SOLANA_RPC_URL` secret recommended.
- **Pushed straight to `main` of msrp.** The repo was brand new and empty, and the owner asked for everything to go there.
