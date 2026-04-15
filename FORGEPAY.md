# ForgePay — Platform Architecture

> **"Payments, forged better."**  
> Unified developer-first payments + billing + compliance. Competing directly with Stripe and Paddle.

---

## 1. Vision & Positioning

ForgePay is a **cloud-native, multi-tenant SaaS** that gives every developer one API and one dashboard to:

- Accept **fiat cards, bank transfers, stablecoins (USDC/USDT), and crypto**
- Act as **Merchant of Record** — automatic VAT/GST/sales-tax collection & remittance in 200+ countries
- Run **advanced subscription + usage-based billing** (metered, credits, entitlements, dunning, invoices)
- Route payments intelligently for best cost, speed, and success rate
- Support **AI/agent payments** natively (x402 protocol)

### Pricing (aggressive launch)

| Item | Price |
|---|---|
| Monthly platform fee | **$5 / paying merchant** |
| Fiat transaction | **2.2% + $0.20** |
| Stablecoin / Crypto | **0.8% + gas** |

---

## 2. Fused Open-Source Components

We build ForgePay by forking, modifying, and integrating five mature OSS projects:

| Component | Source | Language | Role |
|---|---|---|---|
| **payment-engine** | [juspay/hyperswitch](https://github.com/juspay/hyperswitch) | Rust | Payment orchestration core — 100+ processors, routing, vault, retries, reconciliation |
| **mor-layer** | [polarsource/polar](https://github.com/polarsource/polar) | Python + Next.js | Merchant of Record — tax logic, checkout, customer portal |
| **billing-engine** | [killbill/killbill](https://github.com/killbill/killbill) | Java | Subscriptions, usage metering, entitlements, dunning, invoicing |
| **stablecoin-gateway** | [zpaynow/ZeroPay](https://github.com/zpaynow/ZeroPay) | TypeScript/Node | Stablecoin-first (USDC/USDT) + x402 AI/agent support |
| **crypto-gateway** | [dilan-dio4/Keagate](https://github.com/dilan-dio4/Keagate) | TypeScript | High-performance crypto gateway, broad coin support |

All components are connected by the **unified-router** — a thin TypeScript service that normalizes webhooks and events across all sources into a single canonical ForgePay event stream.

### Attribution / Licenses
- Hyperswitch: Apache 2.0
- Polar: Apache 2.0
- Kill Bill: Apache 2.0
- ZeroPay: MIT
- Keagate: MIT

All forks must retain original license headers and `NOTICE` files. ForgePay additions are Apache 2.0.

---

## 3. Monorepo Structure

```
forgepaye/                        ← root = Hyperswitch fork (payment-engine)
├── crates/                       ← Hyperswitch Rust workspace crates (DO NOT MODIFY upstream logic)
├── config/                       ← Hyperswitch base config
│
├── forgepay/                     ← ALL ForgePay-specific additions live here
│   ├── apps/
│   │   ├── web/                  ← Marketing site (Next.js 14, App Router)
│   │   ├── dashboard/            ← Merchant dashboard (Next.js 14, from Polar)
│   │   └── docs/                 ← Developer docs (Mintlify/Docusaurus)
│   │
│   ├── services/
│   │   ├── unified-router/       ← NEW: webhook/event normalizer (TypeScript/Fastify)
│   │   ├── mor-layer/            ← Polar fork — MoR, tax, checkout (Python FastAPI)
│   │   ├── billing-engine/       ← Kill Bill config, plugins, wrapper (Java/Docker)
│   │   ├── stablecoin-gateway/   ← ZeroPay fork (TypeScript)
│   │   └── crypto-gateway/       ← Keagate fork (TypeScript)
│   │
│   ├── packages/
│   │   ├── sdk-js/               ← ForgePay JS/TS client SDK
│   │   ├── sdk-python/           ← ForgePay Python SDK
│   │   └── shared-types/         ← OpenAPI-generated canonical types
│   │
│   ├── infra/
│   │   ├── helm/                 ← Helm charts for every service
│   │   │   ├── payment-engine/
│   │   │   ├── unified-router/
│   │   │   ├── mor-layer/
│   │   │   ├── billing-engine/
│   │   │   ├── stablecoin-gateway/
│   │   │   ├── crypto-gateway/
│   │   │   └── forgepay-stack/   ← Umbrella chart (installs everything)
│   │   ├── terraform/            ← EKS / GKE / AKS provisioning
│   │   └── k8s/                  ← Kustomize overlays (dev / staging / prod)
│   │
│   └── config/
│       ├── base/                 ← Shared base config (all services)
│       └── environments/         ← dev.yaml, staging.yaml, prod.yaml
│
├── FORGEPAY.md                   ← This file
└── CLAUDE.md                     ← Claude Code guidance for this repo
```

### Key Structural Rule
The **root of this repo is the Hyperswitch fork** (payment-engine). This keeps upstream syncing clean — Hyperswitch changes land at root and never touch `forgepay/`.

---

## 4. Service Communication Map

```
                        ┌──────────────────────────────────┐
                        │         ForgePay Merchant         │
                        │   (API Key / Dashboard / SDK)     │
                        └────────────┬─────────────────────┘
                                     │
                        ┌────────────▼─────────────────────┐
                        │        Unified Router             │
                        │   (webhook normalizer + router)   │
                        │   TypeScript / Fastify            │
                        └──┬──────────┬──────────┬─────────┘
                           │          │          │
              ┌────────────▼──┐  ┌────▼────┐  ┌─▼──────────────────┐
              │ Payment Engine │  │ Billing │  │    MoR Layer       │
              │ (Hyperswitch) │  │ Engine  │  │    (Polar fork)    │
              │    Rust       │  │ (Kill   │  │  Python FastAPI    │
              │               │  │  Bill)  │  │  + Next.js dash    │
              └───┬───────────┘  └────┬────┘  └─────────┬──────────┘
                  │                   │                   │
         ┌────────┴──────────────┐    │              Tax API
         │                       │    │         (Avalara / TaxJar)
    ┌────▼──────┐  ┌─────────────▼─┐  │
    │Stablecoin │  │    Crypto      │  │
    │ Gateway   │  │   Gateway      │  │
    │(ZeroPay)  │  │  (Keagate)    │  │
    └───────────┘  └───────────────┘  │
                                       │
              ┌────────────────────────┘
              │
    ┌─────────▼──────────────────────────────┐
    │          Shared Infrastructure          │
    │  PostgreSQL (tenant-isolated schemas)   │
    │  Redis (sessions, idempotency, cache)   │
    │  OpenTelemetry → Prometheus + Grafana   │
    │  S3 / GCS (invoices, receipts)         │
    └────────────────────────────────────────┘
```

---

## 5. Data & Multi-Tenancy Model

- **PostgreSQL**: Each merchant gets an isolated `tenant_{merchant_id}` schema. Hyperswitch handles payment data (PCI scope). Kill Bill gets its own multi-tenant schema per their standard model.
- **Redis**: Used for idempotency keys, session tokens, webhook dedup, and rate limiting.
- **S3/GCS**: PDF invoices and receipts stored per `tenant/{merchant_id}/invoices/`.
- **Secrets**: All API keys and credentials in Kubernetes Secrets + Vault (HashiCorp or AWS Secrets Manager).

---

## 6. Security & Compliance

| Concern | Solution |
|---|---|
| PCI DSS (card data) | Hyperswitch vault — cards never touch ForgePay app layer |
| Stablecoin keys | KMS-wrapped, never in plaintext; ZeroPay HSM integration |
| Multi-tenant isolation | Postgres schema-per-tenant, row-level security on shared tables |
| Auth | JWT (short-lived) + API keys (hashed with Argon2id) |
| Webhooks | HMAC-SHA256 signed, retried with exponential backoff |
| Audit log | Append-only event log in Postgres per merchant |

---

## 7. Immediate Build Priorities

1. **[NOW]** Monorepo scaffold — directory structure, READMEs, Dockerfiles, Helm skeletons
2. **[NOW]** Marketing site — `forgepay/apps/web/` (Next.js 14, ForgePay brand)
3. **[NEXT]** Unified Router — the glue service connecting all components
4. **[NEXT]** Polar → Hyperswitch bridge — refactor Polar's payment calls to route through our Hyperswitch
5. **[NEXT]** Kill Bill → Hyperswitch plugin config — wire up billing to payment engine
6. **[NEXT]** Helm umbrella chart — one `helm install forgepay` deploys everything
7. **[THEN]** Dashboard — merchant onboarding, API keys, analytics
8. **[THEN]** SDK — JS + Python client libraries
9. **[THEN]** Load testing + observability baseline

---

## 8. Brand & Design Tokens

```css
--color-navy:   #0A2540;   /* primary background */
--color-cyan:   #00F0FF;   /* primary accent / CTA */
--color-white:  #FFFFFF;
--color-gray:   #8898AA;
--font-primary: 'Inter', sans-serif;
--font-mono:    'JetBrains Mono', monospace;
```

---

*Last updated: 2026-04-15 | Maintained by ForgePay Engineering*
