# ForgePay Stablecoin Gateway

Forked from [zpaynow/ZeroPay](https://github.com/zpaynow/ZeroPay) (MIT).

## Role

- Accept **USDC**, **USDT**, **ZARP** (rand) and **OUSD** payments on major chains (Ethereum, Solana, Base, Polygon, Arbitrum)
- Native **x402 protocol** support for AI/agent-to-agent payments
- Low fee: **1.4% + gas** per transaction
- Real-time settlement and on-chain confirmation tracking

## Key Capabilities

| Feature | Details |
|---|---|
| Supported stablecoins | USDC, USDT, EURC |
| Chains | Ethereum, Base, Polygon, Arbitrum, Solana |
| x402 support | HTTP 402 native payment flow for AI agents |
| Settlement | Near-instant (once on-chain confirmed) |
| Webhooks | Real-time confirmation events → unified-router |

## Key Modifications from ZeroPay Upstream

1. All payment events emit to **unified-router** (not directly to merchants)
2. Multi-tenant: wallet addresses are generated per `(merchant_id, chain)` pair using HD wallet derivation
3. KMS-wrapped private keys — never plaintext in config
4. Merchant-facing API normalized to match ForgePay canonical payment API

## Development

```bash
cd forgepay/services/stablecoin-gateway
npm install
npm run dev          # port 8030
```

## Upstream Pin

```yaml
stablecoin-gateway:
  source: https://github.com/zpaynow/ZeroPay
  commit: <pin-on-fork>
```


## Assets, rates and settlement

USDC, USDT, ZARP and OUSD are handled by one registry (`src/lib/assets.ts`). A token's decimals and
symbol are read from its contract at start-up; one that doesn't check out is refused, not guessed
(`GET /assets` shows each token's status and why). Amounts are quoted in USD and converted with exact
integer arithmetic (`src/lib/asset-math.ts`): money in rounds up, money out rounds down.

- **ZARP** is priced at the operator-set USD/ZAR rate (`PUT /assets/rates/USD-ZAR`, admin), kept with its author and
  date and refused when older than `FX_MAX_AGE_HOURS`. The rate is locked on each payment/payout when it is
  created. There is no live market feed; that is the seam for one.
- **x402 and deposits** open a one-time address and an exact asset amount. `lib/settlement.ts` polls each chain's
  transfer logs, counts only *final* blocks into the persisted total (a reorg can't un-credit), accepts partial
  payments cumulatively, ignores other tokens, records payments after expiry in `late_units` (never credited),
  and survives restarts. It replaces the old event monitor, which could never confirm an x402 payment.
- **Payouts** fix asset, units and rate at creation (so a retry of the same `external_id` returns the original),
  judge ceilings and approval in USD, and send exactly the stored units, refusing if the token no longer verifies.
  The bureau *creates* payouts. With a live signer installed, a **payout worker** (`lib/payout-worker.ts`) sends
  approved ones automatically — small ones straight away, large ones after a person approves — and records each
  transaction's hash at the moment it is sent. A payout found mid-flight after a crash is settled by looking that
  hash up on-chain; one with no hash is marked failed for a person to check (it might have gone out, and a retry could
  pay twice). `PAYOUT_AUTO_SUBMIT=false` leaves `POST /payouts/:id/submit` to an operator instead.
- **Sweeping** (`lib/sweeper.ts`, off unless `SWEEP_ENABLED=true`) moves confirmed deposits from their one-time
  addresses to a treasury address. A separate gas wallet drips each address just what its transfer needs (estimated, plus
  a margin), then the address's own key signs the transfer. It is a resumable state machine that records every hash as
  it is sent, never sends twice, defers when gas is above `SWEEP_MAX_GAS_GWEI`, and records failures for a person to
  review (`POST /sweeps/:id/retry`). Late, short and unclaimed funds are never swept automatically; an operator can sweep
  one with `POST /sweeps {deposit_id, reason}`. Tokens of the wrong kind sent to a deposit address stay where they are.
- **Deposit keys** (`lib/keystore.ts`) are envelope-encrypted: each key is sealed with AES-GCM under a data key, the
  data key is wrapped by Vault transit or AWS KMS (`KEY_WRAP_PROVIDER=vault|awskms`; `env` is for development and warns
  in production), and every blob is bound to its deposit's address, so a blob copied onto another row won't open.

`scripts/multi-asset-e2e.cjs` exercises all of it against real token contracts on a local chain
(`E2E_KEY_WRAP=vault` runs it with the keys wrapped by a real Vault).

**Not covered:** the treasury is outside this service. Topping up the payout wallet from it is a manual, custodial
step. Native-coin dust is left at each swept address (returning it would cost about what it is worth). Wrong-token
transfers to a deposit address are not recovered automatically.
