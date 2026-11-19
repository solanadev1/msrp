# Test fixtures (real mainnet data)

These files let the chain reader be tested offline. Each replay fixture is a recording of every Solana
RPC call and DEX Screener request that `collectFacts()` made for one real coin, captured with
`npx tsx scripts/capture-fixtures.ts <curveMint> <graduatedMint>` (use `-` for a coin to keep its
current fixture) from the public Solana RPC (`api.mainnet-beta.solana.com`) and DEX Screener. Calls
are keyed by method + parameters, so a replay answers the same calls in any batch order
(`tests/helpers/replay.ts`).

Replay fixtures are stored gzip-compressed (`*.json.gz`): most of a recording is lists of 1,000
transaction signatures, which compress to about a quarter. `loadFixture()` reads them; to look inside
one, run `gunzip -c tests/fixtures/curve-coin.json.gz | head -c 2000`.

| File | Coin | Captured (UTC) | What it covers |
| --- | --- | --- | --- |
| `curve-coin.json.gz` | `7FLVxmwpp2yNZHvDdZmPwopXqFD4ovjdWdnebrN9pump` | 2026-11-19 02:07:16 | pump.fun coin still on the bonding curve; fresh deployer. Holders come from the getProgramAccounts fallback because the public RPC refuses getTokenLargestAccounts. |
| `graduated-coin.json.gz` | `3ZhsX6y2aEYoiwRFCu7mtwuMWSFH654dhyR2aGRVpump` (Wanted Lucia, LUCIA) | 2026-11-19 05:04:20 | Graduated to PumpSwap in its own creation block (two bundle transactions bought for 17 wallets). Launch-factory pattern: a fresh deployer funded 2 seconds before launch by a master wallet through a temporary wrapped-SOL account, dev buy, sells on PumpSwap 20 and 81 seconds after launch, 52.8 SOL sent back to the master (sweeps and forwarded creator fees); 12 other wallets the master funded at the same time all sent SOL back, 9 of them were bundle buyers. |
| `curve-coin-fee-sharing.json.gz` | `EDFFFXFW8hQ3hSrGswUaxxeZzLHWP3iVmiCfJyGjpump` (The Odyssean Hippo, Pablo) | 2026-11-19 01:48:50 | Still on the curve; pump.fun's creator record points to a fee-sharing account (not a wallet), so the deployer is read from the CreateV2 transaction. The deployer is a veteran wallet (1,000+ transactions). |
| `tx-samples.json` | single transactions from the coins above | 2026-11-19 | Parser tests: CreateV2 + dev buy, a bundle buy for two wallets, a failed buy, a router sell; for LUCIA: funding and sweeping through a temporary account, the create, the same-block migration to PumpSwap, a PumpSwap sell, creator fees forwarded to the master, and 1-lamport "address poisoning" dust. |

Honest notes about the data:
- The public RPC refuses `getTokenLargestAccounts` (HTTP 429, method limit 0). For `graduated-coin`
  the capture script computed that answer from `getProgramAccounts` (every token account of the
  coin, largest 20 by amount) at capture time and served it in the real answer shape, so the test
  covers the normal path a paid provider (Helius etc.) takes. The fixture's `notes` field says so.
  The other two fixtures record the refusal and exercise the fallback.
- Fields the chain reader never reads were removed to keep files small (`trimFixture()` in
  `tests/helpers/replay.ts`): in transactions `rewards`, `returnData`, `computeUnitsConsumed`,
  `costUnits`, `status`, `loadedAddresses`, `version`, `recentBlockhash`, `addressTableLookups`,
  account-key `source`/`writable`, instruction `stackHeight`/`program`, the account lists of
  unparsed instructions, token-balance `programId`/`uiAmount`/`uiAmountString`, and the
  "consumed N of M compute units" log lines; in signature lists `memo` and `confirmationStatus`.
  Everything else is exactly as the RPC returned it.
- Tests use the capture time as "now", so time-based decisions replay exactly.
- Top-ups: when `collectFacts()` learns to make a new call, `--top-up <name>` fetches only the missing
  calls and keeps everything else (and the capture time) as recorded; the fixture's `notes` list what
  was added and when. On 2026-11-19 (05:13-05:16 UTC) all three fixtures were topped up for the
  first-block reads: the graduated coin's curve history, and the coin's history read backwards from a
  nearby known transaction down to the creation (`before` + `until`, a stretch of history that can no
  longer change), plus the few first-block transactions that were not recorded yet.
- 2026-11-19 (late): the curve-coin fixtures got one `getMultipleAccounts` answer each, derived offline from
  a recorded answer that already covered the same accounts (the reader no longer asks about known pool
  authorities). `tx-samples.json` gained two real transactions: `creatorTokenTransfer` (4NShmh...pump: the
  creator moved 600M coins to another wallet) and `exchangeBatchFunding` (an exchange-style withdrawal with a
  durable nonce paying 6 wallets).
- To refresh: run the capture script again (it is slow on purpose: it waits between requests).
  If `collectFacts()` starts making different calls, the replay tests list the missing calls.
  `npx tsx scripts/capture-fixtures.ts --trim` re-trims and re-compresses the files on disk.
