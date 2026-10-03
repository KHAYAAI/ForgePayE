# Platform readiness — 2 October 2026

> Superseded for per-platform detail by `READINESS_BY_PLATFORM_2026-10-03.md`, which adds a test run of every service and the custody work done since.


**Verdict: not ready for real customers' money. The bureau-first launch is the nearest, and it is gated by outside parties more than by code.**

Evidence levels used below: **Tested** (automated tests and, where noted, a run against real Postgres/nodes), **Built** (written and reviewed by its author, not exercised for real), **Unverified** (exists on paper or in a chart; never run), **Not assessed** (not examined in this work; earlier documents in `forgepay/` make claims I have not re-checked).

## 1. What was examined here, and where it stands

| Area | Status | Evidence | Main remaining gap |
|---|---|---|---|
| Stablecoin gateway: deposits, settlement, payouts, sweeper, treasury, leader lock, alerts, rate feed, asset probes | Tested | 170 unit tests; 111/111 end-to-end checks against ganache + Postgres | Never run on a real chain/RPC with real ZARP/OUSD; rate-feed providers never called; KMS never run against AWS |
| Bureau billing and furnisher payouts | Tested | 388 tests incl. the concurrency regression | Pricing/commercial terms and the legal status of "credit bureau" (see 3) |
| Gateway authorisation (payouts admin-only, fail-closed env, rate-limit key) | Tested | New tests, each fails without its fix | Independent review |
| Threshold custody: signer, nodes, resharing, backups, restore drill | Tested (real nodes, one host) | Full Go suite incl. disaster recovery and half-commit recovery | Never run across separate hosts/accounts, under load, or with real officers; no mutual TLS gateway-to-signer |
| Custody governance (OpenFireblocks gateway) | Tested | 111 jest tests | The "signer approves" vote is asserted by the console, not proven by the person (no WebAuthn/per-signer keys) |
| Console auth and the routes touched | Tested (new) | 6 vitest tests (the console had none) | Rest of the console untested; API keys stored in plaintext; throttling per process; no email verification |
| Helm, Terraform, CI | Built | `helm lint/template`, `terraform validate`, `actionlint` | Nothing applied to a cluster or an AWS account; no images built or published |
| Daily reconciliation, restore drill, load test, operations runbook | Tested (locally) / Built | Reconciliation ran against real Postgres + chain in the e2e and caught a real sweeper weakness (fixed). Load test: 107 deposits/s opened, 400 paid deposits confirmed in 44s on an instant local chain. DB restore drill passes on a dev database | Nothing run on staging or a real RPC; settlement scales with open deposits per pass; the runbook has never been rehearsed |
| Review package, RFP, counsel brief, dust-test runbook, launch values | Built | Documents | Nobody has been engaged; nothing sent |

## 2. What is not assessed

About twenty other services (unified-router, mor-layer, billing-engine, compliance-monitor, accounts-service, the agent-* services, yield-engine, rwa-registry, bank-connectivity, forge-wallet, open-privy, crypto-gateway, …), the marketing site, the Hyperswitch fork at the repository root, and the on-chain contracts. Test counts range from 0 (email-service) to 25, and CI gated only a handful of them before the new workflow. `PLATFORM_READINESS.md` (August) describes them; I have not verified it, and I would not carry its percentage forward. Any product that depends on these services needs its own assessment before it is promised to anyone.

## 3. What is missing, in order of what blocks launch

**A. Outside parties (nothing I can do from here)**
1. **Independent security review.** Package and RFP exist (`security-review/`, `launch/01`); a firm must be chosen and engaged. Scope A (gateway, treasury, signer wallet, bureau billing) gates the bureau; scope B (threshold signer, governance, DR) gates custody. Every fix in this round was made and tested by its author: the review is what actually checks them.
2. **Counsel's written view** (`launch/02`): whether receiving/paying stablecoins is regulated for you, whether furnisher balances look like custody, FIC/travel-rule/exchange-control duties, POPIA, the "credit bureau" name, tax. This can change the product shape, not just add paperwork.
3. **Licences/registrations** counsel says are required, and any bank/exchange/provider contracts the platform assumes.
4. **Issuer confirmation** of the ZARP and OUSD contracts and whether OUSD rebases.

**B. Infrastructure that has never existed**
5. A staging then production environment: AWS account(s), KMS/Vault, Postgres with managed backups (the restore drill script exists and passes on a dev database; it needs running against a real backup), RPC provider, secrets, DNS/TLS, observability. An image build/publish workflow exists (`forgepay-bureau-images.yml`, scan + digest) but has never run. `launch/03` gives the order.
6. The real-token dust tests (USDC, then ZARP, then OUSD), one at a time.
7. Separate hosts and separate accounts for the custody nodes and a restore drill with real officers (needed before any custody launch; not needed for the bureau).

**C. Operations**
8. On-call rota, alert destinations tested, runbooks **rehearsed** (`launch/05-operations-runbook.md` is written and has a game-day checklist, but nobody has run it), incident and key-holder procedures, a customer-support path. Daily reconciliation now exists as code and a procedure; it needs a person to do it daily.
9. Load testing exists for the gateway on a local chain (`scripts/load-test.cjs`, nightly). Soak, chaos, real-RPC and multi-replica testing: not done.

**D. Engineering still open**
10. Gateway-to-signer mutual TLS is built but optional and not in the chart; per-signer cryptographic approval; shared (Redis) rate limiting; email verification; console tenant partitioning of bureau/treasury data; migration serialisation across replicas. (Sweep-recovery integrity and per-user API-key hashing are now done.)
11. Everything in section 2.

## 4. Launch paths

- **Bureau first (recommended):** needs A1 (scope A), A2, A4, B5, B6, C8, and the conservative configuration (`infra/helm/stablecoin-gateway/ci/launch-values.yaml`: human approval of every payout, $250 ceiling, $500 daily cap, USDC only first). Custody, merchants and the unassessed services stay off. Realistically weeks, and mostly waiting on people outside engineering.
- **Custody product:** additionally needs scope-B review, B7, D10, and a much longer track record. Not before the bureau has run.
- **Anything depending on the unassessed services:** assess first.
