# How MSRP makes money

Honest summary: MSRP doesn't charge anyone yet. It's built to pull in traffic and trust first, then turn them into money through channels that don't compromise the ratings. Below are the channels, in the order I'd switch them on.

## 1. Feed SolanaView's paid listings (works as soon as MSRP is live)
- Every sticker with **4 or more overall stars** shows a box: "Get your coin seen: SolanaView listings". It's labeled as separate from the ratings.
- The link carries `?ref=msrp&mint=<coin>`, so SolanaView can count where the customer came from.
- Why it converts: a team whose coin earns a good sticker *wants* attention and already trusts the source.
- Coins with weak stickers never see the box. That protects SolanaView's reputation and your listing buyers.

## 2. Embeddable badges = free advertising
- Every sticker has a badge (`/badge/<coin>.svg`) that teams can put on their website, X bio card, Telegram pinned message or Dexscreener profile. Each badge links back to MSRP.
- Clean teams will show it off. Buyers will start asking teams that don't have one: "where's your MSRP sticker?" That loop is how MSRP spreads without an ad budget.

## 3. Pro API + alerts (next to build; needs your OK on payments)
Who pays: trading bots, Telegram call groups, trading terminals (trade.x is customer zero), launchpads and wallets that want a safety panel.
- **Free:** stickers on the site, the badge, the API with a fair-use limit.
- **Pro (suggested 1 SOL a month or 10 SOL a year):** higher API limits, bulk checks, and **Family Watch** alerts ("tell me the moment a wallet family that launched 40 coins launches another one").
- Payment: reuse SolanaView's existing, already-reviewed SOL invoice system rather than building a second one. That's a money path, so it waits for your review (see MY_ACTIONS.md).

## 4. Telegram / Discord bot (big growth lever)
- Someone pastes a coin address in a group chat and the bot replies with the sticker image and link.
- Free for everyone, with "Powered by MSRP" on every reply. Paid groups get automatic stickers on every address posted, and no branding.
- Needs bot tokens that only you can create (see MY_ACTIONS.md).

## 5. The data moat (long-term)
Every sticker MSRP prints records the wallet families it found. Within weeks MSRP will hold a map of which funding wallets run which launch operations, and nobody can download that from a public API. That dataset is what makes the Pro API and alerts worth paying for, and what a launchpad, wallet or analytics company might eventually license or buy.

## What we will not do for money
- Sell better ratings, hide findings, or offer launchers a "pre-check so you don't get flagged" service.
- Promise returns, or run paid "calls" on coins.
- Promote coins with weak stickers.

Breaking any of these would make the sticker worthless, and the sticker is the whole business.

## Costs to watch
- **Solana data:** the free public network works but rate-limits heavily. A Helius key (free tier, about 1M credits a month) makes stickers fast and reliable. One sticker uses at most 36 batched requests.
- **Cloudflare:** MSRP has no background jobs, so it only uses resources when someone opens a page. Stickers are cached for 10 minutes. It's a separate Worker from SolanaView, but on the Free plan **all your Workers share one daily request allowance** (100,000 a day). If MSRP takes off, that's the first limit you'd hit. The Workers Paid plan ($5 a month) removes the worry.
