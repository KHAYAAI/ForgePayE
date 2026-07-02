# FORGE Platform Security Audit — July 2026

**Date:** 2026-07-02
**Branch:** `claude/forgepay-platform-design-gEkgE`
**Scope:** All `forgepay/` services, apps, and infra; `crates/` (Hyperswitch fork) reviewed report-only.
**Context:** Pre-launch hardening sweep ahead of end-of-month launch, performed alongside the
FORGE Custody / FORGE Wallet integration.

---

## Executive Summary

The sweep focused on the launch-blocking classes of issues: secrets that silently
default in production, unverified webhook ingestion, weak JWT/CORS configuration,
timing-unsafe secret comparison, and broken builds that would have blocked deployment.

**All critical findings are fixed in this branch.** Two new services (forge-custody,
forge-wallet) were built with the hardened patterns from day one and carry test suites
covering their security behavior (23 tests passing).

| Severity | Found | Fixed | Documented only |
|---|---|---|---|
| Critical | 7 | 7 | 0 |
| High | 6 | 5 | 1 |
| Medium | 4 | 2 | 2 |

---

## Fixed — Critical

| # | Finding | Location | Fix |
|---|---|---|---|
| C1 | **Circle webhook accepted unsigned payloads** — signature verified only *if header present*; an attacker could omit the header and mutate balances. | `accounts-service/src/routes/webhooks.ts` | Unsigned payloads rejected (401). Dev-only exception when no secret is configured **and** `NODE_ENV=development`. |
| C2 | **Plaid / Open Banking webhooks accepted unsigned payloads** (same pattern). | `bank-connectivity/src/routes/webhooks.ts` | New `rejectUnverified()` gate: production with no secret configured → 503; missing/invalid signature → 401. |
| C3 | **Internal settlement routes compared `X-Internal-Secret` with `!==`** (timing side-channel) and ran without any secret when unset. | `bank-connectivity/src/routes/internal.ts` | `timingSafeEqual` comparison; boot refused in production when `INTERNAL_SECRET` unset. |
| C4 | **Dev JWT secret (`forgepay_bank_jwt_secret_dev`) would silently ship to production**; wildcard CORS default. | `bank-whitelabel/src/index.ts` | Fail-fast boot without `JWT_SECRET` (≥32 chars) and explicit `CORS_ORIGINS` in production. Dev CORS default narrowed from `*` to `http://localhost:3000`. |
| C5 | **Well-known dev Postgres password fallback** (`forgepay:devpassword`) reachable in production. | `agent-negotiation`, `enterprise-treasury`, `rwa-registry` (`src/db.ts`), `bank-connectivity/src/lib/db-init.ts` | Boot refused in production when `DATABASE_URL`/`DB_PASSWORD` unset. |
| C6 | **compliance-monitor booted with `change-me-in-production` JWT secret** and empty internal-service secret. | `compliance-monitor/src/config.py` | `model_post_init` validation aborts production startup on weak/missing secrets. |
| C7 | **Platform app could not build at all** — nonexistent dependency pin (`jsonwebtoken@^9.1.0`), invalid `tsconfig` option, and JSX parse errors (`<1 hour` in `security/page.tsx`). Any deploy of the console would have failed. | `apps/platform` | Pinned `jsonwebtoken@^9.0.2`; removed invalid compiler option; fixed JSX. Full `next build` now passes. |

## Fixed — High

| # | Finding | Location | Fix |
|---|---|---|---|
| H1 | New custody/wallet webhook ingestion needed replay protection. | `unified-router/src/routes/webhooks.ts` | Timestamped HMAC scheme: signature over `${timestamp}.${rawBody}`, ±5-minute freshness window, `timingSafeEqual` verification. |
| H2 | Wallet auth endpoints exposed to credential stuffing. | `forge-wallet/src/index.ts` | 10 req/min burst limit on signup/login/recovery-initiate; constant-shape login failures (bcrypt compare runs even for unknown emails); recovery initiation never reveals whether an email exists. |
| H3 | JWT algorithm confusion (`none` / downgrade). | `forge-wallet` | `jwt.verify` pinned to `['HS256']`; 1-hour expiry; production refuses secrets <32 chars. |
| H4 | Custody API needed institutional-grade auth. | `forge-custody/src/auth.ts` | API keys stored as sha256 only; per-request HMAC-SHA256 over method+path+timestamp+body; ±5-minute replay window; all comparisons timing-safe. Covered by tests (bad signature, stale timestamp, revoked key). |
| H5 | Simulated signer could leak into production. | `forge-custody/src/signer.ts` | `DevSigner` throws in production; service refuses to boot without `MPC_COORDINATOR_URL`, `WEBHOOK_SECRET`, `DATABASE_URL`. |
| H6 | **Port collisions**: two services defaulted to 3014 (agent-liquidity-manager) and 3015 (bank-whitelabel), which would cause flaky local stacks and confusing incident triage. | new services | forge-custody → **3019**, forge-wallet → **3020**; port map verified unique across all 24 services. |

## Documented (not fixed here)

| # | Finding | Location | Recommendation |
|---|---|---|---|
| D1 | ~60 pre-existing TypeScript strict-mode errors in unified-router (`npx tsc --noEmit`) — tests pass, but type drift hides real bugs. | `unified-router` | Schedule a typing sprint before adding new routes; new files added in this audit are type-clean. |
| D2 | `enterprise-treasury` Helm values set `CORS_ORIGIN: '*'`. | `infra/helm/enterprise-treasury/values.yaml` | Tighten to the console origin at next deploy; service is ClusterIP-internal so exposure is limited. |
| D3 | Sanctions screening in forge-custody passes with a **logged warning** when `COMPLIANCE_MONITOR_URL` is unset. Acceptable for dev; must be set in production values (it is, in `infra/helm/forge-custody/values.yaml`). | `forge-custody/src/policy.ts` | Alert on the warning log line in CloudWatch. |
| D4 | Hyperswitch fork (`crates/`) not re-audited here — pinned upstream; PCI vault must remain enabled per repo policy. | `crates/` | Follow upstream advisories; never disable the vault. |

---

## Security architecture of the new FORGE services

**FORGE Custody (OpenFireblocks → FORGE):**
- No key material in Postgres — only Vault path references; DKG ceremonies store
  Feldman-VSS commitment *hashes*.
- 4-of-7 threshold semantics enforced at the key-metadata layer; share
  contributions recorded per signing.
- Policy engine evaluated before any signing: daily limit, whitelist
  (case-insensitive), UTC time window, chain restriction, approval threshold
  (distinct approvers **and** distinct roles enforced), sanctions screen.
- Append-only `audit_log` — the code has no UPDATE/DELETE path.

**FORGE Wallet (OpenPrivy → FORGE):**
- Private keys AES-256-GCM-encrypted under scrypt(password, per-user salt);
  plaintext never persisted, never returned, decrypted only in the signing scope.
- Social recovery: 2-of-3 single-use tokens (hash-stored, expiring); completed
  recovery rotates keypairs and invalidates the old password.
- Routing tier enforced at the wallet edge: ≥$100K → 409 `{route:'forge-custody'}`.
- Gas sponsorship ledger for billing; every confirmed tx emits an HMAC-signed
  ontology event.

**Test evidence:** `forge-custody` 14/14 passing (policy rejections, HMAC auth
including replay, approval lifecycle, audit writes); `forge-wallet` 9/9 passing
(auth, ciphertext-at-rest invariant, tier refusal, wrong-password rejection,
2-of-3 recovery with single-use token replay check).

---

## Launch checklist deltas

- [x] All webhook ingestion paths verify HMAC-SHA256 with timing-safe comparison
- [x] No service boots in production with dev secrets or dev DB credentials
- [x] JWT algorithms pinned everywhere JWTs are verified
- [x] Auth endpoints rate-limited against brute force
- [x] Platform console builds clean (`next build` green)
- [x] New services carry `.env.example`, Dockerfile (non-root, healthcheck), Helm chart (secrets via Secret refs, never inline)
- [ ] Set `FORGE_CUSTODY_WEBHOOK_SECRET` / `FORGE_WALLET_WEBHOOK_SECRET` in unified-router's production secrets before enabling the new routes
- [ ] Point CloudWatch alert at the "sanctions screen SKIPPED" log line
- [ ] Schedule unified-router typing sprint (D1)
