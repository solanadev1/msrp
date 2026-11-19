# MSRP: things I could do next

Ordered by impact. Each one is something I can build without you unless it says **(needs you)**.

## Growth
1. **Telegram bot `/msrp <address>`**: replies with the sticker card and link. **(needs you: a bot token from @BotFather)**
2. **PNG share images.** X and Telegram show PNG previews, not SVG. Render the sticker card to PNG so every shared link shows the sticker itself.
3. **"Factory Watch" public page**: the wallet families with the most launches in the last 7 days, using neutral wording and only data MSRP has already printed. A high-traffic, shareable page.
4. **SolanaView ↔ MSRP links**: a "Window sticker" button on every SolanaView project and dev page, and SolanaView counting visitors who arrive with `?ref=msrp`. (A SolanaView change, done under SolanaView's own rules and release gates. It doesn't touch payment code.)
5. **Sticker history**: show how a coin's sticker changed over time ("insider share fell from 48% to 12%").
6. **Compare two coins** side by side.

## Money
7. **Pro API keys + Family Watch alerts**, paid in SOL through SolanaView's existing invoice system. **(needs you: money path, your review first)**
8. **Embed widget** for launchpads and wallets (an iframe-free script tag that shows the badge and opens the sticker).
9. **trade.x integration**: Cortisol calls the MSRP API before considering a coin. (Change in the trade.x repo.)

## Quality
10. **Deeper family trace**: two hops up the funding chain, and following SOL that moved through exchanges (marked "unknown beyond exchange").
11. **Holder coverage beyond the top 20**: sample the long tail with a paid RPC that lists all token holders. **(needs you: Helius key)**
12. **Custom domain** (for example msrp.fyi or getmsrp.com). **(needs you: buy the domain)**
13. **Weekly accuracy review**: re-check old stickers and see whether the "fast dev sell" pattern matched what actually happened, then publish the results on the methodology page.
14. **Serial fast sellers**: a deployer whose every launch (3 or more) sold within 30 minutes loses only one build star today, because "launch factory" starts at 5 launches. Proposal: treat "3+ launches, all fast sells" as a second sign. **(needs you: a ratings rule change)**
15. **Lower CPU per new sticker** so the free Cloudflare plan's 10 ms is enough: read 200 instead of 1,000 signatures per wallet, and skip the long signature lists for wallets we already know are busy. **(needs you only if you pick option B in MY_ACTIONS step 6)**
16. **Pool share instead of liquidity ratio**: judge a crashed coin by how much of the supply sits back in its pool (we already read it), not only by liquidity above market cap.
17. **Known router and launchpad addresses**: name more program addresses (swap routers, lockers) so they count as infrastructure instead of "unknown".
18. **Second-hop transfers**: follow the creator's coins one more step (creator → wallet → wallets) within the request budget.
19. **Cloudflare Rate Limiting binding** for a shared per-visitor limit across machines, and refusing new computations started by `<img>`/`<script>` tags on other sites (`Sec-Fetch-Dest`).
20. **One request per window after a pause**: merge retried and new calls of the same kind into one request after the 12-second wait (saves a request or two per sticker on the public service).
