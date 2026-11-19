# Things only you can do

Each step is click by click. None of them touches SolanaView, its payment switches or its treasury.

## 1. Put MSRP online (one time, about 5 minutes)
MSRP is its own Cloudflare Worker called **msrp**. It's separate from SolanaView's `solana-scanner` Worker.

1. Go to **dash.cloudflare.com** and log in.
2. In the left menu click **Compute (Workers)** → **Workers & Pages**.
3. Click **Create** (top right) → **Import a repository** (it may say "Connect to Git").
4. Choose **GitHub** → pick the account **solanadev1** → pick the repository **msrp**. If msrp isn't in the list, click "Configure GitHub app" and allow access to msrp.
5. Settings on the next screen:
   - Project name: **msrp**
   - Build command: **npm ci**
   - Deploy command: **npx wrangler deploy**
   - Leave everything else as it is.
6. Click **Create and deploy**. Wait for the green tick (1–3 minutes).
7. Cloudflare shows the address, something like `https://msrp.<your-name>.workers.dev`. Open it and you should see the dark MSRP homepage.
8. Share links, the sitemap and the badge code use the address the site is opened at, automatically. Nothing to set. (Only if you later buy your own domain, tell me and I'll point the links at it.)

From then on, every update pushed to the `main` branch of msrp goes live automatically, the same way SolanaView works.

## 2. Make stickers fast: add a free Helius key (recommended)
Without it MSRP uses the public Solana network, which is slow and often says "too busy".
1. Go to **helius.dev** → sign up (free) → **Dashboard** → copy your **Mainnet RPC URL** (it looks like `https://mainnet.helius-rpc.com/?api-key=...`).
2. In Cloudflare: **Workers & Pages** → **msrp** → **Settings** → **Variables and Secrets** → **Add**.
3. Type: **Secret**. Name: **SOLANA_RPC_URL**. Value: paste the Helius URL. Click **Deploy** (or **Save**).
4. Open `https://<your msrp address>/api/health`. It should say `"rpc":"custom"`.

Never paste the key anywhere else (not in GitHub, not in chat).

## 3. Needed: give MSRP a memory (free, about 2 minutes)
On a `...workers.dev` address Cloudflare's free cache does nothing, so without this database MSRP remembers a sticker only inside the one Cloudflare machine that printed it. Visitors served by another machine then see "tap to check" badges, a shorter "recently checked" list, and the sticker gets printed again (more Solana requests). The daily limit on new stickers is also only shared between machines through this database; without it each machine allows just 200 a day. `https://<your msrp address>/api/health` says `"storage":"memory-only"` until it's done and `"storage":"d1"` after.
1. Cloudflare → **Storage & Databases** → **D1 SQL Database** → **Create** → name **msrp** → **Create**.
2. Copy the **Database ID** shown on the next page and send it to me. I'll add it to the config and set up the tables.

## 4. Decide: Pro API payments (when you're ready)
Pro subscriptions would reuse SolanaView's existing SOL payment system. That's a money path, so per your rules I won't build or switch it on until you've reviewed the plan. Read docs/MONEY.md section 3 and tell me "go on Pro" when you want it.

## 5. Optional: Telegram bot
1. In Telegram, message **@BotFather** → `/newbot` → name it (for example "MSRP Sticker Bot").
2. Keep the token it gives you private. Add it in Cloudflare (msrp → Settings → Variables and Secrets → Secret) as **TELEGRAM_BOT_TOKEN**, then tell me it's there. I'll build the bot.

## 6. Decide: Cloudflare's computer-time limit (after it's live)
Cloudflare's free plan gives each visit 10 milliseconds of computer time. Reading a brand-new coin takes about 20-30 ms (stickers already printed take almost none). So some first visits to a new coin may show a Cloudflare "exceeded resource limits" page. Two choices:
- **A. Workers Paid ($5/month)**: Cloudflare → **Workers & Pages** → **Plans** → **Workers Paid** → **Purchase**. Nothing else changes. Recommended once people use it.
- **B. Stay free**: tell me "trace fewer wallets" and I'll lower how much history MSRP reads per wallet. Stickers get faster but see less.
Tell me A or B. Until then nothing breaks: the error only affects the first visit to a coin, and reloading after a minute usually works.

## What to click-test once it's live
1. Open the homepage. It should be dark and almost empty: "msrp", a small line "who made it · who holds it", one line to paste into, and coins checked recently.
2. Open **/example**. You should see "Example Coin", a big purple number, a small dot drawing on the right, four short rows and four small colored notes. A yellow "example data" tag sits under the name.
3. Copy any Solana coin address from dexscreener.com, paste it into the homepage line. You'll see "checking" with three steps ticking off (up to about 20 seconds), then the sticker.
4. On the sticker, tap a wallet address. It should open Solscan in a new tab. Hover a wallet: every place it appears gets a soft yellow ring.
5. Tap **details ↓**. Everything else opens below: ratings, the family list, the holder table, notes, share links and the badge code.
6. Copy the badge code under "share" and open the image link alone in your browser: you should see a small dark pill with dots and a percentage. The percentage is the same green number you see in the "holders" row of the coin page.
7. Try it on your phone. Nothing should stick out sideways.
8. Turn JavaScript off in your browser (or use a reader app) and paste a new coin: after "checking" it should open the sticker by itself within about 20 seconds, never reload forever.
