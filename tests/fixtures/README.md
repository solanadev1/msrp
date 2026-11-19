# Test fixtures (real mainnet data)

These files let the chain reader be tested offline. Each one is a recording of every Solana RPC
call and DEX Screener request that `collectFacts()` made for one real coin, captured with
`npx tsx scripts/capture-fixtures.ts <curveMint> <graduatedMint>` from the public Solana RPC
(`api.mainnet-beta.solana.com`) and DEX Screener. Calls are keyed by method + parameters, so a
replay answers the same calls in any batch order (`tests/helpers/replay.ts`).

| File | Coin | Captured (UTC) | What it covers |
| --- | --- | --- | --- |
| `curve-coin.json` | `7FLVxmwpp2yNZHvDdZmPwopXqFD4ovjdWdnebrN9pump` | CURVE_TIME | pump.fun coin still on the bonding curve; fresh deployer. Holders come from the getProgramAccounts fallback because the public RPC refuses getTokenLargestAccounts. |
| `graduated-coin.json` | `3ZhsX6y2aEYoiwRFCu7mtwuMWSFH654dhyR2aGRVpump` (Wanted Lucia, LUCIA) | GRAD_TIME | Graduated to PumpSwap. Launch-factory pattern: a fresh deployer funded by a busy master wallet through a temporary wrapped-SOL account, dev buy, sell on PumpSwap, SOL swept back to the master. |
| `curve-coin-fee-sharing.json` | `EDFFFXFW8hQ3hSrGswUaxxeZzLHWP3iVmiCfJyGjpump` (The Odyssean Hippo, Pablo) | 2026-11-19 01:3x | Still on the curve; pump.fun's creator record points to a fee-sharing account (not a wallet), so the deployer is read from the CreateV2 transaction. The deployer is a veteran wallet (1,000+ transactions). |
| `tx-samples.json` | single transactions from the coins above | Nov 19 2026 | Parser tests: CreateV2 + dev buy, a bundle buy for two wallets, a failed buy, a router sell, funding and sweeping through a temporary account, a PumpSwap sell. |

Honest notes about the data:
- The public RPC refuses `getTokenLargestAccounts` (HTTP 429, method limit 0). For `graduated-coin.json`
  the capture script computed that answer from `getProgramAccounts` (every token account of the
  coin, largest 20 by amount) at capture time and served it in the real answer shape. The fixture's
  `notes` field says so. The other two fixtures record the refusal and exercise the fallback.
- Fields the chain reader never reads (`rewards`, `computeUnitsConsumed`, `costUnits`, `returnData`)
  were removed from transactions to keep files small. Everything else is as the RPC returned it.
- Tests use the capture time as "now", so time-based decisions replay exactly.
- To refresh: run the capture script again (it is slow on purpose: it waits between requests).
  If `collectFacts()` starts making different calls, the replay tests list the missing calls.
