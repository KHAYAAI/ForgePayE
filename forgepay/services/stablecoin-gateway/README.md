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
  The bureau *creates* payouts; submitting them (`POST /payouts/:id/submit`) is a separate operator step by design.

`scripts/multi-asset-e2e.cjs` exercises all of it against real token contracts on a local chain.
Funds sent to deposit addresses stay in those addresses (their keys are held encrypted in the database); there is no
sweep to a treasury wallet.
