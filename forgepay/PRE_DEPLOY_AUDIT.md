# ForgePay Pre-Deployment Audit Report

**Audit Date**: 2026-06-25  
**Auditor**: Automated codebase scan (Claude Code)  
**Scope**: 21 services under `forgepay/services/`, infra under `forgepay/infra/`

---

## Executive Summary Table

| Category | Status | Score |
|---|---|---|
| Environment Config (.env.example) | ⚠️ PARTIAL | 17/21 services |
| Database Migrations Wired | ⚠️ PARTIAL | 7/16 TS services |
| Rate Limiting | ✅ READY | All services with HTTP APIs |
| Prometheus /metrics Endpoint | ⚠️ PARTIAL | All have metrics lib; 14/16 TS missing route in index.ts |
| TLS cert-manager | ✅ READY | certificate-issuer.yaml exists |
| Graceful Shutdown (SIGTERM) | ⚠️ PARTIAL | 15/16 TS services; Python services use lifespan/uvicorn |
| Unhandled Rejection Handlers | ❌ MISSING | 0/16 TS services |
| HMAC Webhook Verification | ✅ READY | unified-router fully implemented |
| Load Testing Suite | ✅ READY | Suite exists; baseline.json is placeholder data |
| Helm Resource Limits | ⚠️ PARTIAL | Below checklist spec on all services |
| Helm Replica Counts | ⚠️ PARTIAL | All at 2 replicas; agent-identity at 1 |
| Pod Disruption Budgets | ❌ MISSING | Not present in individual charts |
| Network Policies | ❌ MISSING | No NetworkPolicy manifests found |
| On-Call Runbooks | ⚠️ PARTIAL | 4 docs exist; missing 5 service-specific runbooks |
| Secrets Management (Vault) | ✅ READY | Vault setup, ExternalSecrets, policies in place |
| Observability (Prometheus+Grafana) | ✅ READY | Full stack configured with alert rules |

**Overall Readiness Score: 54/100**

---

## Detailed Findings Per Category

### 1. Environment Configuration (.env.example)

**Status: ⚠️ PARTIAL**

17 of 21 services have `.env.example`. Three are missing:

| Service | Status |
|---|---|
| agent-liquidity-manager | ❌ MISSING `.env.example` |
| bank-whitelabel | ❌ MISSING `.env.example` |
| chain-sync | ❌ MISSING `.env.example` |

All other 17 services (accounts-service, agent-credit-lines, agent-decision-framework, agent-identity, agent-negotiation, bank-connectivity, billing-engine, compliance-monitor, crypto-gateway, enterprise-treasury, institutional-reporting, liquidity-forecaster, mor-layer, rwa-registry, stablecoin-gateway, unified-router, yield-engine) have `.env.example` present.

**Action**: Add `.env.example` to the three missing services.

---

### 2. Database Migrations

**Status: ⚠️ PARTIAL**

Only 7 of 16 TypeScript services call `runMigrations()` or equivalent in their `src/index.ts`. The Python services (mor-layer, compliance-monitor, liquidity-forecaster) use SQLAlchemy with separate migration tooling (Alembic), which is acceptable but must be verified.

| Service | `runMigrations()` in index.ts |
|---|---|
| agent-credit-lines | ✅ YES |
| chain-sync | ✅ YES |
| enterprise-treasury | ✅ YES |
| rwa-registry | ✅ YES |
| stablecoin-gateway | ✅ YES |
| crypto-gateway | ✅ YES |
| yield-engine | ✅ YES |
| accounts-service | ❌ NO |
| agent-decision-framework | ❌ NO |
| agent-identity | ❌ NO |
| agent-liquidity-manager | ❌ NO |
| agent-negotiation | ❌ NO |
| bank-connectivity | ❌ NO |
| bank-whitelabel | ❌ NO |
| institutional-reporting | ❌ NO |
| unified-router | ❌ NO |

**Note**: Services missing `runMigrations()` may rely on pre-deployment migration jobs or manual steps — this must be confirmed and documented before go-live. Unverified migration state is a **critical blocker** if those services use a database.

---

### 3. Rate Limiting

**Status: ✅ READY**

- **TypeScript/Fastify services**: 15/16 TS services use `@fastify/rate-limit`. The only exception is `chain-sync`, which is a background sync service (no public HTTP API) — acceptable.
- **Python/FastAPI services** (mor-layer, compliance-monitor, liquidity-forecaster): All use `slowapi` with per-endpoint limits configured.
- `chain-sync` has no rate limiting but also has no public endpoint — not a blocker.

---

### 4. Prometheus /metrics Endpoint

**Status: ⚠️ PARTIAL**

All 16 TypeScript services have a `src/lib/metrics.ts` with `prom-client` instrumentation. The Python services have `src/observability/metrics.py` with `prometheus_client`.

**However**: Only `unified-router` registers `/metrics` as an actual HTTP route in `src/index.ts`. The remaining 15 TypeScript services define the metrics class but do not expose it as a scrape endpoint in the main server setup. The metrics port 9090 is configured in Prometheus scrape config and Helm values — the route must be wired in each service's index.

The Python services (mor-layer, compliance-monitor, liquidity-forecaster) appear to expose `/metrics` via middleware configuration (FastAPI route detected in middleware skip logic), which is the correct pattern for FastAPI + prometheus_client.

**Prometheus static scrape config** (`prometheus.yml`) only explicitly lists: unified-router, mor-layer, stablecoin-gateway, crypto-gateway, payment-engine, billing-engine, postgres, redis — plus a kubernetes-pods autodiscovery job. Services like accounts-service, agent-identity, yield-engine etc. depend on pod annotation-based autodiscovery (`prometheus.io/scrape: "true"` annotation).

**Action**: Wire `/metrics` route into each TypeScript service's `src/index.ts` using their existing `metrics.ts` class.

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

**Status: ⚠️ PARTIAL**

| Service | SIGTERM Handler |
|---|---|
| accounts-service | ✅ (`for (const signal of ['SIGTERM', 'SIGINT'])`) |
| agent-credit-lines | ✅ (`process.once('SIGTERM', cleanup)`) |
| agent-decision-framework | ✅ |
| agent-identity | ✅ |
| agent-liquidity-manager | ✅ |
| agent-negotiation | ✅ |
| bank-connectivity | ✅ |
| bank-whitelabel | ✅ |
| chain-sync | ✅ |
| crypto-gateway | ✅ |
| enterprise-treasury | ✅ |
| rwa-registry | ✅ |
| stablecoin-gateway | ✅ |
| unified-router | ✅ (`process.on('SIGTERM', () => shutdown('SIGTERM'))`) |
| yield-engine | ✅ |
| institutional-reporting | ❌ MISSING — no SIGTERM handler found; `start()` function has no shutdown logic |
| mor-layer (Python) | ⚠️ Uses FastAPI `lifespan` context manager (uvicorn handles SIGTERM at process level — acceptable) |
| compliance-monitor (Python) | ⚠️ Same pattern (uvicorn SIGTERM handling) |
| liquidity-forecaster (Python) | ⚠️ Same pattern (uvicorn SIGTERM handling) |

**Action**: Add SIGTERM handler to `institutional-reporting/src/index.ts`.

---

### 7. Unhandled Rejection / Uncaught Exception Handlers

**Status: ❌ MISSING**

Zero of the 16 TypeScript services register `process.on('unhandledRejection', ...)` or `process.on('uncaughtException', ...)` handlers. Without these, unhandled promise rejections will crash the process in Node.js 18+ without logging context. Fastify catches most route-level rejections, but top-level async initialization errors (DB connect failures, config loading) will be uncaught.

**Action**: Add to each service's `src/index.ts`:
```typescript
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});
```

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

**Status: ⚠️ PARTIAL**

The checklist specifies production resource allocations. Current Helm values are significantly under-provisioned:

| Service | Spec CPU Req / Limit | Actual CPU Req / Limit | Spec RAM Req / Limit | Actual RAM Req / Limit |
|---|---|---|---|---|
| unified-router | 500m / 2000m | **100m / 500m** | 512Mi / 2Gi | **128Mi / 512Mi** |
| mor-layer | 1000m / 4000m | **200m / 1000m** | 1Gi / 4Gi | **512Mi / 1024Mi** |
| crypto-gateway | 500m / 2000m | **100m / 500m** | 512Mi / 2Gi | **256Mi / 512Mi** |
| stablecoin-gateway | 500m / 2000m | **100m / 500m** | 512Mi / 2Gi | **256Mi / 512Mi** |
| yield-engine | 2000m / 4000m | **200m / 1000m** | 2Gi / 4Gi | **256Mi / 1024Mi** |
| agent-identity | 500m / 2000m | **100m / 300m** | 512Mi / 2Gi | **128Mi / 256Mi** |

All services are provisioned at roughly 20-25% of the required resources. This is a **critical blocker for production** — under load, services will be OOMKilled or CPU-throttled.

---

### 11. Replica Counts

**Status: ⚠️ PARTIAL**

All critical services are set to `replicaCount: 2` (minimum HA). The checklist requires 3 for HA services. `agent-identity` is set to `replicaCount: 1` — this is a single point of failure.

| Service | Current Replicas | Required |
|---|---|---|
| agent-identity | **1** | 3 |
| all others | 2 | 3 |

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

**Gap**: compliance-monitor only has `values.yaml` (no Chart.yaml or templates) — Helm chart is incomplete and cannot be deployed. liquidity-forecaster has no Helm chart at all.

---

## Critical Blockers (Must Fix Before Production)

These issues **will cause production failures** if not resolved:

1. **❌ Helm Resource Limits Under-Provisioned** — All services at ~20% of required resources. Will cause OOMKill and CPU throttling under load. Update all `values.yaml` to match checklist specs.

2. **❌ /metrics Route Not Wired in 15 TypeScript Services** — Prometheus cannot scrape these services. Add HTTP GET `/metrics` route using the existing `metrics.ts` class in each service's `index.ts`.

3. **❌ compliance-monitor Helm Chart Incomplete** — Only `values.yaml` exists; no `Chart.yaml` or `templates/`. Cannot be deployed via Helm. Create the missing files.

4. **❌ No Helm Chart for liquidity-forecaster** — Service cannot be deployed to Kubernetes. Create Helm chart.

5. **❌ No NetworkPolicy Manifests** — All pods can communicate with all other pods. Violates PCI/security requirements. Create deny-all + whitelist NetworkPolicies.

6. **❌ Database Migrations Not Wired in 9 TypeScript Services** — accounts-service, agent-decision-framework, agent-identity, agent-negotiation, bank-connectivity, bank-whitelabel, institutional-reporting, unified-router, and agent-liquidity-manager do not call `runMigrations()`. Schema may be out of date on fresh deployments.

7. **❌ agent-identity replicaCount: 1** — Single point of failure for agent authentication. Set to minimum 3.

8. **⚠️ Load Testing Baseline is Placeholder** — `baseline.json` contains placeholder data. Run actual staging soak test before go-live to establish real P99 baselines.

---

## Nice-to-Haves (Can Fix Post-Launch)

These are improvements that do not block launch but should be addressed soon after:

1. **unhandledRejection handlers missing** — Add to all 16 TypeScript services for better crash logging. (Medium priority — Fastify catches most errors)

2. **SIGTERM missing in institutional-reporting** — Low blast radius as it's a reporting service, but should be added.

3. **Missing .env.example for 3 services** — agent-liquidity-manager, bank-whitelabel, chain-sync. Add before next developer onboarding.

4. **Pod Disruption Budgets missing** — Add PDB templates with `minAvailable: 2` to each Helm chart.

5. **OCSP stapling not configured** — Add `nginx.ingress.kubernetes.io/enable-ocsp-stapling: "true"` to ingress annotations.

6. **On-call runbooks for 8 services** — unified-router, mor-layer, crypto-gateway, stablecoin-gateway, yield-engine, database, redis, kubernetes runbooks are missing.

7. **Replica counts at 2, not 3** — Bump all critical services to `minReplicas: 3` in HPA config.

8. **Prometheus scrape only covers 4 services explicitly** — The kubernetes-pods autodiscovery should cover the rest, but explicit job definitions for each service are more reliable.

9. **Webhook timestamp/replay validation not verified** — Review route handlers for < 5 minute timestamp validation and nonce tracking.

10. **mTLS between services not configured** — Service-to-service traffic is not mutually authenticated. Consider Istio/Linkerd service mesh for mTLS.

---

## Overall Readiness Score: 54/100

**Scoring breakdown**:
- Environment config: 8/10 (3 missing .env.example)
- Migrations: 4/10 (9 services unverified)  
- Rate limiting: 10/10
- Metrics/observability: 5/10 (no route wiring in 15 services)
- TLS/cert-manager: 9/10 (missing OCSP stapling)
- Graceful shutdown: 7/10 (1 missing, Python acceptable)
- Error handlers: 0/10 (unhandledRejection missing everywhere)
- HMAC webhook: 9/10 (unified-router excellent; timestamp/replay not verified)
- Load testing: 5/10 (suite ready; baseline placeholder)
- Helm resources: 2/10 (all under-provisioned)
- Security (NetworkPolicy, PDB): 0/10 (both missing)
- Secrets management: 9/10
- Runbooks: 4/10 (4/12 present)
- Replica counts: 3/10 (agent-identity at 1; all at 2 not 3)

**Go-live recommendation**: NOT READY. Resolve the 8 critical blockers — particularly resource limits, NetworkPolicies, and the compliance-monitor/liquidity-forecaster Helm chart gaps — before proceeding to production.
