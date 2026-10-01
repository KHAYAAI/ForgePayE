# FORGE security-review package

Prepared 2026-10-01 for the company to hand to an independent security-review firm before commissioning a review of
parts of the FORGE platform.

## 1. Purpose

To give outside reviewers - and the people choosing them - an honest, code-grounded description of what is to be reviewed:
how it is built, what secrets it protects, what its authors believe the threats are, what they already know is broken or
unfinished, what the tests prove, and where the authors most want expert eyes. It is also the basis for the request for
proposal (`07-rfp.md`) and for deciding whether the company is ready to engage anyone (`08-readiness-checklist.md`).

It is **not** an independent assessment and it is not a clean bill of health. Several serious defects were found while
writing it; they are listed in `04-known-limitations.md` and should be fixed or consciously accepted before reviewers
are paid to rediscover them.

## 2. Evidence base and its limits

- **Commit reviewed: `da11f54`** (branch `claude/forgepay-platform-design-gEkgE`, 2026-09-30). Every `path:line`
  citation in this package refers to that commit. To see exactly what a citation points at:
  `git show da11f54:<path>`.
- Claims about code were made only after reading the code or document cited. Where something was not verified the text
  says "unverified", "suspected" or "by reading".
- Four items were **reproduced by small throw-away tests** in a scratch copy (F-03, F-04, F-05, F-70). Those tests are not
  committed; they are described in `05-test-evidence.md` section 6.
- **No test was run that needs Postgres, ganache, Vault, AWS KMS or real hosts.** The long Go tests (`go test` without
  `-short`) were not run. No coverage numbers exist or are claimed. `go test -race` and `govulncheck` were not run.
- `npm audit` was run on the committed lockfiles on 2026-10-01; its results are untriaged (`09`).

## 3. Package index and how to read it

| File | What it is | Read it if you are |
|---|---|---|
| [`README.md`](README.md) | This file | everyone |
| [`01-system-overview.md`](01-system-overview.md) | Architecture, trust boundaries, six data-flow diagrams (mermaid) | a reviewer starting out; an engineer checking the diagrams |
| [`02-asset-inventory.md`](02-asset-inventory.md) | Every secret, key, credential and sensitive datum: location, readers, protection, blast radius, rotation | crypto/cloud reviewers; the person writing runbooks |
| [`03-threat-model.md`](03-threat-model.md) | Attackers, trust assumptions, STRIDE per component with `file:line` mitigations and honest status tags | all reviewers; planning the test |
| [`04-known-limitations.md`](04-known-limitations.md) | Defects the authors found (F-01 ...), limitations already documented, documents that disagree with the code | everyone; **read before engaging** |
| [`05-test-evidence.md`](05-test-evidence.md) | Tests that exist, what they prove and do not prove, exact commands, properties with no test | reviewers; engineers adding tests |
| [`06-questions-for-reviewers.md`](06-questions-for-reviewers.md) | 25 specific questions pointing at code | the lead reviewers |
| [`07-rfp.md`](07-rfp.md) | A ready-to-complete request for proposal | procurement, management |
| [`08-readiness-checklist.md`](08-readiness-checklist.md) | What must be true before engaging, with current status | management, engineering leads |
| [`09-dependency-inventory.md`](09-dependency-inventory.md) | Direct dependencies of each service with versions, vulnerability scan and notes | reviewers; the person owning updates |

Suggested order for a reviewer: README, 01, 04, 03, 02, 05, 06, 09. Suggested order for a manager: README section 5,
08, 07, 04 (section 1 headings only).

### Conventions

| Abbreviation | Path (from repository root) |
|---|---|
| `MPC` | `forgepay/services/openfireblocks/services/mpc-signer` (Go) |
| `OFB` | `forgepay/services/openfireblocks/services/api-gateway/src` (NestJS) |
| `OFBDOC` | `forgepay/services/openfireblocks` (docs, deploy examples, infrastructure) |
| `CON` | `forgepay/apps/platform` (Next.js console) |
| `SGW` | `forgepay/services/stablecoin-gateway` |
| `BUR` | `forgepay/services/agent-credit-bureau` |

`path:line` and `path:from-to` always mean lines at commit `da11f54`. Finding ids `F-nn` are defined once, in `04`.
Ratings in `04` are the authors' provisional ratings.

## 4. How to reproduce the test evidence

Full commands, counts and caveats are in `05-test-evidence.md` section 1. In short, from the repository root:

```bash
(cd forgepay/services/openfireblocks/services/mpc-signer && go test ./... -short -count=1)        # 27 passed, 2 skipped
(cd forgepay/services/openfireblocks/services/api-gateway && npm ci && npx jest)                  # 12 suites, 92 passed
(cd forgepay/services/stablecoin-gateway && npm ci && POSTGRES_PASSWORD=x INTERNAL_WEBHOOK_SECRET=x npx vitest run)  # 135 passed
(cd forgepay/services/agent-credit-bureau && npm ci && npx vitest run)                            # 386 passed, 6 skipped
```

The long Go integration tests, the gateway e2e script (Postgres + ganache) and the real Vault/KMS checks are described
there; the authors did not run them for this package.

## 5. What matters most (one page)

Highest-priority defects, each with evidence in `04`:

1. **The MPC coordinator's HTTP API has no authentication** and the gateway calls it with no credential (F-01); the
   coordinator process also always loads a **legacy single signing key** (F-02).
2. **One signed coordinator request destroys a node's active key share** (F-03, reproduced) and there is **no backup** at
   this commit; **per-node limits can be defeated** by a repeated session id (F-04, reproduced) and by negative values
   (F-05, reproduced).
3. **The signer quorum is not cryptographic**: the acting signer is an unauthenticated header protected only by the shared
   admin key (F-20); **API keys can be minted with no quorum** (F-21).
4. **Unauthenticated console routes** call the credit bureau with the console's admin credentials (F-40); the **SSO
   callback can log in as an existing user of another tenant** (F-41).
5. **Any stablecoin-gateway API key, including a merchant key, can create, approve and submit payouts** (F-50), and can
   **squat the bureau's payout idempotency keys** (F-51); a database writer can **redirect sweeps** (F-52).
6. **Concurrent top-up confirmations credit the same payment several times** (F-70, reproduced).

Structural observations: two custody systems with different trust models (threshold shares vs whole hot keys in one
process); many protections exist only when `NODE_ENV`/`MPC_ENV` equals `production`; authorisation everywhere is by shared
static secrets; the database is trusted to say who may be paid. Test gaps: no tests for the governance core
(`custody.service.ts`), the console, or `lib/settlement.ts`; CI does not run the Go, api-gateway or stablecoin-gateway tests.

## 6. What is not in scope

Per the commissioning brief, the package covers components A-D only:

- **A.** Threshold-ECDSA custody: `MPC/**` (Go; `internal/mpc/{node,coordinator,cluster,wire,identity,seal,sealprovider,sealmigrate,sealedfiles,tls,policy,preflight,audit,preparams}.go`, `cmd/mpc-node`, `main.go`, `internal/ethtx`) on `bnb-chain/tss-lib` v2.
- **B.** Custody governance and console: `OFB/{custody,sign,blockchain,auth}/**`, `CON/app/api/**`, `CON/lib/{auth,rbac,invitations,openfireblocks}.ts` (plus supporting files read for context: `jwt-secret`, `mfa`, `sso`, `audit`, `middleware`).
- **C.** Stablecoin gateway: `SGW/src/**`, migrations `004`-`006`.
- **D.** Credit bureau billing and payout paths: `BUR/src/{billing,furnisher-payouts,auth}.ts` and the asset-related routes in `BUR/src/index.ts`.

**Not analysed:**

- The **Mode 2 on-chain contracts** need their own smart-contract audit. Files (`forgepay/on-chain/`):
  `src/ForgeBudgetEnforcer.sol`, `src/ForgeCore.sol`, `src/ForgeCrossChainReputation.sol`,
  `src/ForgeReputationRegistry.sol`, `src/ForgeTransactionValidator.sol` (about 900 lines); scripts
  `script/Deploy.s.sol`, `RegisterAgents.s.sol`, `TransferAdmin.s.sol`, `VerifyAdmin.s.sol`; Foundry tests under
  `test/`; committed testnet deployment records under `broadcast/`.
- Shielded-payment code in the stablecoin gateway (`SGW/src/lib/proof-verifier.ts`, `shielded-*.ts`,
  `routes/shielded-deposits.ts`, `routes/x402-shielded.ts`): disabled by default, Groth16 verification is a stub; only
  noted where it affects boot safety.
- The other roughly two dozen services in the repository, the policy service beyond how the gateway uses it, the
  bureau's scoring, reports, consent and sanctions code, and the Rust/Hyperswitch components.
- Production infrastructure, as deployed: nothing was observed; only repository files were read.
- Cryptographic soundness of tss-lib itself and of its use (`06` Q-1 to Q-6 are the questions for reviewers).

## 7. Work in progress, and why this package must be refreshed

Another engineer was concurrently finishing four things: **key-share backup / disaster recovery in the Go signer,
leader-locking for gateway workers, an alert-routing module, and a live FX-rate source.**

- **At the reviewed commit none of them exists as committed code.** `git ls-tree` of `MPC/internal/mpc` and
  `SGW/src` at `da11f54` has no backup, leader, alert or live-FX source files, and `SGW/src/lib/fx.ts:14` says a live
  feed "is not wired in". Treat them as **in progress**.
- While this package was being written, uncommitted files appeared in the working tree. They were **not read or assessed**.
  Names only, as of the last look (many existing files are also modified, so line numbers in the working tree will not match
  this package):
  - Go signer: `MPC/internal/mpc/{backup,backup_env,backup_service,backup_sink,backupcrypto,shamir}.go`,
    `backupcrypto_test.go`, `disaster_test.go`, `MPC/cmd/mpc-node/backup_cmds.go`; changed `node.go`, `coordinator.go`,
    `cmd/mpc-node/main.go`, `go.mod`, `go.sum`.
  - Stablecoin gateway: `SGW/src/lib/{leader,alerts,fx-feed,asset-probe,watchdog}.ts`, `SGW/src/routes/alerts.ts`,
    tests `leader`, `alerts`, `fx-feed`, `asset-probe`; changed `index.ts`, `settlement.ts`, `sweeper.ts`, `treasury.ts`,
    `payout-worker.ts`, `assets.ts`, `routes/assets.ts`, `README.md`, `scripts/multi-asset-e2e.cjs`.
  - Infrastructure and documentation: `forgepay/infra/helm/mpc-node/`, `forgepay/infra/terraform/{examples,modules/alerts,modules/kms-keys,modules/mpc-backup-bucket}`,
    changes to the Helm charts for the gateway and for `openfireblocks` (including a `networkpolicy.yaml`), new
    `docs/DEPLOYING_THRESHOLD_CUSTODY.md`, `docs/LAUNCH_SCOPE.md`, `OFBDOC/docs/disaster-recovery.md`, `OFBDOC/scripts/dr-drill.sh`,
    changed `threshold-signing.md`, two new GitHub workflows (`forgepay-custody-ci.yml`, `forgepay-custody-nightly.yml`),
    changes to the console's custody keys page.
- Consequences: statements here such as "no backup", "no leader election", "no alerting", "no `NetworkPolicy` for the
  signer", "CI does not run the Go tests" describe `da11f54` only and may be false of the tagged review commit. Findings may
  be fixed, and new code will need review.

**When those changes are committed and a review tag is cut, refresh this package**: re-run the commands in `05`, re-check
every finding in `04` against the tag, update line numbers (or re-cite by `git show <tag>:<path>`), extend `02`, `03`, `06`
and `09` for the new code and dependencies (the Go module already has new AWS SDK modules in the working tree), and update
the scope table in `07`.

## 8. Handling

The package describes unfixed vulnerabilities and the design of key-custody controls. Share it only under NDA, with
named people, and keep it out of public repositories and public issue trackers.
