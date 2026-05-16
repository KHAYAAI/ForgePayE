# ForgePay — Technical Platform Overview & Launch Readiness Assessment

**Date:** May 16, 2026  
**Branch:** `claude/forgepay-platform-design-gEkgE`  
**Commit:** Current HEAD (5d53146+)

---

## Executive Summary

ForgePay is a full-stack autonomous-agent payment platform built on a Hyperswitch fork (Rust payment router core) extended with 20 TypeScript/Python microservices, 3 Next.js applications, 6 shared SDK/integration packages, and a complete Kubernetes/Helm deployment manifest. The platform uniquely serves both traditional B2B/enterprise treasury needs and the emerging AI-agent economy — supporting USDC/USDT stablecoins, crypto invoices, intercompany netting, credit lines, and reputation-gated autonomous transactions.

**Platform maturity as of May 16, 2026:** ~82% complete for MVP launch.

---

## 1. Architecture Overview

### 1.1 Core Design Principles

- **Event-driven single source of truth** — the unified-router (port 8000) normalizes all payment events from every sub-system into a canonical `ForgePayEvent` schema and fans out to merchants via HMAC-SHA256 signed webhooks.
- **Polyglot service mesh** — Rust (payment core), TypeScript/Fastify 5 (agent & treasury services), Python/FastAPI (MoR, compliance, forecasting), Java/Kill Bill (billing).
- **Native fetch + AbortSignal.timeout()** everywhere in TS services — no axios dependency, consistent 15-second circuit-breaker pattern.
- **Security-first** — scrypt (N=16384, r=8, p=1) passwords, HMAC-SHA256 webhooks, @fastify/helmet on every service, PCI vault mandatory, secrets in Vault/AWS SM never hardcoded.
- **Agent-native** — every service exposes `GET /v1/agent/tools` returning a machine-readable tool manifest for autonomous AI agent discovery.

### 1.2 Service Communication Map

```
Internet
    │
    ├─► Hyperswitch Router (Rust) :8080  ──► unified-router :8000
    │                                          │
    ├─► stablecoin-gateway :8020  ────────────►│  (canonical ForgePayEvent fan-out)
    │                                          │
    ├─► crypto-gateway :8030  ────────────────►│
    │                                          │
    └─► billing-engine (Kill Bill) :8080 ─────►│
                                               │
                           bank-connectivity :3006 (Plaid / Open Banking)
                                               │
                           yield-engine :3007 (Aave / Compound / Ondo)
                                               │
                           rwa-registry :3008  (tokenized real-world assets)
                                               │
              ┌─────────────── Agent Layer ────┴──────────────────────────┐
              │ agent-identity :3010     agent-negotiation :3011          │
              │ enterprise-treasury :3012  agent-decision-framework :3013 │
              │ agent-liquidity-manager :3014  agent-credit-lines :3016   │
              │ institutional-reporting :3017                              │
              └────────────────────────────────────────────────────────────┘
                                               │
              ┌─────────── Support Layer ──────┴──────────────────────────┐
              │ bank-whitelabel :3015  mor-layer :8010                    │
              │ compliance-monitor :8003  liquidity-forecaster :8002      │
              └────────────────────────────────────────────────────────────┘
                                               │
              ┌────────────── Frontend ─────────┴─────────────────────────┐
              │ web :3000 (Next.js 14 — marketing/landing)                │
              │ dashboard :3001 (Next.js 14 — merchant analytics)         │
              │ vscode-extension (IDE billing assistant)                   │
              └────────────────────────────────────────────────────────────┘
```

---

## 2. Service-by-Service Technical Deep Dive

### 2.1 Payment Core (Hyperswitch Fork)

| Attribute | Detail |
|---|---|
| Language | Rust (Cargo workspace) |
| Port | 8080 |
| Test coverage | Upstream Hyperswitch test suite |
| Status | Pinned to upstream SHA in `forgepay/config/base/pinned-upstreams.yaml` |

The Rust payment router handles card authorization, tokenization through the PCI vault (non-negotiable — never disabled), and connector routing. ForgePay-specific patches are isolated; upstream Hyperswitch changes are pull-only, never affecting `forgepay/` directories.

**Critical constraint:** All card data goes through the vault. The `DISABLE_PCI_VAULT` flag is blocked by policy.

---

### 2.2 Unified Router — The Event Bus

| Attribute | Detail |
|---|---|
| Port | 8000 (HTTP) / 9090 (Prometheus) |
| Language | TypeScript / Fastify 5 |
| Key files | `src/index.ts` (101 lines), `src/normalizers/*.ts`, `src/lib/{crypto,dedup,dispatch,redis,db}.ts` |
| Tests | 5 test files (Vitest) |
| Infrastructure | PostgreSQL (`forgepay_events` table), Redis (7-day dedup TTL) |

**Pipeline per event:**
1. Verify HMAC-SHA256 source signature (`lib/crypto.ts`)
2. Deduplicate via Redis (idempotency key, 7-day TTL)
3. Normalize to `ForgePayEvent` schema (normalizers for Hyperswitch, Kill Bill, stablecoin, crypto)
4. Persist to `forgepay_events` (PostgreSQL)
5. Fan-out: query `merchant_webhook_endpoints`, POST signed payloads with exponential retry

**Inbound endpoints:**
- `POST /webhooks/hyperswitch` — payment-engine events
- `POST /webhooks/killbill` — subscription lifecycle events
- `POST /webhooks/stablecoin` — USDC/USDT + x402 settlement
- `POST /webhooks/crypto` — BTC/ETH/LTC/XMR invoice events

OpenTelemetry instrumentation via OTel Collector → Prometheus scrape at `:9090/metrics`.

---

### 2.3 Agent Identity — Registry & Reputation

| Attribute | Detail |
|---|---|
| Port | 3010 |
| Language | TypeScript / Fastify 5 / PostgreSQL |
| Key files | `src/reputation.ts`, `src/store.ts`, `src/db.ts`, `src/types.ts` |
| Tests | 23 tests (Vitest + HTTP integration) |
| Status | **90% complete** |

**Reputation algorithm** (`src/reputation.ts`):

Score deltas clamped to [0, 1000]:
```
transaction_success:  +5    |  fraud_detected:   -100
transaction_failure:  -10   |  vouched_by_trusted: +30
dispute_raised:       -20   |
dispute_resolved:     +15   |
late_payment:         -8    |
```

Trust levels: `unverified` (0–199) → `verified` (200–499) → `trusted` (500–799) → `premium` (800+)

**Key API:**
- `POST /v1/agents` — register agent with DID, framework (elizaos, autogen, crewai, langchain, custom), capabilities
- `POST /v1/agents/:id/events` — record reputation event
- `POST /v1/agents/:id/attestations` — peer attestation
- `POST /v1/agents/:id/penalty` — admin penalty (called by agent-credit-lines on default)
- `GET  /v1/agents?framework=elizaos` — filtered registry

---

### 2.4 Agent Negotiation — Quote→Accept→Pay→Escrow

| Attribute | Detail |
|---|---|
| Port | 3011 |
| Language | TypeScript / Fastify 5 / PostgreSQL |
| Key files | `src/negotiation.ts`, `src/escrow.ts`, `src/store.ts` |
| Tests | 26 tests (Vitest + HTTP integration) |
| Status | **85% complete** — missing: payment dispatch integration |

Sessions expire at 24h via `setInterval` cleanup in `src/index.ts`. Manual sweep endpoint: `POST /v1/sessions/sweep-expired`.

**Session lifecycle:** `active` → `quoted` → `accepted` → `settled` | `rejected` | `expired` | `disputed`

Escrow holds funds until settlement confirmation; dispute triggers reputation penalty on both agents via agent-identity.

---

### 2.5 Enterprise Treasury — Cash Visibility & Intercompany Netting

| Attribute | Detail |
|---|---|
| Port | 3012 |
| Language | TypeScript / Fastify 5 |
| Key files | `src/consolidator.ts`, `src/rules-engine.ts`, `src/netting.ts`, `src/index.ts` |
| Tests | 43 tests across 4 test files |
| Status | **90% complete** |

**Consolidator** (`src/consolidator.ts`):
- FX rate cache: 1-hour TTL, static fallback covering USD, EUR, GBP, JPY, CHF, CAD, AUD, SGD, NOK, DKK, HKD, MXN, INR, WETH
- `GET /v1/cash-position` — real-time consolidated view across subsidiaries
- `GET /v1/fx-rates` / `POST /v1/fx-rates/refresh` — live rate management

**Rules Engine** (`src/rules-engine.ts`):
- Rule types: `sweep_to_yield`, `repatriate_from_yield`, `allocate_tax_escrow`, `send_intercompany`, `notify_cfo`, `require_approval`
- `approvalRequired` rules enqueue to `pendingApprovals` + fire alert webhook
- `GET /v1/rules/approvals` / `POST /v1/rules/approvals/:id/resolve`

**Netting Engine** (`src/netting.ts`):
- Graph-based bilateral netting: `O(n²)` pair iteration with directed adjacency map
- Net obligations calculated as `|forward - reverse|`; wire vs stablecoin routing at $1M threshold
- Settlement reference format: `NET-{fromSubsidiary}-{toSubsidiary}-{YYYY-MM-DD}`
- `POST /v1/netting/settle?execute=true` — dispatches to bank-connectivity `/v1/transfers/wire` or `/v1/transfers/stablecoin`
- Fee savings: `$25 × min(forwardTxCount, reverseTxCount)` per wire avoided

---

### 2.6 Agent Decision Framework — Risk Scoring & Policy Gates

| Attribute | Detail |
|---|---|
| Port | 3013 |
| Language | TypeScript / Fastify 5 / Zod |
| Key files | `src/risk-scorer.ts`, `src/policies.ts`, `src/velocity.ts`, `src/decision-log.ts` |
| Tests | 21 tests (policies: 7, risk-scorer: 14) |
| Status | **80% complete** — missing: persistent storage |

**Risk score computation** (`src/risk-scorer.ts`):
```
score = reputationScore (from agent-identity, default 500 if unreachable)
      + amountRisk (0 for <$1k, up to -30 for >$100k)
      + velocityRisk (rolling 1h/24h/7d window violations)
      + policyRisk (per matching global/agent-specific policy)
```
Score range [0, 100]. Decisions: `approve` (≥70), `review` (50–69), `reject` (<50).

**Velocity tracking** (`src/velocity.ts`): rolling windows at 1h, 24h, 7d per agent per action type. Configurable max transaction counts and amounts per window.

**Policy engine** (`src/policies.ts`): CRUD for global policies with priority ordering. Per-agent overrides (risk tolerance, daily limits, blocklist) stored separately. Supports `enabled` flag for hot-disable without deletion.

**Decision audit log** (`src/decision-log.ts`): last 500 decisions, queryable by agentId, decision, reasons.

---

### 2.7 Agent Liquidity Manager — Portfolio Rebalancing

| Attribute | Detail |
|---|---|
| Port | 3014 |
| Language | TypeScript / Fastify 5 / Zod |
| Key files | `src/rebalancer.ts`, `src/sweeper.ts`, `src/store.ts` |
| Tests | 26 tests (rebalancer: 14, store: 5, sweeper: 7) |
| Status | **75% complete** — missing: yield-engine integration tests |

**Rebalancer** (`src/rebalancer.ts`): computes drift from target allocation, triggers sweep/liquidate when any asset deviates >2%. Hysteresis gap enforcement: `autoLiquidateBelowUsd` must be ≤ `minLiquidStableUsd × 0.5` to prevent thrashing (documented in runbook).

**Sweeper** (`src/sweeper.ts`): sends yield-engine sweep commands via native fetch with 15-second timeout. Records sweep history per agent. `sweepEnabled` flag allows per-agent pause (used in runbook P2 remediation).

**Per-agent policy** (`src/store.ts`): `minLiquidStableUsd`, `autoLiquidateBelowUsd`, `targetAllocations: Record<string, number>`, `sweepEnabled`.

---

### 2.8 Agent Credit Lines — Net-30/60/90 for AI Agents

| Attribute | Detail |
|---|---|
| Port | 3016 |
| Language | TypeScript / Fastify 5 / Zod |
| Key files | `src/assessor.ts`, `src/draws.ts`, `src/store.ts` |
| Tests | 23 tests (assessor: 8, draws: 10, store: 5) |
| Status | **70% complete** — missing: Hyperswitch payment dispatch, repayment UI |

**Credit assessor** (`src/assessor.ts`): multi-factor scoring:
- Agent age (days since registration)
- Reputation score (from agent-identity)
- Historical default rate
- Transaction volume (30-day)
- Counterparty diversity

Credit limit formula: `base × reputationMultiplier × ageMultiplier × volumeMultiplier`. Net terms (30/60/90 days) determined by trust level.

**Draw lifecycle** (`src/draws.ts`): `pending` → `approved` → `active` → `repaid` | `defaulted`. `POST /v1/draws/check-overdue` — batch overdue detection, fires reputation penalty to agent-identity on default. Default threshold: past-due by ≥1 day after due date.

**Mass default protection** (runbook P1): `POST /v1/credit-lines/{id}/suspend` on all active lines, then investigate via `GET /v1/draws?status=defaulted`.

---

### 2.9 Institutional Reporting — CFO/Auditor Layer

| Attribute | Detail |
|---|---|
| Port | 3017 |
| Language | TypeScript / Fastify 5 / Zod |
| Key files | `src/generators/`, `src/store.ts`, `src/csv.ts`, `src/index.ts` |
| Tests | 26 tests (csv: 12, store: 8, generators: 6) |
| Status | **65% complete** — missing: scheduler for automatic report generation |

**Report types:** `cash_flow`, `yield_income`, `netting`, `audit_trail`, `tax_filing`

**Tax filing jurisdictions:** US (1099-INT, Form 8949, 1040), UK (VAT Return, CT600), EU (VAT MOSS), SG (IRAS Form C, GST-F5), AU (BAS G1/1A/1B/7)

**CSV export** (`src/csv.ts`): RFC-4180 compliant, proper double-quote escaping, CRLF line endings. Available for cash_flow, netting, audit_trail, yield_income reports.

**Resilience pattern**: all generators capture upstream failures in `data_source_errors[]` on the report — auditors receive partial data rather than an error, with source attribution.

**Report store** (`src/store.ts`): in-memory Map keyed by UUIDv4. Tracks `sizeBytes` (Buffer.byteLength of JSON), `generatedByCorrelationId` for agent traceability. In production: PostgreSQL + S3 archival.

---

### 2.10 Bank Whitelabel — Partner Bank API Layer

| Attribute | Detail |
|---|---|
| Port | 3015 |
| Language | TypeScript / Fastify 5 / ESM |
| Key files | `src/store.ts`, `src/routes/customers.ts`, `src/routes/transactions.ts`, `src/routes/webhooks.ts`, `src/audit.ts` |
| Tests | 14 tests |
| Status | **90% complete** |

**Password security** (`src/store.ts`): scrypt (N=16384, r=8, p=1) with 16-byte random salt. Format: `scrypt:<saltHex>:<hashHex>`. Constant-time comparison via `crypto.timingSafeEqual`.

**KYC webhook** (`src/routes/customers.ts`): HMAC-SHA256 signed, fires to bank's configured `webhookUrl` on any `kycStatus` change. Native fetch with 10-second timeout.

**Daily limits**: `getTodayVolumeForCustomer()` sums `confirmed + pending` `amountUsd` since UTC midnight. Exceeded limit returns 422 with `{dailyLimitUsd, todayUsedUsd, remainingUsd}`.

**Audit log** (`src/audit.ts` + `src/store.ts`): `AuditLog` store (append-only `AuditEntry[]`) records `adminId, bankId, role, action, entityId, ip` on every write. `GET /v1/audit` — super_admin sees all, admin sees own bank scoped.

**ISO 20022** (`src/routes/webhooks.ts`): pacs.002.001.10 proper structure with `@xmlns`, `GrpHdr` (MsgId, CreDtTm, NbOfTxs), `TxInfAndSts` (OrgnlEndToEndId, TxSts, StsRsnInf).

---

### 2.11 Bank Connectivity — Plaid + Open Banking

| Attribute | Detail |
|---|---|
| Port | 3006 |
| Language | TypeScript / Fastify 4 / Prisma / Plaid SDK |
| Key files | `src/plaid/client.ts`, `src/openbanking/client.ts`, `src/routes/transfers.ts`, `src/services/transferService.ts` |
| Tests | 1 test file |
| Status | **60% complete** — missing: Helm chart, open banking provider expansion, wire/stablecoin endpoints needed by enterprise-treasury |

**Transfer types**: ACH, SEPA, wire (via `src/routes/transfers.ts`). The enterprise-treasury settlement dispatcher calls `POST /v1/transfers/wire` and `POST /v1/transfers/stablecoin` — the `stablecoin` endpoint needs to be added.

**Critical gap**: `POST /v1/transfers/stablecoin` endpoint required by enterprise-treasury netting dispatch. Currently only wire/ACH/SEPA exist.

---

### 2.12 Yield Engine — Multi-Protocol Yield Optimization

| Attribute | Detail |
|---|---|
| Port | 3007 |
| Language | TypeScript / Fastify 4 / ethers |
| Key files | `src/routes/{positions,sweep,vaults,yields}.ts`, `src/adapters/{aave,compound,ondo}.ts`, `src/services/apyAggregator.ts` |
| Tests | 1 test file (apyAggregator) |
| Status | **70% complete** — missing: Helm chart, real RPC integration tests |

Adapters for Aave v3, Compound v3, Ondo Finance. APY aggregator selects highest-yielding vault per asset. Sweep trigger endpoint (`POST /v1/sweep/trigger`) called by enterprise-treasury rules-engine and agent-liquidity-manager.

---

### 2.13 MoR Layer — Merchant of Record

| Attribute | Detail |
|---|---|
| Port | 8010 |
| Language | Python 3.12 / FastAPI / SQLAlchemy / asyncpg / Redis |
| Key files | `api/`, `auth/`, `bridges/`, `db/`, `tax/` |
| Tests | 7 test files (pytest) |
| Status | **75% complete** |

Handles merchant-of-record tax collection, cross-border checkout, subscription bridges to Kill Bill. Tax engine with jurisdiction lookup. Redis-backed session state.

---

### 2.14 Stablecoin Gateway

| Attribute | Detail |
|---|---|
| Port | 8020 |
| Language | TypeScript / Fastify 5 / ethers / Redis / PostgreSQL |
| Key files | `src/routes/`, `src/plugins/`, `src/db/` |
| Tests | 2 test files |
| Status | **80% complete** |

USDC/USDT on Ethereum, Polygon, Solana. x402 HTTP payment protocol support. On-chain settlement confirmation with block finality tracking. WebSocket subscription for real-time payment status.

---

### 2.15 Crypto Gateway

| Attribute | Detail |
|---|---|
| Port | 8030 |
| Language | TypeScript / Fastify 5 / bitcoinjs-lib / ethers / Redis / PostgreSQL |
| Key files | `src/routes/`, `src/db/`, `src/plugins/` |
| Tests | 2 test files |
| Status | **80% complete** |

BTC, ETH, LTC, XMR invoice generation and confirmation. HD wallet derivation (BIP32/BIP44) for address isolation per invoice. Mempool monitoring with configurable confirmation thresholds.

---

### 2.16 Compliance Monitor

| Attribute | Detail |
|---|---|
| Port | 8003 |
| Language | Python 3.12 / FastAPI / APScheduler / Redis |
| Key files | `kyc/`, `monitoring/`, `reporting/`, `sanctions/` |
| Tests | 1 test file |
| Status | **60% complete** — missing: Helm chart, OFAC real-time feed integration |

OFAC/UN sanctions screening, KYC status monitoring, AML transaction pattern detection. APScheduler for periodic compliance sweeps.

---

### 2.17 Liquidity Forecaster

| Attribute | Detail |
|---|---|
| Port | 8002 |
| Language | Python 3.12 / FastAPI / pandas / scikit-learn / statsmodels |
| Key files | `forecasting/`, `data/`, `routers/`, `alerts/` |
| Tests | 1 test file |
| Status | **55% complete** — missing: Helm chart, model training pipeline |

ML-based cash flow forecasting (ARIMA + gradient boosting ensemble). Alert dispatch when projected balance falls below configured threshold. Feeds enterprise-treasury rules engine.

---

### 2.18 Chain Sync

| Attribute | Detail |
|---|---|
| Port | 8040 |
| Language | TypeScript / Fastify 4 / PostgreSQL / ethers |
| Tests | 1 test file |
| Status | **70% complete** |

Blockchain event indexer for Ethereum mainnet + L2s (Arbitrum, Optimism, Base). Syncs ERC-20 transfer events to `chain_events` PostgreSQL table. Feeds stablecoin-gateway and rwa-registry.

---

### 2.19 RWA Registry — Real-World Asset Tokenization

| Attribute | Detail |
|---|---|
| Port | 3008 |
| Language | TypeScript / Fastify 5 |
| Tests | 1 test file |
| Status | **65% complete** |

Registry for tokenized real-world assets (treasuries, money market funds, real estate). Asset NAV tracking, investor KYC gate, transfer eligibility checks against compliance-monitor.

---

### 2.20 Billing Engine (Kill Bill)

| Attribute | Detail |
|---|---|
| Language | Java |
| Status | **Configuration only** — Kill Bill kaui + integration config present, no custom plugins |

Subscription lifecycle (trial → active → dunning → cancelled), metered billing, proration. Webhooks routed through unified-router. Needs Kill Bill plugin development for ForgePay-specific payment methods.

---

## 3. Frontend Applications

### 3.1 Marketing Site (`forgepay/apps/web` — Port 3000)

Next.js 14, React 18, Tailwind CSS with brand colors (Navy `#0A2540`, Cyan `#00F0FF`), Inter font. Marketing landing page, pricing, docs entry point.

**Status:** Functional shell, content population needed.

### 3.2 Merchant Dashboard (`forgepay/apps/dashboard` — Port 3001)

Next.js 14, React 18, next-auth, `@anthropic-ai/sdk` integration, Polar fork. Analytics views, webhook configuration, agent management, real-time event streaming.

**Status:** ~10% complete — largest remaining frontend gap.

### 3.3 VS Code Extension (`forgepay/apps/vscode-extension`)

TypeScript, eventsource-parser. IDE-integrated AI billing assistant using ForgePay APIs. Surfaces revenue data and payment analytics directly in the developer IDE.

---

## 4. Shared Packages & SDKs

| Package | Language | Completeness | Purpose |
|---|---|---|---|
| `sdk-js` | TypeScript | ~80% | Full ForgePay API SDK — all REST endpoints, typed responses, webhook verification helpers |
| `sdk-python` | Python 3.10–3.12 | ~75% | Python SDK, async client, pytest fixtures |
| `forge-agent` | TypeScript | ~70% | Hermes-pattern AI billing assistant, tool definitions for Claude |
| `claude-agents-cookbook` | TypeScript | ~60% | Reference Claude agents using ForgePay — payment authorization, invoice generation |
| `elizaos-plugin` | TypeScript | ~85% | x402 payment plugin for ElizaOS agents, published-ready |
| `swarms-integration` | TypeScript | ~65% | ForgePay payment tools for Swarms multi-agent framework |

---

## 5. Infrastructure

### 5.1 Kubernetes & Helm

**18 Helm charts** covering all production services:

```
forgepay/infra/helm/
├── accounts-service/       ├── agent-credit-lines/
├── agent-decision-framework/ ├── agent-identity/
├── agent-liquidity-manager/  ├── agent-negotiation/
├── bank-whitelabel/        ├── billing-engine/
├── chain-sync/             ├── crypto-gateway/
├── enterprise-treasury/    ├── institutional-reporting/
├── mor-layer/              ├── rwa-registry/
├── stablecoin-gateway/     ├── unified-router/
├── forgepay-stack/         └── payment-engine/
```

**Missing Helm charts:** bank-connectivity, compliance-monitor, liquidity-forecaster, yield-engine.

All charts include:
- `Deployment` — non-root securityContext (`runAsUser: 1000`), `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, capabilities dropped
- `Service` — ClusterIP with named `http` port
- `HPA` — autoscaling/v2, CPU 70% + memory 80% targets, 2–8 replicas
- `secretRef` (optional) pointing to Vault-managed secret
- Readiness/liveness probes on `/health`

### 5.2 Local Development

```bash
# Full stack
docker compose -f forgepay/infra/k8s/docker-compose.dev.yml up

# Individual services
cd forgepay/services/<name> && npm run dev    # TypeScript
cd forgepay/services/<name> && uvicorn main:app --reload  # Python
```

### 5.3 Observability

- **OpenTelemetry** — unified-router exports traces to OTel Collector
- **Prometheus** — all services annotated `prometheus.io/scrape: "true"` on their respective ports
- **Monitoring stack** — `forgepay/infra/observability/` (Grafana dashboards, alert rules)
- **Load tests** — `forgepay/infra/load-tests/` (k6 scripts)

### 5.4 Secrets Management

- All Kubernetes secrets via Vault or AWS Secrets Manager (documented in `forgepay/config/SECRETS_MANAGEMENT.md`)
- Never hardcoded in Helm values
- HMAC-SHA256 webhook signing secrets rotated per-merchant

### 5.5 Smart Contracts

- Solidity contracts with ZK proofs (MiMC circuit, Poseidon hasher) in `forgepay/infra/contracts/`
- `NullifierRegistry` for double-spend prevention
- PoseidonHasher pragma `^0.8.20`

---

## 6. Test Coverage Summary

| Service | Tests | Framework |
|---|---|---|
| enterprise-treasury | **43** | Vitest |
| agent-identity | **23** | Vitest + HTTP |
| agent-negotiation | **26** | Vitest + HTTP |
| agent-credit-lines | **23** | Vitest |
| agent-decision-framework | **21** | Vitest |
| agent-liquidity-manager | **26** | Vitest |
| institutional-reporting | **26** | Vitest |
| bank-whitelabel | **14** | Vitest |
| mor-layer | 7 files | pytest |
| crypto-gateway | 2 files | Vitest |
| stablecoin-gateway | 2 files | Vitest |
| unified-router | 5 files | Vitest |
| bank-connectivity | 1 file | Vitest |
| yield-engine | 1 file | Vitest |
| chain-sync, rwa-registry, compliance-monitor, liquidity-forecaster | 1 each | Vitest/pytest |

**Total test count (TypeScript services, new agent layer):** ~202 passing tests across 8 services.

---

## 7. Launch Readiness Assessment

### 7.1 Domain Readiness Matrix

| Domain | Readiness | Blocker? | Notes |
|---|---|---|---|
| Payment processing (Hyperswitch) | ✅ 95% | No | PCI vault required, upstream tests passing |
| Stablecoin payments (USDC/USDT) | ✅ 80% | No | x402 protocol complete |
| Crypto invoicing (BTC/ETH) | ✅ 80% | No | HD wallet isolation verified |
| Webhook event pipeline | ✅ 85% | No | HMAC, dedup, fan-out tested |
| Subscription billing (Kill Bill) | ⚠️ 50% | Yes for SaaS | Kill Bill plugins needed |
| MoR / tax | ✅ 75% | No | Jurisdiction coverage incomplete |
| Bank connectivity | ⚠️ 60% | Yes | Missing `/v1/transfers/stablecoin` endpoint |
| Enterprise treasury | ✅ 90% | No | 43 tests, approval workflow complete |
| Agent identity & reputation | ✅ 90% | No | 23 tests, scoring algorithm complete |
| Agent negotiation | ✅ 85% | No | 26 tests, expiry sweep working |
| Agent decision framework | ✅ 80% | No | 21 tests, velocity tracking complete |
| Agent liquidity manager | ✅ 75% | No | 26 tests, hysteresis enforcement done |
| Agent credit lines | ✅ 70% | No | 23 tests, overdue/default detection done |
| Institutional reporting | ✅ 65% | No | 26 tests, 5 report types + CSV export |
| Bank whitelabel | ✅ 90% | No | scrypt, audit log, ISO 20022 done |
| Compliance/OFAC screening | ⚠️ 60% | Yes (regulated) | Real-time OFAC feed not wired |
| Merchant dashboard | ⚠️ 10% | Yes | Largest remaining gap |
| ElizaOS plugin | ✅ 85% | No | Ready to publish |
| SDK (JS + Python) | ✅ 77% | No | Core endpoints covered |
| Helm / K8s deployment | ✅ 82% | No | 4 charts missing |

### 7.2 Critical Path to Launch (Priority Order)

**P0 — Must-fix before any production traffic:**

1. **`POST /v1/transfers/stablecoin` in bank-connectivity** (≈1 day) — enterprise-treasury netting dispatch calls this endpoint; without it, stablecoin settlement is broken.
2. **Compliance-monitor OFAC real-time feed** (≈3 days) — required for regulated payment operations in US jurisdiction.
3. **Kill Bill plugin for ForgePay payment methods** (≈2 weeks) — subscription billing is blocked without it.

**P1 — Required for full feature set:**

4. **Merchant dashboard** (≈8 weeks, Next.js, largest effort) — merchants currently have no UI to configure webhooks, view analytics, or manage agents.
5. **Helm charts for 4 missing services**: bank-connectivity, compliance-monitor, liquidity-forecaster, yield-engine (≈2 days).
6. **Persistent storage** for agent-decision-framework, agent-credit-lines, agent-liquidity-manager, institutional-reporting — currently in-memory; needs PostgreSQL migration (≈2 weeks).
7. **Liquidity forecaster model training pipeline** (≈2 weeks) — ML model currently untrained.

**P2 — Launch quality:**

8. **k6 load test coverage** for agent services (≈1 week)
9. **institutional-reporting scheduled report generation** (APScheduler or cron) — CFOs expect automated delivery.
10. **`agent-negotiation` → payment dispatch integration** (≈3 days) — accepted negotiations need to trigger actual payment through Hyperswitch.

### 7.3 Estimated Launch Timeline

```
Week 1-2:  P0 items (stablecoin endpoint, OFAC feed, Kill Bill plugin start)
Week 3-4:  P1 Helm charts + persistent storage for agent layer
Week 5-6:  Kill Bill plugin completion + agent-negotiation payment dispatch
Week 7-10: Dashboard MVP (auth, analytics, webhook config, agent management)
Week 11-12: Load testing, security audit, production hardening
Week 13:   Staged rollout (beta customers)
Week 14:   GA launch
```

---

## 8. Security Posture

| Control | Status |
|---|---|
| PCI vault (Hyperswitch) | ✅ Enforced — never disabled |
| HMAC-SHA256 webhook verification | ✅ All inbound webhooks verified |
| Password hashing (scrypt N=16384) | ✅ bank-whitelabel, timingSafeEqual comparison |
| @fastify/helmet | ✅ All TS services |
| Rate limiting (per-minute) | ✅ All TS services |
| JWT authentication | ✅ All protected routes |
| Kubernetes secret management | ✅ Vault/AWS SM via secretRef |
| Non-root container execution | ✅ All Helm charts (runAsUser: 1000) |
| readOnlyRootFilesystem | ✅ All Helm charts |
| CORS origin control | ✅ All TS services (env-configurable) |
| OFAC sanctions screening | ⚠️ compliance-monitor present but real-time feed missing |
| SOX audit trail | ✅ bank-whitelabel AuditLog complete |
| ZK nullifier anti-double-spend | ✅ Smart contracts deployed |

**Remaining security gaps:**
- compliance-monitor OFAC real-time feed (P0 for US operations)
- mTLS between internal services (not yet configured)
- API key rotation automation

---

## 9. Agent Economy Differentiation

ForgePay's agent layer is the primary differentiator from traditional payment platforms. The full stack enables:

```
AI Agent (ElizaOS, AutoGen, CrewAI, LangChain, Swarms)
    │
    ├── Discover counterparties    agent-identity :3010
    ├── Negotiate terms            agent-negotiation :3011
    ├── Risk-gate the action       agent-decision-framework :3013
    ├── Execute payment            Hyperswitch :8080 (via decision approval)
    ├── Manage liquidity           agent-liquidity-manager :3014
    ├── Access credit              agent-credit-lines :3016
    └── Audit trail                institutional-reporting :3017
```

Each service exposes `GET /v1/agent/tools` — a machine-readable JSON manifest listing all available operations with parameter schemas. Agents (Claude, GPT-4, Gemini) can autonomously discover and invoke platform capabilities without hardcoded API knowledge.

The `forge-agent` package implements the Hermes tool-use pattern, and `elizaos-plugin` is the most complete integration (85%), ready to publish to the ElizaOS plugin registry.

---

## 10. Operational Runbooks

`forgepay/docs/runbooks/agent-services.md` covers:

- **P1: Credit Line Mass Default** — freeze draws, identify defaulted agents, coordinate reputation penalties
- **P2: Agent Decision Framework Excessive Rejects** — inspect decision history, verify agent-identity reachability (default score 50 = high risk when unreachable), disable over-strict policies
- **P2: Liquidity Manager Sweep Loop** — pause sweep, widen hysteresis gap (autoLiquidateBelowUsd ≤ minLiquidStableUsd × 0.5)
- **P3: Negotiation Stuck in Quoted** — manually trigger `POST /v1/sessions/sweep-expired`

**Escalation:** P1 → page on-call + engineering-lead within 15 min | P2 → Slack #forgepay-agents within 30 min | P3 → ticket in `agent-platform` board.
