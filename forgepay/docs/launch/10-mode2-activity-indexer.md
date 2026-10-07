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
## Solana

Solana is supported, as its own kind of chain (`"kind":"solana"` in `ONCHAIN_CHAINS`), because it cannot share the EVM code path.

- **Identity:** a Solana agent is `did:forge:sol:<base58 public key>`. The `sol:` prefix is reserved, so it can never collide with a registry id,
  and the legacy `did:fp:` / `did:forgepay:` forms do not carry it. Base58 is case-sensitive, so the address is kept exactly as given.
  EVM identities and every existing DID parse exactly as before. A profile may carry both an EVM and a Solana wallet; their activity is combined.
- **Wallet proof (console, *Connect wallet*):** choose "Solana wallet", connect (Phantom or a compatible wallet), and sign the same challenge.
  The wallet signs the message bytes with ed25519; the console checks the signature server-side with Node's own crypto. The kind of wallet is read from
  the address, never from the caller, and a hex signature cannot prove a Solana wallet (or the reverse). The challenge is single-use, ten minutes,
  workspace-bound, and a wrong signature does not spend it, as for EVM wallets.
- **Indexer:** reads each wallet's token account for the configured stablecoin mints over plain JSON-RPC at `finalized` commitment (which cannot be
  rolled back, so there is no confirmation depth to tune). There are no block ranges on Solana, so it pages the token account's signatures
  newest to oldest, first catching up on anything new, then working back through history. Each page commits only when every transaction in it was read.
  A transfer is the wallet's net change of that token in one transaction, with the party that moved against it by the most as counterparty; mints, burns,
  transfers between the wallet's own accounts and failed transactions do not count. The same dust, minimum-history and counterparty rules apply.
- **Settlement:** scores settle to an EVM registry, so a Solana-only agent is not settled on-chain; its Mode 2 comes from indexed activity only. The
  dual-score response says so.

`ONCHAIN_CHAINS` entry for Solana (mint addresses are not built in; take them from the issuer's published list):

```json
{"kind":"solana","chainId":101,"name":"Solana","rpcUrl":"<provider url>","pageSize":50,"tokens":[{"symbol":"USDC","address":"<issuer-published mint>","decimals":6}]}
```

`chainId` is only a label that keeps Solana's summaries apart from EVM chains; use 101 for mainnet.

**Known limits.**
- A wallet with **more than one token account for the same token** is not indexed for that token (it is reported in the source note), because counting
  from several accounts could count one transaction twice. An undercount is the safer error.
- History is read from the token account, so activity on an account that has since been **closed** is not seen.
- A transaction the RPC node can no longer return (pruned history) is counted in `skipped` and cannot be scored; use a provider with full history.
- Needs a provider that serves `getSignaturesForAddress` and `getTransaction` for old transactions. Many free tiers do not.

## Checked

- **EVM:** unit tests with a fake chain (ranges, confirmation depth, resume, retry, atomic batches, thin history, multi-chain combining) and a real
  Postgres restart test. Mutations (non-atomic batch, no confirmation depth) were confirmed to fail the tests meant to catch them.
- **Solana:** a fake node that pages signatures newest-first like a real one: classification, paging across passes, catch-up spanning pages, an interrupted
  catch-up, atomic pages, missing transactions, several token accounts, routing wallets to the right kind of chain; the DID and base58 handling; the
  ed25519 proof with the same security cases as EVM (wrong signer, swapped message, replay, expiry, other workspace, shape mismatch); and registration
  through the bureau's real HTTP routes. Mutations (non-atomic page, wrong catch-up pointer, indexing despite several accounts, skipping the signature check)
  were each confirmed to fail the tests meant to catch them.
- **Not yet run:** against a live RPC provider (EVM or Solana), with real token addresses, or with a real wallet in a real browser. The Solana
  page's wallet calls (`connect`, `signMessage`) follow Phantom's documented interface but have only been type-checked, not clicked through.
  That needs your provider, verified addresses, and a person with a wallet.
