# MSRP: the big idea

## One sentence
Every new car has a sticker in the window listing where it was built, what's inside and what it costs. **MSRP prints that sticker for any Solana meme coin**, so a buyer can see in ten seconds who made the coin and who really holds it.

## How your three projects become one thing

| Your project | What it already knows | What it becomes inside MSRP |
| --- | --- | --- |
| **dev.x (PumpStation)**, a launch desk | Exactly how a launch "factory" works: a master wallet funds a fresh deployer wallet right before launch, the coin is created with a dev buy in the same transaction, deployer wallets rotate every few launches, unsold bags get auto-sold after about 30 minutes, and the SOL is swept back to the master wallet. | **The Build Sheet.** MSRP runs that playbook backwards. Starting from a coin's deployer, it finds the wallet that funded it, the other wallets that same funder paid, every coin that "family" launched, how quickly the deployer sold, and whether SOL flowed back to the funder. |
| **trade.x (Cortisol)**, a forensic trading terminal | How to tell real buyers from fake ones: wallets funded by the same parent, wallets funded with near-identical amounts, buys packed into the launch block ("bundles"), how much the creator holds. | **The Crowd X-ray.** MSRP splits the top holders into infrastructure (bonding curve, pools, burn), insiders (creator, linked wallets, launch-block buyers) and independent wallets, and draws them as a map. |
| **SolanaView**, the public promotion site | Market data, screening, deployer pages, paid and free listings, an audience of traders and teams. | **The Sticker Price and the storefront.** MSRP shows the market cap next to the share held by independent wallets. Coins with a clean sticker get a "Get listed on SolanaView" button, which feeds SolanaView's paid listings. |

The insight: **the people who build launch machines know exactly what their fingerprints look like.** MSRP uses that knowledge to protect buyers instead of farming them. That's a position nobody else in the space can easily copy, and it's a story people will share.

## What a sticker shows
- **Sticker price:** market cap held by independent wallets, next to the headline market cap.
- **Star ratings (1-5)** for Build, Crowd, Market and Overall, like crash-test stars. They measure how transparent the ownership is. They never predict the price.
- **Build sheet:** deployer, funder, family tree, launches by the family, fast dev sells, SOL sent back to the funder, whether mint and freeze authority are renounced.
- **Crowd X-ray:** insider vs independent bar, linked-wallet clusters, top holders with labels, a holder map.
- **Findings:** plain-language lines such as "Deployer was funded 3 minutes before launch".
- **What we couldn't check:** every gap is listed. Unknown is never shown as zero.

## What MSRP will never do
- Hold keys, connect wallets or send transactions. It only reads public data.
- Sell ratings. Paying for a SolanaView listing never changes a sticker.
- Call a specific wallet a scammer. It describes patterns ("funded by the same wallet") and leaves the judgment to the reader.

## What this means for dev.x
MSRP will flag coins launched the way dev.x launches them (fresh funded deployer, rotation, fast auto-sells, sweeps). That's deliberate, and it's what makes MSRP credible. **MSRP will never offer a "check before launch so you don't get flagged" feature for launchers.** Helping factories hide would destroy the product's value.

## What this means for trade.x
trade.x's forensic gate can call MSRP's API before it considers a coin, and so can any other trading terminal or bot. That's the Pro API (see MONEY.md).
