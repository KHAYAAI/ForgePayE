# ForgePay Crypto Gateway

Forked from [dilan-dio4/Keagate](https://github.com/dilan-dio4/Keagate) (MIT).

## Role

- Accept **crypto payments** across a wide range of coins (BTC, ETH, LTC, XMR, and 50+ more)
- High-performance invoice-based payment flow
- Automatic exchange rate lookup and invoice expiry
- Fee: **0.8% + network gas**

## Key Capabilities

| Feature | Details |
|---|---|
| Supported coins | BTC, ETH, LTC, XMR, DOGE, BCH, XRP, SOL, and 50+ |
| Invoice flow | Fixed-amount invoices with QR codes |
| Expiry | Configurable (default: 15 min) |
| Confirmations | Chain-specific (BTC: 2, ETH: 12, etc.) |
| Underpayment | Configurable tolerance (default: 0.5%) |

## Key Modifications from Keagate Upstream

1. Payment events emit to **unified-router** (not custom webhooks)
2. Multi-tenant: HD wallet derivation per `(merchant_id, coin)`
3. Exchange rates sourced from CoinGecko + fallback to Binance
4. Admin API secured per-tenant (merchant can only see their own payments)

## Development

```bash
cd forgepay/services/crypto-gateway
npm install
npm run dev          # port 8040
```

## Upstream Pin

```yaml
crypto-gateway:
  source: https://github.com/dilan-dio4/Keagate
  commit: <pin-on-fork>
```
