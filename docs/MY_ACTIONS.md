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
8. **Tell me that address**, and I'll set `MSRP_PUBLIC_URL` in `wrangler.jsonc` so share links and the sitemap use it. (Until then share links point to a placeholder.)

From then on, every update pushed to the `main` branch of msrp goes live automatically, the same way SolanaView works.

## 2. Make stickers fast: add a free Helius key (recommended)
Without it MSRP uses the public Solana network, which is slow and often says "too busy".
1. Go to **helius.dev** → sign up (free) → **Dashboard** → copy your **Mainnet RPC URL** (it looks like `https://mainnet.helius-rpc.com/?api-key=...`).
2. In Cloudflare: **Workers & Pages** → **msrp** → **Settings** → **Variables and Secrets** → **Add**.
3. Type: **Secret**. Name: **SOLANA_RPC_URL**. Value: paste the Helius URL. Click **Deploy** (or **Save**).
4. Open `https://<your msrp address>/api/health`. It should say `"rpc":"custom"`.

Never paste the key anywhere else (not in GitHub, not in chat).

## 3. Optional: give MSRP a memory (list of recent stickers, sitemap)
Without this, MSRP still works but forgets recent stickers after a while.
1. Cloudflare → **Storage & Databases** → **D1 SQL Database** → **Create** → name **msrp** → **Create**.
2. Copy the **Database ID** shown on the next page and send it to me. I'll add it to the config and set up the tables.

## 4. Decide: Pro API payments (when you're ready)
Pro subscriptions would reuse SolanaView's existing SOL payment system. That's a money path, so per your rules I won't build or switch it on until you've reviewed the plan. Read docs/MONEY.md section 3 and tell me "go on Pro" when you want it.

## 5. Optional: Telegram bot
1. In Telegram, message **@BotFather** → `/newbot` → name it (for example "MSRP Sticker Bot").
2. Keep the token it gives you private. Add it in Cloudflare (msrp → Settings → Variables and Secrets → Secret) as **TELEGRAM_BOT_TOKEN**, then tell me it's there. I'll build the bot.

## What to click-test once it's live
1. Open the homepage. It should be dark, with a big box saying "paste a coin address".
2. Open **/example**. A white "window sticker" should appear, marked as an example.
3. Copy any Solana coin address from dexscreener.com, paste it in the homepage box and press the button. You'll see a "printing" animation for a few seconds, then the sticker.
4. On the sticker, tap a wallet address. It should open Solscan in a new tab.
5. Scroll to "Embed this sticker" and copy the badge code. Paste the image link alone into your browser and you should see a small badge.
6. Try it on your phone. Nothing should stick out sideways.
