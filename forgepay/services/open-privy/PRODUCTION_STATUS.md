# OpenPrivy — Production Status (source of truth)

**Last updated:** 2026-08-19

This document supersedes the earlier self-certified files
(`PRODUCTION_READY_SUMMARY.md`, `AUDIT_REPORT_SIMULATION.md`,
`PRODUCTION_LAUNCH_CHECKLIST.md`, `README_PRODUCTION.md`). Those were written by
the same pass that generated the code and asserted "audited / production-ready"
with no independent verification. Where they conflict with this file, this file
is correct. Treat them as aspirational drafts, not status.

Everything below was verified by actually running it (Node 20/22, a real
PostgreSQL 16, and Redis). Claims are labelled ✅ verified, 🟡 partial, or
❌ not done.

## Backend application

| Area | Status | Evidence |
|---|---|---|
| Compiles | ✅ | `npm run build` clean (was 435 TS errors before) |
| Lint | ✅ | `npm run lint` 0 errors |
| Unit/correctness/security tests | ✅ | 35 passing, 1 skipped (on-chain integration) |
| Boots in production mode | ✅ | `NODE_ENV=production` against RDS-shaped Postgres |
| Custodial wallet create → encrypt at rest | ✅ | HTTP e2e; key stored `iv:tag:ciphertext`, not plaintext |
| Custodial send (decrypt→sign→broadcast) | ✅ (code) / 🟡 (chain) | crypto round-trip tested; live send needs funded key |
| Auth guard | ✅ | unauthenticated → 401 |
| WorkOS AuthKit SSO (header + cookie) | ✅ | `/auth/workos/authorize` returns valid AuthKit URL; `/auth/me` via Bearer AND `op_session` cookie; tampered cookie → 401 |
| JWT secret fail-closed | ✅ | no dev fallback in production |
| Rate limiting (Redis, global, env-tunable) | ✅ | 429 after limit; `rl:*` keys in Redis; limits configurable via env |
| DB schema via migrations (no synchronize in prod) | ✅ | 2 migrations apply on a fresh DB (initial + workosUserId) |
| Backup / restore (DR round-trip) | ✅ | `db-backup.sh`→`db-restore.sh` verified: row counts match, ciphertext intact |
| Load baseline (single instance) | ✅ | ~3.3k req/s `/health`, ~1.1k req/s `/auth/me` (JWT+DB); see test/load/RESULTS.md |
| Encryption master key from Secrets Manager | 🟡 | code path wired (IRSA + ARN); needs a real AWS account to exercise |
| ERC-4337 / account abstraction end-to-end | ❌ | v0.7-spec hash + on-chain comparison test written (`test/integration/userop-hash.integration.test.ts`); UNRUN here — egress policy blocks external RPC. `SimpleAccount.sol` nonce model still needs reconciling |
| Supabase-backed auth end-to-end | ⚪ | superseded by WorkOS; Supabase now lazy/optional |

## Infrastructure (AWS)

| Area | Status | Evidence |
|---|---|---|
| CloudFormation VPC + EKS | ✅ | `cfn-lint` clean (fixed circular SG, EKS logging, Nodegroup type) |
| CloudFormation RDS + Redis + Secrets + S3 | ✅ | `cfn-lint` clean (fixed invalid RDS props, Redis log config, S3 encryption, generated DB password) |
| k8s manifests (deploy, HPA, SA/IRSA, ingress, migrate job) | ✅ | all parse; security context + probes + anti-affinity present |
| Dockerfile | 🟡 | rewritten multi-stage, non-root, tini, healthcheck — **not** build-verified here (no Docker daemon in this env) |
| CI (`ci.yml`) and CD (`deploy-aws.yml`) | 🟡 | corrected to install/build/lint/test + run migrations before rollout; not executed here (needs AWS/GitHub) |

## The hard gates before real traffic

1. **External security audit** — custody, AA, auth. Independent third party. ❌ (external)
2. **Live testnet ERC-4337 transaction** that lands (no `SIG_VALIDATION_FAILED`).
   Comparison test written; run it where RPC is allowed, then reconcile
   `SimpleAccount.sol` to EntryPoint v0.7. ⚠️ blocked here by egress policy.
3. **Load test** on staging to size RDS/Redis/HPA. 🟡 local baseline captured
   (test/load/RESULTS.md); staging run + write-path (wallet create) still needed.
4. **Master-key rotation** tooling + dry-run. ❌ (primitive exists; batch tool + drill needed)
5. **DR drill** — RDS PITR + Multi-AZ failover + confirm decrypt. 🟡 logical
   backup/restore round-trip verified + runbook (`docs/DR_RUNBOOK.md`); the RDS
   PITR + failover legs need a real AWS account.
6. **Money-transmitter / VASP licensing** for the custodial model — legal, above
   SOC 2 / PCI. ❌ (counsel)

Deploy procedure: `docs/AWS_PRODUCTION_DEPLOY.md` · DR: `docs/DR_RUNBOOK.md`.

## WorkOS (auth) state

Project **OPEN PRIVY** (`project_01M0E4NNMZ0TBVBT2YVCXY4G14`):
- Staging org `org_01M0E4TBZMQ66B6KCPQWHX1ZFD` (client `client_01M0E4NP2BATG2MTE1707JV23Y`)
- Production org `org_01M0E4T889CBRY9XAN8ARNPAD2` (client `client_01M0E4NPFKM2J49B5HQAABH0CJ`)

Set `WORKOS_API_KEY` (sk_…) + the client id to go live; one browser login
exercises the code exchange (the only untested leg).

## Honest one-line summary

The backend is a **real, running, custodial embedded-wallet API** with
**WorkOS SSO**, production-shaped AWS infrastructure that lints/validates clean, a
measured load baseline, and a verified backup/restore path. It is **not yet
launch-certified**: an external audit, the live account-abstraction proof, a
staging load test, master-key rotation tooling, and the AWS DR legs remain. This
is "deployable to staging for hardening", not "flip it live to the public".
