# ForgePay Billing Engine

Wraps [killbill/killbill](https://github.com/killbill/killbill) (Apache 2.0).

## Role

- Enterprise-grade subscription billing
- Usage-based metering and rating
- Credits and entitlements system
- Dunning and retry logic
- Invoice generation and delivery
- Complex pricing models: flat, per-seat, metered, hybrid (ideal for AI/token products)

## Integration Architecture

Kill Bill runs as a standalone Java service behind the unified-router. We connect it to Hyperswitch via the [Hyperswitch-Kill Bill plugin](https://github.com/killbill/killbill-hyperswitch-plugin).

```
billing-engine (Kill Bill, port 8020)
  ├── Kill Bill core (Java, Shiro security)
  ├── hyperswitch-killbill plugin → calls payment-engine for actual charges
  ├── Postgres database (kill bill schema, separate from payment-engine)
  └── Kill Bill admin UI (port 8021, internal only)
```

## Configuration Files

```
forgepay/services/billing-engine/
  ├── Dockerfile                        ← Kill Bill + ForgePay plugins
  ├── docker-compose.override.yml       ← Local dev overrides
  ├── config/
  │   ├── killbill.properties           ← Main Kill Bill config
  │   ├── shiro.ini                     ← Auth config
  │   └── catalog/                      ← Billing catalog definitions
  │       ├── forgepay-base-catalog.xml ← ForgePay platform plans
  │       └── schema/                   ← Per-merchant catalog schema
  └── plugins/
      └── hyperswitch-killbill/         ← Plugin config + credentials
```

## Kill Bill → Hyperswitch Payment Flow

```
Kill Bill (scheduled payment)
  → hyperswitch-killbill plugin
  → POST /payments to payment-engine (Hyperswitch)
  → Payment result → Kill Bill payment state machine
  → Invoice updated → unified-router webhook emitted
```

## Upstream Pin

```yaml
billing-engine:
  source: https://github.com/killbill/killbill
  version: 0.24.x
  plugin:
    source: https://github.com/killbill/killbill-hyperswitch-plugin
    commit: <pin-on-fork>
```
