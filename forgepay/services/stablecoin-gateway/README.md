# ForgePay Stablecoin Gateway

Forked from [zpaynow/ZeroPay](https://github.com/zpaynow/ZeroPay) (MIT).

## Role

- Accept **USDC** and **USDT** payments on major chains (Ethereum, Solana, Base, Polygon, Arbitrum)
- Native **x402 protocol** support for AI/agent-to-agent payments
- Low fee: **0.8% + gas** per transaction
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
