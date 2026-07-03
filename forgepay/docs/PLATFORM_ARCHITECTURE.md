# FORGE — Platform Architecture (Permanent Reference)

**Status:** authoritative architecture reference for the FORGE platform.
**Last updated:** 2026-07-02 · branch `claude/forgepay-platform-design-gEkgE`
**Scope:** 26 services, ~76,700 lines of FORGE TypeScript, two vendored
upstreams (OpenFireblocks, OpenPrivy), 10 console dashboards.

> Companion visual: `PLATFORM_DEPENDENCY_DIAGRAM.html` (open in a browser) —
> shows which service calls which, plus the event flows.

---

## 0. The organizing principle — the Revenue Ontology

Every service emits a **canonical event** into one append-only log
(`forgepay_events`). A payment, a threshold signature, a credit decision, a
treasury sweep — each is recorded once, in a shared shape, and every other
service reads from that same spine.

This is the difference between "six products a customer integrates separately"
and "one system where each product makes the others smarter." The credit
bureau can only score an agent because the wallet and custody events land in
the same log. The treasury can only auto-approve a draw because it sees the
same events the bureau does. **The integration is the moat; the ontology is
what makes the integration real rather than marketing.**

The repository is a **Hyperswitch fork** (Rust payment engine) at the root,
with all FORGE code under `forgepay/`.

---

## 1. Layers

```
   CONSUMERS / AGENTS / BANKS
        │
   ┌────▼──────────────────────────────────────────────┐
   │  Next.js console (10 dashboards) · marketing ·      │  PRESENTATION
   │  merchant checkout                                  │
   └────┬───────────────────────────────────────────────┘
        │ server-side proxy (/api/forge/*) — secrets stay server-side
   ┌────▼───────────────────────────────────────────────┐
   │  Payments(router) · Custody(3019) · Wallet(3020) ·  │  PRODUCT
   │  Agent-Credit-Bureau(3018) · Enterprise-Treasury(3012)│ SERVICES
   └────┬───────────────────────────────────────────────┘
        │ HMAC-signed webhooks
   ┌────▼───────────────────────────────────────────────┐
   │  unified-router (event bus, :8000)  ──►             │  SHARED SPINE
   │  Revenue Ontology (forgepay_events, append-only)    │
   └────┬───────────────────────────────────────────────┘
        │
   ┌────▼───────────────────────────────────────────────┐
   │  bank-connectivity · compliance-monitor · yield ·   │  SUPPORTING
   │  billing(KillBill) · stablecoin/crypto gateways · … │  SERVICES
   └────┬───────────────────────────────────────────────┘
        │
   ┌────▼───────────────────────────────────────────────┐
   │  Postgres(schema-per-service) · Redis · Vault ·     │  INFRA
   │  immudb · EKS · Prometheus/Grafana                  │
   └─────────────────────────────────────────────────────┘
```

Every TypeScript service shares one idiom: **Fastify 5 + zod + pg + in-memory
store (running source of truth) with best-effort Postgres persistence +
Prometheus `/metrics` + `/api/health`.** That uniformity is why 26 services
stay operable by separate teams.

---

## 2. Shared spine — `unified-router` + Revenue Ontology

**Role:** internal event bus. Every sub-service POSTs its raw webhook here;
the router normalizes it to a canonical `ForgePayEvent` and persists it.

**The 5-step pipeline (every event):**

1. **Verify** — HMAC-SHA256 checked with `timingSafeEqual`; invalid → 401.
   FORGE Custody/Wallet events additionally carry `X-Forge-Timestamp` and are
   verified over `${timestamp}.${body}` with a ±5-minute replay window.
2. **Normalize** — per-source normalizer maps the vendor payload to the
   canonical shape. Unknown type → 200 ACK and drop.
3. **Deduplicate** — `sourceEventId` written to Redis (7-day TTL); repeat →
   ACK and skip.
4. **Persist** — `INSERT … ON CONFLICT (source_event_id) DO NOTHING` into
   `forgepay_events` (second idempotency guard).
5. **Fan-out** — dispatched to merchant webhook endpoints without awaiting, so
   the ACK is never delayed.

**Event sources:** `payment-engine` (Hyperswitch), `billing-engine`
(Kill Bill), `stablecoin-gateway`, `crypto-gateway`, `forge-custody`,
`forge-wallet`.

**Canonical event types include:** `payment.*`, `crypto_payment.*`,
`subscription.*`, `invoice.*`, `tax.*`, `customer.*`,
`custody.signature.confirmed`, `wallet.transaction.confirmed`.

**Business rationale:** idempotency + signature verification + one canonical
schema is exactly what prevents the three trust-killing failure modes of
fintech — double-charge, forged webhook, lost event. Adding the 7th product is
a normalizer file, not a re-architecture.

---

## 3. Product platforms

### 3a. FORGE Payments (router + Hyperswitch)

**Role:** the decision engine — decides how each payment is signed/settled.

**Tier engine (`unified-router/src/lib/payment-routing.ts`), enforced in code:**

| Amount / condition | Route | Rationale |
|---|---|---|
| < $100K | **forge-wallet** (direct sign) | cheap, fast, consumer/agent tier |
| $100K – $1M | **optimal-path** (Stripe ACH → Circle USDC) | best cost/settlement via fallback chain |
| > $1M, institutional, or credit-line draw | **forge-custody** (threshold sign) | policy + approvals + MPC |

Hyperswitch underneath handles PCI card tokenization (vault always on) and
processor connections. The fallback chain targets ~99.7% success vs a single
processor's ~92%.

**Business rationale:** the tier boundary is both a cost optimization and the
cross-sell mechanic — a customer whose volume crosses a tier is automatically
introduced to the next product. The router *is* the GTM funnel as code.

### 3b. FORGE Custody (`forge-custody`, :3019) — OpenFireblocks integrated

**Role:** institutional 4-of-7 threshold signing for large transfers. No
single person holds a key that can move funds.

**Pipeline:** `POST /api/v1/sign` → policy → (approval gate) → threshold sign →
broadcast → 12-block confirm → `custody.signature.confirmed` to the ontology.

- **Auth:** `X-API-Key` + `X-Timestamp` + `X-Signature =
  HMAC(rawKey,"METHOD\nPATH\nTS\nBODY")`; ±5-min replay window; timing-safe;
  keys stored as SHA-256 only.
- **Policy engine (`policy.ts`):** daily aggregate limit, destination
  whitelist (case-insensitive), UTC time window, chain restriction,
  distinct-role approval threshold (e.g. CFO+CEO), **fail-closed** sanctions
  screen (production: unreachable compliance-monitor → deny). Violation →
  reject with reason code, before any key is touched.
- **Approval gate:** amounts ≥ threshold → `pending_approval`; distinct
  approvers *and* distinct roles enforced; final approval auto-signs.
- **Threshold signing:** `MpcCoordinatorSigner` calls the vendored Go MPC
  signer (`POST /sign` → signed RLP tx).
- **Audit:** append-only `audit_log` (no UPDATE/DELETE path in code).

**Storage (schema `forge_custody`):** workspaces, api_keys, policies, keys,
ceremonies, signing_requests, signing_approvals, signing_shares, audit_log.

**Business rationale:** highest value-per-transaction line (~1% of count, most
of value) and the credential that unlocks bank/fund customers. **Launch gate:**
upstream Phase 1 signs with a single shared key; distributed 4-of-7 ceremonies
are Phase 2, unaudited for customer funds → **Custody runs pilot/testnet only
until external crypto review + pen test pass.** Architecture is real (a $3M
Sepolia signature has been driven through it end-to-end via the real signer).

### 3c. FORGE Wallet (`forge-wallet`, :3020) — OpenPrivy integrated

**Role:** wallets with no seed phrases (consumers + agents) + the `did:forge`
identity layer.

- Signup → server-side Ed25519 keypair; private key **AES-256-GCM encrypted
  under scrypt(password, per-user salt)**. Plaintext key never persisted,
  never returned (asserted by test).
- Signing requires the password in-request; key decrypts only in that scope,
  signs, is discarded. Status `created → signed → broadcast → confirmed`.
- **Tier enforcement at the edge:** amount ≥ $100K → `409 {route:'forge-custody'}`.
- **2-of-3 social recovery:** ≤3 trusted contacts, single-use hash-stored
  expiring tokens, key rotation on completion.
- Identity: `did:forge:user_*` / `did:forge:agent_*`; DID-by-address lookup
  serves the credit bureau. JWT HS256-pinned, 1h expiry, brute-force-limited.

**Storage (schema `forge_wallet`):** users, wallets, encrypted_keys,
transactions, trusted_contacts, recovery_requests, recovery_approvals,
gas_sponsorship.

**Business rationale:** top-of-funnel and data source. Thin margin on its own
(SaaS + gas), but mints the DIDs and transaction stream the credit bureau
turns into a defensible product. Run near-cost to feed the thing with pricing
power.

### 3d. Agent Credit Bureau (`agent-credit-bureau`, :3018)

**Role:** "world's first credit bureau for autonomous AI agents" — FICO-style
0–1000 scoring and credit lines.

**How it works:** consumes `wallet.transaction.confirmed` +
`custody.signature.confirmed`, resolves the actor DID via Wallet's lookup, and
replays events into a scoring model (payment success rate, volume consistency,
compliance record, account age). Score → tier → automatic line ceiling. When
an agent exceeds its line, the bureau requests an extension from Enterprise
Treasury.

**Connections:** reads ontology, reads DIDs from Wallet, requests approvals
from Treasury; its scores gate whether Custody will sign a credit-funded draw.

**Business rationale:** the one genuinely differentiated, defensible product.
Scoring data compounds with volume; incumbents can't replicate it without the
agent's full cross-platform transaction graph. Highest margin (subscription +
inquiry share + interest on lines) and strongest moat.

### 3e. Enterprise Treasury (`enterprise-treasury`, :3012)

**Role:** unified treasury for enterprises with 50–300 accounts —
consolidation, intercompany netting, rule-driven sweeps, and the **approval
desk** for agent credit extensions.

**How it works:** pulls balances via bank-connectivity (15-min refresh),
consolidates cash position, runs a rules engine every 60s (sweep idle → yield,
auto-sweep agent repayments, low-balance alerts), computes intercompany
netting. Bureau extension request → treasury manager approves → line updates
in bureau → Custody authorized to settle draw from the enterprise custody
account → on term, a rule auto-sweeps principal + fee back.

**Business rationale:** ROI-provable CFO sell (hard netting savings), and the
human control point that makes agent credit palatable to enterprises.

### 3f. Credit Bureau (merchant, dual-mode)

Mode 1 (traditional FICO-style) + Mode 2 (on-chain operational), variance
detection when they diverge >50 points. Subscription + inquiry-revenue-share.

---

## 4. Supporting services (each owns its Postgres schema)

| Service | Port | Role |
|---|---|---|
| `bank-connectivity` | 3006 | Plaid (US ACH/balances) + Open Banking; treasury's rails |
| `compliance-monitor` | (PY) | OFAC/sanctions screening; Custody's fail-closed dependency |
| `billing-engine` | (KillBill) | single subscription/invoicing engine for all products, auto-proration |
| `stablecoin-gateway` | — | USDC/USDT on EVM chains; Circle leg of the fallback chain |
| `crypto-gateway` | — | BTC/ETH/LTC/XMR invoicing |
| `yield-engine` | — | auto-sweeps idle stablecoin into DeFi yield; treasury sweep destination |
| `rwa-registry` | 3008 | tokenized real-world assets (T-bills, money-market) |
| `institutional-reporting` | 3017 | CFO/auditor-ready reports (cash flow, yield, netting) |
| `liquidity-forecaster` | (PY) | cash-runway prediction feeding treasury rules |
| `chain-sync` | — | keeps on-chain ZK contract state synced to Postgres |
| `agent-identity` | 3010 | DID registration + reputation |
| `agent-credit-lines` | 3016 | net-30/60/90 credit terms for agents |
| `agent-decision-framework` | 3013 | risk / counterparty logic |
| `agent-liquidity-manager` | 3014 | agent portfolio sweeps |
| `agent-negotiation` | 3011 | offer/counter-offer protocol between agents |
| `bank-whitelabel` | 3015 | multi-tenant bank admin console (B2B2C distribution) |
| `accounts-service` | — | account records |
| `email-service` | — | Redis async email queue (10/5s, backoff, DLQ) |
| `mor-layer` | (PY) | Polar fork — merchant-of-record checkout + tax |

**Business rationale:** each supporting service removes a reason to need a
competitor. Breadth is the retention strategy — the more of the stack a
customer adopts, the higher the switching cost. `bank-whitelabel` turns banks
from competitors into a distribution channel.

---

## 5. Console (Next.js 14 platform app)

10 dashboards in the FORGE editorial design system (paper/ink, Inter Tight +
JetBrains Mono). Each dashboard uses `useForge(section)` → polls a
**server-side proxy** (`/api/forge/[section]`) that calls the services, so
service URLs and `CONSOLE_SECRET` never reach the browser (no CORS surface).
Every read returns `{live, data}` with a **LIVE/DEMO pill**. Read APIs:
`GET /api/v1/console/summary` on custody + wallet; `/v1/cash-position` +
`/v1/rules` on treasury; `/v1/bureau/stats` + `/v1/agents` on the bureau.

Dashboards: Unified Overview, Payments, Custody, Wallet, Agent Credit Bureau,
Enterprise Treasury, merchant Credit Bureau, Ops, Analytics, Admin/CSM.

---

## 6. Infrastructure

- **Postgres** — schema-per-service on multi-AZ RDS (30-day backups). Ontology
  (`forgepay_events`) is the cross-service read surface.
- **Redis** — dedup cache + async email queue.
- **Vault** — key material; Custody stores only `vault_path` references.
- **immudb** — cryptographic audit ledger (vendored OpenFireblocks).
- **EKS** — multi-AZ, HPA 3–10 replicas; **Helm** per service (secrets via
  Secret refs); **GitHub Actions** CI (type-check + test each service);
  **Prometheus/Grafana** metrics.
- **docker-compose** dev stack — `forge` profile boots forge-custody +
  forge-wallet + the real Go MPC signer + immudb.

---

## 7. Vendored upstreams

| Vendored path | Source | Pinned SHA | Provides |
|---|---|---|---|
| `services/openfireblocks` | KHAYAAI/openfireblocks | `c35fe40` | mpc-signer (Go), api-gateway (NestJS), policy-service (OPA), temporal-worker, SDKs, contracts |
| `services/open-privy` | KHAYAAI/open-privy | `a63eebe` | NestJS backend, web app, paymaster contracts, AWS/K8s/monitoring guides |

SHAs pinned in `forgepay/config/base/pinned-upstreams.yaml`. FORGE Custody /
Wallet are the FORGE-facing API surfaces; the vendored trees provide the
signing/crypto internals that plug in behind clean adapter boundaries.

**Honest status:** OpenFireblocks Phase 1 signs with a single shared key
(distributed 4-of-7 is Phase 2, unaudited for customer funds); OpenPrivy is a
Phase 0 MVP. See `SECURITY_AUDIT_2026-07.md` for the launch gate.

---

## 8. Event flows (the interconnection, precisely)

**Consumer/agent payment (< $100K):**
```
Wallet.sign → wallet.transaction.confirmed → unified-router
  → forgepay_events → [Agent Credit Bureau updates score]
                    → [Enterprise Treasury updates cash position]
                    → [merchant webhook fan-out]
```

**Institutional / agent-credit draw (> $1M):**
```
Payments router → forge-custody
  → policy engine → compliance-monitor (sanctions, fail-closed)
  → approval gate (CFO+CEO) → MPC signer (Go) → broadcast
  → custody.signature.confirmed → unified-router → forgepay_events
  → [Bureau: on-time repayment lifts agent score, grows line]
  → [Treasury: records draw + schedules auto-sweep repayment]
```

**Agent-credit closed loop:**
```
Agent (Wallet) → needs > line
  → Agent Credit Bureau (score check) → extension request
  → Enterprise Treasury (CFO approve) → line raised, Custody authorized
  → Custody signs draw from enterprise account → ontology records
  → Bureau lifts score → larger line next time
```

---

## 9. Why it makes business sense (one paragraph)

FORGE sells commodities (payments, wallets, custody) at competitive margins to
acquire accounts, then expands them into the high-margin, defensible products
(agent credit, treasury) that *only work because* the commodities feed the
shared ontology. The router encodes the cross-sell as code; the ontology
encodes the data moat as infrastructure; the console encodes "single pane of
glass" as a demo that sells itself; white-label turns competitor banks into a
distribution channel. The one discipline that protects all of it: **Custody
stays pilot/testnet until its MPC audit clears** — a single custody incident
would vaporize the trust the entire cross-sell depends on.
