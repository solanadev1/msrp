# MSRP progress

## Current position
Nov 19 2026, evening: **the whole site is wired together and checked on real coins.** Not yet online: that still needs the one-time Cloudflare connection in docs/MY_ACTIONS.md (step 1).

What works now:
- Paste any Solana coin and MSRP reads the chain live, then prints the sticker in the final "simple" design: the name, one big purple number, the wallet graph, four short rows and up to four tiny flags. Everything else sits behind one "details" link. On real coins the visible page has about 20 words.
- Checked live on 7 real coins (fresh pump.fun coins, recent graduations and the two LUCIA coins). The creator matched RugCheck every time. Pools and the pump.fun curve are never counted as insiders. Nothing unknown is shown as zero.
- The full check passes: typecheck, lint, all automatic tests (including new end-to-end tests that run the real site on recorded mainnet data) and the Cloudflare build dry-run.
- `npm run smoke:live` re-runs the live check on 3 current coins any time.

Fixed today after looking at real coins:
- A crashed coin ("Wanted Lucia": market cap $1,420, liquidity bigger than that) got 5 market stars. Liquidity above the market cap now counts as an oddity: at most 3 stars, plus a yellow "liquidity above cap" note.
- The free public Solana service turns many requests away when asked too fast. MSRP now waits and asks once more for those (in small groups, within the request limit), stops retrying when the service keeps saying no, and writes one plain note instead of five.
- When the funder's transactions could not be read, the family used to look smaller with no warning. Now it says so.
- One ordinary wallet held 61% of a coin and counted as "independent", which made the big number look healthy. A single wallet with more than 20% is now never counted as independent.
- Small wording fixes: "none seen" instead of "0 SOL" for SOL sent back, "<0.01%" instead of "0%" for tiny holders.

Biggest open risks (details in docs/MY_ACTIONS.md):
- Cloudflare's free plan allows 10 ms of computer time per visit; a brand-new sticker needs about 20-30 ms. Some first visits may show a Cloudflare error until you choose (Workers Paid, $5/month) or we trace fewer wallets.
- On the free public Solana service many stickers come out partial ("not rated"). A free Helius key fixes most of this.

Fixed Nov 19 (late), after reviewers ran MSRP on real coins (each one has a test):
- A creator that moved 600M of its own coins (61% of the supply) to a second wallet showed that wallet as "unknown" and the coin's insiders as "good". MSRP now spots plain transfers out of the creator and counts the receiver as linked (seen live: the coin now shows insiders 67.6%, danger). If the creator's big launch buy left without a sell or transfer we could see, the crowd rating is capped at 3 and the insider note is never green.
- A team's multisig vault (7.9%) was counted as a "program" and left out. Program addresses that people run are now "unknown": counted, never independent. Two more pool owners (Meteora) and Raydium LaunchLab are recognised so real pools stay pools.
- When some of the creator's history couldn't be read in time, MSRP still gave 5 stars and "no launch-factory signs". Now a partial read never gives top marks or good-news notes.
- "No same-block buyers found" appeared when the first block was never fully read. Now it says "not fully checked".
- Two strangers who withdrew from the same exchange 100 days apart were linked. A shared funder now only links wallets funded within 6 hours of each other, and never through an exchange-style batch withdrawal.
- On the free public Solana service, retries 2 seconds after a "too busy" answer always failed. MSRP now waits 12 seconds (measured) and sends nothing of that kind meanwhile; when there's no time left it gives up without wasting requests.
- Coin page "0 sold <30m" when nothing was checked now says unknown; a danger flag (like "mint on") always shows first; the badge and home list show the same green % as the coin page; old badges show "tap to check" after a day; share cards carry their date; visitors see a saved sticker at once instead of an error when Solana is busy; pages work without JavaScript; better contrast and keyboard focus; odd coin names (links, "claim", "airdrop") are kept off the home list; the placeholder site address was removed.

## DECISIONS
- **Not a launch → promote → trade machine.** The literal combination of dev.x, SolanaView and trade.x would let one operator create, promote and trade the same coins: a pump-and-dump. Instead, dev.x's knowledge of how launch factories work and trade.x's forensic heuristics power a public, read-only "window sticker" that protects buyers, and SolanaView is the storefront.
- **No dev.x code in this public repo.** dev.x is private and is a launcher. Only its *knowledge* (the pattern) is used. trade.x is public, so porting its small decoder logic is fine.
- **No "pre-check before launch" feature for launchers**, ever: it would help factories avoid detection.
- **Ratings can't be bought.** The SolanaView promotion box appears only on stickers with 4+ overall stars and is labeled as separate from ratings.
- **Separate Worker named `msrp`, no cron.** It can't touch SolanaView's Worker, storage, flags or treasury, and it uses no Cloudflare resources while nobody is visiting.
- **Deploy via Cloudflare's GitHub connection (owner clicks once)** because the Cloudflare credential in this environment was rejected by the Cloudflare API.
- **Public Solana network as fallback**, with Helius via the `SOLANA_RPC_URL` secret recommended.
- **Pushed straight to `main` of msrp.** The repo was brand new and empty, and the owner asked for everything to go there.
- **Liquidity above market cap is an oddity, not a deep market** (Nov 19). A pool only holds more than the market cap after most holders sold into it. At 100% or more the market rating is capped at 3 stars (a middle score, not a penalty) and a yellow note explains it.
- **One wallet above 20% of supply is never "independent"** (Nov 19). Seen live: a wallet collecting a project's fees held 61%. It is shown as unknown, so the big number never rests on one unexplained wallet. A linked wallet still counts as linked.
- **Asking the public Solana service again** (Nov 19, revised): a kind of request it turns away is paused for 12 seconds (measured: 10.5 s was too soon, 12 s worked), nothing of that kind is sent meanwhile, then at most 8 go out per window; each call is retried once at most. When the pause would end after the 20-second limit, those calls stop at once without spending requests. A sticker on the public service can take up to about 15-20 seconds; the waiting page covers it.
- **Shares of total supply on the main view** (Nov 19, from the design work): the holders row and the "linked X%" flag use shares of total supply so they match the bar and the big number. Shares of circulating supply appear inside details.
- **The SolanaView line lives inside details only**, never on the main view, and only on 4+ star stickers.
- **Each finding is one line inside details** that opens to its explanation, to keep the writing down.
- **Shared funder needs closeness in time** (Nov 19): two holders paid by the same wallet are linked only when funded within 6 hours of each other; an exchange-style batch withdrawal (one transaction with a durable nonce paying 3+ wallets) never links. Safest middle: a launch operation prepares its wallets within hours; exchanges pay strangers every day. Wallets funded that way can still be linked by "similar funding" when both are brand new.
- **Program addresses that a program doesn't own are "unknown"** (Nov 19): counted in the circulating supply, never independent, never left out. Swap-router addresses we don't recognise fall here too (seen on Lucia); that lowers the big number a little rather than inventing independence.
- **A partial read is never good news** (Nov 19): build 5 stars, "no launch-factory signs", "no dev sell seen", "no same-block buyers" and green insider notes all need the step to have finished.
- **Older stickers are shown at once and re-checked in the background** (Nov 19), with their date in the footer; the per-visitor limit still applies to the re-check.
- **Badges older than a day show "tap to check"** (Nov 19) because a badge can't show its date.
- **Every visible headline % is a share of total supply** (Nov 19): coin page, badge, home list, share text and search snippet. The circulating-supply shares stay inside details.
- **Without the database each Cloudflare machine allows 200 new stickers a day** (Nov 19) instead of the site-wide 2,000, and an IPv6 visitor is counted by its /64 network.
- **A deployer with 4 launches that all sold within 30 minutes still loses only one star** under today's rules (a "launch factory" needs 5 launches). Left as is for now; listed in NEXT_STEPS.md for your view.

- **Launch and sell is a danger finding** (Nov 19, lead, after the final live screenshots). A deployer funded 60 minutes or less before launch that first sold this coin 30 minutes or less after it is the core move of dev.x-style launch operations. Before, "Wanted Lucia" (funded <1 min before, sold <1 min after) could score 3 of 5 when the free network blocked the funder lookup. Now it's a danger finding (overall at most 2 stars) with one "launch & sell" flag in place of "fresh creator" and "creator sold". Wording stays neutral: a pattern, not proof.
- **Unknown sticker price shows "?"**, not a long dash, which looked like a loading bar at 72px.
