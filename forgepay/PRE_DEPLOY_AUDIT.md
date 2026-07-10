# ForgePay Pre-Deployment Audit Report

**Audit Date**: 2026-06-25 (original), updated 2026-07-10  
**Auditor**: Automated codebase scan (Claude Code)  
**Scope**: 26 services under `forgepay/services/`, infra under `forgepay/infra/`

---

## Update — 2026-07-10

A full bug-fix sweep ran across every service since the original audit below
was written. Two kinds of things changed:

1. **Real bugs fixed this session, verified with tsc/build/vitest/pytest/mvn
   test runs** (not just read — actually compiled and exercised):
   - **Every service now has `unhandledRejection`/`uncaughtException`
     handlers** (section 7 below is stale — was 0/16, now 16/16).
   - **`institutional-reporting` now has a SIGTERM/SIGINT handler**
     (section 6 is stale — was the one gap, now closed).
   - **`accounts-service` and `unified-router` had a real `runMigrations()`
     function that was never called from anywhere** — a fresh Postgres
     database would be missing every table these services read/write.
     Wired into startup. (`agent-identity` and `agent-negotiation`, also
     listed as gaps in section 2 below, turned out to call migrations
     indirectly via `initStore()` — false alarms, not fixed because not
     broken. `agent-decision-framework`, `bank-connectivity`,
     `bank-whitelabel`, `institutional-reporting` don't use Postgres at all
     — no migrations needed. `bank-connectivity` uses Prisma, whose
     migrations are a `prisma migrate deploy` step, not in-process.)
   - `agent-liquidity-manager`, `agent-negotiation`, `rwa-registry`: stub
     execution logic replaced with real, tested ledger/accounting code
     (rebalance/sweep/liquidate execution, escrow ledger, redemption/income
     settlement).
   - `unified-router`: webhook HMAC signature verification was silently
     broken (no raw-body capture, so verification always failed) — fixed,
     plus a broken Kill Bill normalizer and ~64 tsc errors.
   - `compliance-monitor`: OFAC sanctions-screening name normalization and
     CSV parsing were both wrong (87/87 tests now pass, was 78/87).
   - Stablecoin-gateway's shielded-payments route (fake Groth16 proof
     verifier) is now feature-flagged off by default with a startup guard.
   - A systemic cross-directory import bug (`../../lib/db.js` unreachable at
     real Docker build time) fixed across 7 services.
   - `billing-engine`'s Kill Bill plugin (Java/Maven) could not compile —
     missing Micrometer and Servlet API dependencies. Now compiles, packages,
     and passes 21/21 JUnit tests. Its Shiro config defined a credentials
     matcher that was never wired to a realm (silent fallback to plain-text
     comparison) — fixed.
   - Roughly a dozen more bugs across accounts-service, agent-credit-lines,
     agent-identity, bank-connectivity, chain-sync, enterprise-treasury,
     yield-engine: missing `await`s on async store functions (some breaking
     `try/catch` error handling), missing dependencies, wrong import paths,
     `ethers` v6 typing, `jose` v6 API changes, and more. Full detail is in
     the git log for this session's commits.
   - Every touched service was verified with `tsc --noEmit`, `npm run
     build`, and the full test suite (or `pytest`/`mvn test` for
     Python/Java). Postgres-integration tests that require a live database
     unavailable in the sandbox are left failing with `ECONNREFUSED` — a
     documented, accepted limitation, not a bug.

2. **Several claims in the original audit below (sections 2, 4, 10, 11, 16)
   turned out to be stale**, not because they were fixed this session, but
   because infra/DevOps work in an *earlier* session updated Helm charts,
   resource limits, and metrics routes without this document being
   refreshed to match. Spot-checked and corrected inline below. **This
   session did not do a fresh infra audit** — resource limits, Pod
   Disruption Budgets, NetworkPolicies, and runbook coverage were only
   spot-checked, not exhaustively re-verified the way the application code
   was. Treat the infra-related sections as a starting point for a proper
   follow-up audit, not a final answer.

**What's still genuinely open** (confirmed, not stale): NetworkPolicies
(none exist anywhere), Pod Disruption Budgets (none exist), 8 of 12 planned
on-call runbooks, load-testing baseline is still placeholder data, and Helm
resource limits — while higher than this doc previously stated — are still
below the checklist's spec numbers for at least the services spot-checked.

---

## Executive Summary Table

*Original 2026-06-25 columns kept for history; **Current** reflects the 2026-07-10 update above.*

| Category | Original Status | Current Status |
|---|---|---|
| Environment Config (.env.example) | ⚠️ PARTIAL (17/21) | ✅ READY — all services now have one |
| Database Migrations Wired | ⚠️ PARTIAL (7/16) | ✅ READY — 2 real gaps fixed, rest were false alarms or N/A |
| Rate Limiting | ✅ READY | ✅ READY (unchanged) |
| Prometheus /metrics Endpoint | ⚠️ PARTIAL | ✅ READY — all 16 TS services register the route |
| TLS cert-manager | ✅ READY | ✅ READY (unchanged) |
| Graceful Shutdown (SIGTERM) | ⚠️ PARTIAL | ✅ READY — institutional-reporting gap closed |
| Unhandled Rejection Handlers | ❌ MISSING (0/16) | ✅ READY — 16/16 |
| HMAC Webhook Verification | ✅ READY (claimed) | ✅ READY — unified-router's was actually silently broken (no raw-body capture) and is now genuinely fixed and tested |
| Load Testing Suite | ✅ READY | ⚠️ PARTIAL — baseline still placeholder, unchanged |
| Helm Resource Limits | ⚠️ PARTIAL | ⚠️ PARTIAL — improved from stale numbers, still below spec |
| Helm Replica Counts | ⚠️ PARTIAL (agent-identity at 1) | ⚠️ PARTIAL — agent-identity now 2, fleet still at 2 not 3 |
| Pod Disruption Budgets | ❌ MISSING | ❌ MISSING — not re-verified, assume still true |
| Network Policies | ❌ MISSING | ❌ MISSING — confirmed still true |
| On-Call Runbooks | ⚠️ PARTIAL (4 docs) | ⚠️ PARTIAL — still 4 docs, confirmed unchanged |
| Secrets Management (Vault) | ✅ READY | ✅ READY (unchanged) |
| Observability (Prometheus+Grafana) | ✅ READY | ✅ READY — plus compliance-monitor/liquidity-forecaster Helm charts now complete |

See "Update — 2026-07-10" above for what was verified vs. spot-checked vs.
carried over unchanged.

---

## Detailed Findings Per Category

### 1. Environment Configuration (.env.example)

**Status: ✅ READY (as of 2026-07-10 — was PARTIAL)**

The three services this doc previously listed as missing `.env.example`
(agent-liquidity-manager, bank-whitelabel, chain-sync) all have one now.

---

### 2. Database Migrations

**Status: ✅ READY (as of 2026-07-10 — was PARTIAL)**

This table was wrong even at the time it was written — it only grepped for
`runMigrations()` inside `index.ts`, missing indirect calls made from
`store.ts`/`initStore()`. Corrected, verified by actually reading each
service's startup path:

| Service | Migrations run at startup? |
|---|---|
| agent-credit-lines, chain-sync, enterprise-treasury, rwa-registry, stablecoin-gateway, crypto-gateway, yield-engine, agent-liquidity-manager | ✅ YES — direct `runMigrations()` call in `index.ts` |
| agent-identity, agent-negotiation | ✅ YES — indirect, via `initStore()` in `store.ts` (the original doc's grep missed this) |
| accounts-service, unified-router | ✅ YES — **fixed 2026-07-10**: both had a real `runMigrations(db)` in `src/db/migrate.ts` that was never called anywhere. A fresh Postgres database would have been missing every table these two services read/write. Now wired into startup before the app accepts traffic. |
| agent-decision-framework, bank-connectivity, bank-whitelabel, institutional-reporting | N/A — no Postgres usage in these services at all (bank-connectivity uses Prisma, whose migrations are a separate `prisma migrate deploy` deploy step, not in-process) |

The Python services (mor-layer, compliance-monitor, liquidity-forecaster) use SQLAlchemy/Alembic — separate migration tooling, verify Alembic migration status is current before go-live.

---

### 3. Rate Limiting

**Status: ✅ READY**

- **TypeScript/Fastify services**: 15/16 TS services use `@fastify/rate-limit`. The only exception is `chain-sync`, which is a background sync service (no public HTTP API) — acceptable.
- **Python/FastAPI services** (mor-layer, compliance-monitor, liquidity-forecaster): All use `slowapi` with per-endpoint limits configured.
- `chain-sync` has no rate limiting but also has no public endpoint — not a blocker.

---

### 4. Prometheus /metrics Endpoint

**Status: ✅ READY (as of 2026-07-10 — was PARTIAL)**

All 16 TypeScript services now register a `/metrics` HTTP route in
`src/index.ts` (verified by grep across all of them, not just read) — this
doc's claim that only `unified-router` did so is stale. The Python services
expose `/metrics` via FastAPI + `prometheus_client` middleware.

Prometheus scrape config coverage (explicit job list vs. autodiscovery) was
not re-verified this pass — worth confirming the static job list matches
the current 26-service fleet before go-live.

---

### 5. TLS cert-manager

**Status: ✅ READY**

`forgepay/infra/helm/certificate-issuer.yaml` exists and is fully configured:
- `letsencrypt-prod` ClusterIssuer pointing to ACME v2 production endpoint
- `letsencrypt-staging` ClusterIssuer for testing
- HTTP01 solver using NGINX ingress class
- Email: `certificates@forgepay.com`

TLS annotations (`cert-manager.io/cluster-issuer: "letsencrypt-prod"`) are present in at least `compliance-monitor` and other ingress-enabled charts. Cert renewal automation is handled by cert-manager itself.

**Note**: OCSP stapling is not explicitly configured in Helm ingress annotations — this is a nice-to-have.

---

### 6. Graceful Shutdown (SIGTERM)

**Status: ✅ READY (as of 2026-07-10 — was PARTIAL)**

`institutional-reporting` — the one gap this doc identified — now has a
SIGTERM/SIGINT handler. All 16 TypeScript services handle graceful
shutdown; Python services rely on uvicorn's process-level SIGTERM handling
(acceptable).

---

### 7. Unhandled Rejection / Uncaught Exception Handlers

**Status: ✅ READY (as of 2026-07-10 — was MISSING)**

All 16 TypeScript services now register `process.on('unhandledRejection',
...)` and `process.on('uncaughtException', ...)` handlers that log with
full context and exit (letting the orchestrator restart the pod, rather
than continuing in a possibly-corrupted state).

One thing to know if adding more test files that import a service's
`buildApp` directly (as `agent-identity`, `agent-negotiation`, and
`rwa-registry`'s test suites do): each service's `index.ts` guards its
`main()` auto-start with `if (require.main === module)` so merely
importing the module for tests doesn't start a second real listener on the
same port. `agent-identity` hit exactly this bug this session — two test
files both imported `buildApp`, and before the guard was added, each
import called `main()` a second time, colliding on the port and crashing
the whole test run.

---

### 8. HMAC Webhook Verification

**Status: ✅ READY**

`forgepay/services/unified-router/src/lib/crypto.ts` is fully implemented:
- Uses `node:crypto` `createHmac('sha256', secret)` 
- Uses `timingSafeEqual` to prevent timing-based side-channel attacks (with a detailed comment explaining the requirement)
- Supports both bare hex and `sha256=<hex>` header formats
- Returns `false` rather than throwing on invalid input
- Has a dedicated test file: `src/__tests__/crypto.test.ts`

mor-layer HMAC verification is also present in `src/main.py` for webhook signature checking.

bank-whitelabel and bank-connectivity also have webhook route handlers with HMAC checking. compliance-monitor has webhook routes with auth verification.

**Gap**: Timestamp validation (webhook accepted only if < 5 minutes old) and replay attack prevention (nonce tracking) were not verified in scope — these should be audited in the webhook route handlers directly.

---

### 9. Load Testing Suite

**Status: ✅ READY (baseline is placeholder)**

Load testing suite exists at `forgepay/infra/load-tests/`:
- `run-load-tests.sh` — orchestration script
- `capture-baseline.sh` — baseline capture
- `compare-baseline.sh` — regression detection
- `baseline.json` — **contains placeholder data** (note: `"SLO targets — replace with actual measurements from staging soak test"`, captured_at 2026-05-15)
- Individual k6 test scripts for: checkout, checkout-spike, checkout-stress, stablecoin, crypto, agent-identity, agent-negotiation, rwa-registry, staging-soak

**Note**: The checklist references `forgepay/load-testing/` (no such directory) — the actual location is `forgepay/infra/load-tests/`. The `baseline.json` contains placeholder SLO targets, not real measured baselines from staging.

**Action**: Run staging soak test and capture real baseline before go-live. Update the baseline path reference in GO_LIVE_CHECKLIST.md.

---

### 10. Helm Resource Limits vs. Checklist Specification

**Status: ⚠️ PARTIAL (numbers below corrected 2026-07-10 — the original figures were stale, from before an earlier session's infra pass)**

The checklist specifies production resource allocations. Current Helm values are still under-provisioned relative to spec, though less severely than this doc previously stated:

| Service | Spec CPU Req / Limit | Actual CPU Req / Limit | Spec RAM Req / Limit | Actual RAM Req / Limit |
|---|---|---|---|---|
| unified-router | 500m / 2000m | 300m / 500m | 512Mi / 2Gi | 512Mi / 1Gi |
| mor-layer | 1000m / 4000m | 300m / 500m | 1Gi / 4Gi | 512Mi / 1Gi |
| crypto-gateway | 500m / 2000m | 300m / 500m | 512Mi / 2Gi | 512Mi / 1Gi |
| stablecoin-gateway | 500m / 2000m | 300m / 500m | 512Mi / 2Gi | 512Mi / 1Gi |
| yield-engine | 2000m / 4000m | 200m / 400m | 2Gi / 4Gi | 256Mi / 512Mi |
| agent-identity | 500m / 2000m | 200m / 400m | 512Mi / 2Gi | 256Mi / 512Mi |

Still a real gap (roughly 40-60% of spec rather than the previously-stated
20-25%), and still worth resolving before a real production load test —
but not the emergency the old numbers implied. Only the 6 services above
were spot-checked; a full pass across all 26 Helm charts wasn't done this
session.

---

### 11. Replica Counts

**Status: ⚠️ PARTIAL (corrected 2026-07-10)**

`agent-identity` is now at `replicaCount: 2`, not `1` as this doc
previously stated — no longer a single point of failure. The checklist's
target of 3 replicas for HA services is still unmet fleet-wide (spot-
checked services are at 2).

---

### 12. Pod Disruption Budgets (PDB)

**Status: ❌ MISSING**

No `PodDisruptionBudget` manifests exist in any individual Helm chart templates. The `forgepay-stack/values-mainnet.yaml` references `minAvailable: 2` in two places, suggesting PDB intent, but no actual PDB templates are rendered.

**Action**: Add PDB templates to each critical service Helm chart ensuring `minAvailable: 2` during cluster maintenance.

---

### 13. Network Policies

**Status: ❌ MISSING**

No `NetworkPolicy` Kubernetes manifests exist anywhere in `forgepay/infra/`. The checklist requires deny-all default + whitelist-based rules per service pair.

**Action**: Create NetworkPolicy manifests for each namespace. This is a **critical security gap** for production.

---

### 14. On-Call Runbooks

**Status: ⚠️ PARTIAL**

`forgepay/docs/runbooks/` contains:
- ✅ `INCIDENT_RESPONSE.md` — severity classification, escalation procedures
- ✅ `agent-services.md`
- ✅ `agentic-commerce.md`  
- ✅ `rwa-registry.md`

**Missing runbooks** per checklist:
- ❌ `unified-router.md`
- ❌ `mor-layer.md` (checkout failures)
- ❌ `crypto-gateway.md`
- ❌ `stablecoin-gateway.md`
- ❌ `yield-engine.md`
- ❌ `database.md` (Postgres)
- ❌ `redis.md`
- ❌ `kubernetes.md`

---

### 15. Secrets Management

**Status: ✅ READY**

Vault setup is comprehensive:
- `forgepay/infra/vault/setup.sh` — bootstraps KV v2, policies, K8s auth
- `forgepay/infra/vault/policy.hcl` — `forgepay-services` policy with per-service path scoping
- `forgepay/infra/vault/vault-agent-config.hcl` — sidecar token renewal
- `forgepay/infra/vault/k8s-external-secrets.yaml` — ExternalSecrets Operator CRDs
- Helm values reference `secretRef` to Kubernetes Secrets (not hardcoded values)
- No secrets found hardcoded in service source code

---

### 16. Observability (Prometheus + Grafana)

**Status: ✅ READY**

- Prometheus config: `forgepay/infra/observability/prometheus/prometheus.yml` with 15s scrape interval, AlertManager integration
- Alert rules: `forgepay/infra/observability/prometheus/rules/forgepay-alerts.yml` with payment success rate, p99 latency alerts
- Grafana dashboards: `payments-overview.json`, `platform-health.json` provisioned
- SLO rules: `forgepay/infra/observability/alerts/slo-rules.yaml`
- OTel Collector: `forgepay/infra/observability/otel-collector/config.yaml`
- ServiceMonitors exist for: agent-credit-lines, agent-identity, bank-connectivity, billing-engine, crypto-gateway, enterprise-treasury, mor-layer, stablecoin-gateway, unified-router, yield-engine

**Corrected 2026-07-10**: both compliance-monitor and liquidity-forecaster
now have complete Helm charts (`Chart.yaml`, `deployment.yaml`,
`service.yaml`, `serviceMonitor.yaml`, `values.yaml`) — the gap this doc
described no longer exists.

---

## Critical Blockers (Must Fix Before Production) — updated 2026-07-10

Of the original 8 blockers, 4 are now resolved (application-code fixes,
verified this session) and 1 is resolved by earlier infra work this doc
hadn't caught up to. What's genuinely still open:

1. **❌ No NetworkPolicy Manifests** — All pods can communicate with all
   other pods. Violates PCI/security requirements. Confirmed still true.
   Create deny-all + whitelist NetworkPolicies.

2. **⚠️ Helm Resource Limits Below Spec** — Improved from what this doc
   previously stated (see section 10) but still under the checklist's
   numbers on the services spot-checked. Not confirmed across the full
   fleet.

3. **⚠️ Load Testing Baseline is Placeholder** — `baseline.json` still
   contains placeholder data as of this update. Run an actual staging soak
   test before go-live to establish real P99 baselines.

**Resolved, no longer blockers:**
- ~~/metrics route not wired~~ — all 16 TS services register it (§4).
- ~~compliance-monitor / liquidity-forecaster Helm charts incomplete or
  missing~~ — both now complete (§16).
- ~~Database migrations not wired~~ — accounts-service and unified-router
  fixed this session; everything else in the original list was either a
  false alarm (indirect migration calls the original grep missed) or
  doesn't use Postgres (§2).
- ~~agent-identity replicaCount: 1~~ — now 2 (§11).

**Not independently re-verified this session** (carried over from the
original audit, spot-checked in some cases but not exhaustively): Pod
Disruption Budgets (still appear to be missing), on-call runbook coverage,
OCSP stapling, mTLS between services, webhook timestamp/replay validation.
Treat these as open until a dedicated infra audit confirms otherwise.

---

## Nice-to-Haves (Can Fix Post-Launch)

1. ~~unhandledRejection handlers missing~~ — **done**, all 16 TS services (§7).
2. ~~SIGTERM missing in institutional-reporting~~ — **done** (§6).
3. ~~Missing .env.example for 3 services~~ — **done** (§1).
4. **Pod Disruption Budgets missing** — add PDB templates with `minAvailable: 2` to each Helm chart. Not re-verified this session but no evidence it's been added.
5. **OCSP stapling not configured** — add `nginx.ingress.kubernetes.io/enable-ocsp-stapling: "true"` to ingress annotations.
6. **On-call runbooks for 8 services** — unified-router, mor-layer, crypto-gateway, stablecoin-gateway, yield-engine, database, redis, kubernetes runbooks are still missing (confirmed 2026-07-10 — still only 4 files in `forgepay/docs/runbooks/`).
7. **Replica counts at 2, not 3** — bump critical services to `minReplicas: 3` in HPA config.
8. **Prometheus scrape config coverage** — re-verify the explicit job list matches the current 26-service fleet.
9. **Webhook timestamp/replay validation not verified** — review route handlers for < 5 minute timestamp validation and nonce tracking.
10. **mTLS between services not configured** — consider Istio/Linkerd service mesh for mTLS.

---

## Overall Readiness Score

**Application code / service-level readiness: substantially improved and
verified this session** — every service that has one was built, type-
checked, and test-run (or `pytest`/`mvn test` for Python/Java); real bugs
were found and fixed across roughly 20 of the 26 services, including
several that would have caused hard failures in production (broken
webhook signature verification, migrations that would never run against a
fresh database, an entire Kill Bill plugin that didn't compile).

**Infra/deployment readiness: not re-scored.** The prior 54/100 score
mixed application-code and infra concerns, and several of its infra
inputs turned out to be stale. Rather than publish a new single number
built on a mix of this session's verified work and un-reverified carry-
over claims, the honest summary is:

- **Code-level blockers**: resolved, to the depth verified above.
- **Infra-level blockers still open**: NetworkPolicies (confirmed
  missing), Pod Disruption Budgets (likely still missing, not
  reconfirmed), load-testing baseline (confirmed still placeholder),
  Helm resource limits (confirmed still below spec, though better than
  previously documented).

**Go-live recommendation**: The application code is meaningfully closer
to production-ready than the 2026-06-25 audit reflected. Before declaring
launch-ready, run a dedicated infra audit (NetworkPolicies, PDBs, real
Helm resource limits across the full 26-service fleet, a real staging
soak test for the load-testing baseline) — that work was out of scope for
this session's code-focused sweep.
