# ForgePay MoR Layer

Forked from [polarsource/polar](https://github.com/polarsource/polar) (Apache 2.0).

## Role

- **Merchant of Record**: ForgePay acts as the legal seller in 200+ countries
- Automatic VAT, GST, and sales tax calculation, collection, and remittance
- Checkout flows (hosted + embedded)
- Customer/developer portal
- Subscription management UI

## Key Modifications from Polar Upstream

1. **All payment calls route through Hyperswitch** (not Stripe directly)
   - Replace `polar.payment_methods.stripe.*` with `forgepay.hyperswitch.*`
   - Map Polar's `PaymentIntent` to Hyperswitch `PaymentsCreateRequest`
2. **Multi-tenant** — each merchant maps to a tenant ID propagated through all calls
3. **Brand** — ForgePay design tokens replace Polar's branding
4. Tax provider: configurable between Avalara, TaxJar, or internal rules engine

## Upstream Pin

```yaml
# forgepay/config/base/pinned-upstreams.yaml
mor-layer:
  source: https://github.com/polarsource/polar
  commit: <pin-on-fork>
```

## Development

```bash
# Python 3.12+, Poetry
cd forgepay/services/mor-layer
poetry install
poetry run uvicorn server.main:app --reload --port 8010
```

## Architecture

```
mor-layer (Python FastAPI, port 8010)
  ├── /checkout/*         → checkout sessions (calls Hyperswitch payment-engine)
  ├── /tax/*              → tax calculation + remittance
  ├── /customers/*        → customer management
  ├── /subscriptions/*    → subscription lifecycle (delegates to billing-engine)
  └── /webhooks/incoming  → Hyperswitch webhook handler
```
