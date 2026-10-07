# Mode 2: the wallet activity indexer

**7 October 2026.** Mode 2 scores what an agent's own wallet has done on a public chain. It needs nothing from the agent beyond the
wallet it already proved it controls (*Connect wallet*). It is **off by default** (`ONCHAIN_INDEXER_ENABLED=true` turns it on) and
Mode 1 stays authoritative either way.

## What it measures

- Stablecoin **transfers in and out** of the wallet (ERC-20 `Transfer` events) for the tokens you list, on each chain you list.
- Counted: number of transfers, total USD volume (tokens are treated as $1, so list only USD stablecoins), when the wallet was first seen,
  and how many different counterparties it dealt with.
- **Ignored:** transfers to itself, mints and burns, transfers under a cent (address-poisoning dust).
- **Not scored until there is enough:** at least 5 transfers with 3 different counterparties (adjustable). Below that, Mode 2 stays
  empty and the report says how many were found. Sending funds around in a circle therefore does not build a history.

## What it does not measure, and why

| Left out | Why |
|---|---|
| **Success rate** | A failed transaction leaves no transfer, so public logs only ever show successes. A rate from them would always read 100%. It is reported as unknown and the scorer leaves the factor out and rescales, rather than guessing. |
| **Native-currency (ETH) transactions** | Standard RPC cannot list inbound ones, and valuing them needs a price source. |
| **Budget compliance** | Still not measured, as before. |
| **Anything off the listed chains and tokens** | By design. |

## How it works

A worker reads each bound wallet in block ranges (halving the range automatically if the RPC provider refuses it), only up to
**12 blocks behind the head** so a chain reorganisation cannot change what was counted. It keeps one small summary per wallet and chain
plus a cursor in Postgres, so a restart carries on where it stopped and counts nothing twice. Scoring reads the stored summary and never
calls the chain per request. Each pass spends a bounded number of calls per wallet, so one new wallet cannot starve the others. A failing
chain or wallet is retried on the next pass and shows its last error in the report's source note.

The dual-score response says where the figures came from (`mode2Source`: chain, block read to, when) and, when Mode 2 is empty, why
(`mode2Unavailable`: not read yet, or not enough history).

## Turning it on (owner)

1. Choose an RPC provider that allows log queries over wide block ranges and supports the chains you want. Public endpoints will throttle a backfill.
2. Fill `ONCHAIN_CHAINS` (see `infra/launch/bureau/launch.env.template`). **No token addresses are built in**: take each from the issuer's own
   published list and check it twice. Set `startBlock` to roughly when the earliest listed token launched on that chain.
3. Set `ONCHAIN_INDEXER_ENABLED=true`. A bad or missing chain list stops the bureau at start-up with a clear message.
4. Watch the first backfill (the log line at start names the chains). It is bounded work, but allow time and RPC budget for the first pass.

## Chains

Built for any EVM chain through configuration; **Base and Ethereum mainnet are the two to enable first.**

- **Ethereum mainnet:** the deepest stablecoin history. Costlier RPC use for the same wallet.
- **Arbitrum One and Optimism:** the sensible next additions: same log format, cheap, and active for automated agents. Configuration only.
- **Polygon:** possible, but expect a lot of tiny spam transfers; the dust filter helps and the minimums should be raised.
- **Solana is not a configuration change.** It has different addresses, a different transfer model (token accounts, not events) and a different
  signature scheme. Today an agent's identity (`did:forge:0x…`) and the wallet-binding proof are Ethereum-only, so a Solana wallet could not
  be proven or registered. It needs, in order: a Solana wallet proof (ed25519), a chain-neutral agent identity, then its own indexer. That is
  a separate project, worth doing only if design partners ask for it.

## Checked

Unit tests with a fake chain (ranges, confirmation depth, resume, retry, atomic batches, thin history, multi-chain combining) and a real
Postgres restart test. Two mutations (non-atomic batch, no confirmation depth) were confirmed to fail the tests meant to catch them.
**Not yet run against a live RPC provider or a real wallet**: that needs your provider and verified token addresses.
