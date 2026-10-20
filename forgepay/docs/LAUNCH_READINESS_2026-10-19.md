# Launch readiness: 19 October 2026

Supersedes `LAUNCH_READINESS_2026-10-16.md` for the bureau path. The service-by-service survey of 7 October (`LAUNCH_READINESS_BY_SERVICE_2026-10-07.md`) is still the reference for services this document does not re-inspect.

## 1. Verdict

**Nothing is live and no real money has been processed.** There is no cloud environment of any kind (staging or production). The code for the first launch target, the FORGE credit bureau, is complete and tested locally and in CI. What remains is overwhelmingly **not code**: building the environments, running the money path for the first time against real infrastructure, an independent security review, counsel's written answers, and operating readiness.

| Level | Meaning | State today |
|---|---|---|
| 0. Sandbox pilot | A lender or furnisher calls the sandbox with synthetic data; no real data, no money | **Not started.** Needs a deployed bureau (staging) and a public sandbox URL. About as soon as staging exists |
| 1. Testnet money path | Staging deployment settles a real Base Sepolia payment end to end (deposit, sweep, approved payout, reconcile) | **Not started.** Blocked on AWS staging |
| 2. Capped real-money soft launch | A handful of known customers, USDC on Base, small limits, every payout approved by a person | **Blocked** on levels 0–1, the independent review, counsel's answers and on-call |
| 3. Public launch | Open sign-up, raised limits | **Far off.** Needs weeks of clean daily reconciliation after level 2 and the National Credit Act position resolved |

What changed my confidence since 16 October is small and mostly good news about tooling, not about the launch gates: deploys are now digest-only and signature-checked, a flaky nightly test was found and fixed, and a mistaken claim about the contracts was corrected (section 6). No gate in section 3 moved from "open" to "done" because gates are about the real world, and the real world has not been touched.

## 2. Evidence base, and its limits

Gathered 19 October 2026 on branch `claude/forgepay-platform-design-gEkgE`:

| Check | Result |
|---|---|
| stablecoin-gateway | 233 tests pass, 8 skipped; typecheck clean |
| agent-credit-bureau | 606 tests pass, 11 skipped; typecheck clean |
| console (`apps/platform`) | 83 tests pass, 3 skipped; typecheck clean |
| Gateway end-to-end against real Postgres and a local chain | 115/115, three clean full runs after the flake fix |
| CI at the previous head | 31 jobs success, 2 failing (below), 2 skipped |
| CI at the head of the flake-fix commit (`193e210b`) when last read | 39 success, 18 in progress, 3 failing (advisory), 2 queued. **Not yet settled; re-read before relying on it** |
| Production-dependency audit (`npm audit --omit=dev`) | 19 Oct: gateway 4 high + 2 moderate, console 1 high + 1 moderate. **20 Oct, after upgrades: 0 findings in bureau, gateway and console** (section 5) |

What these do **not** show: that anything works on AWS, against a real acquirer, a real custody backend, a real sanctions feed, a real company register, or real users. A passing suite shows the code does what its authors checked. It is not a security review, a load test, or proof against partners.

**Not re-inspected today** (state is as of 7 October): `unified-router`, `mor-layer`, `billing-engine`, `crypto-gateway`, `accounts-service`, `enterprise-treasury`, `bank-connectivity`, `bank-whitelabel`, `institutional-reporting`, `yield-engine`, `rwa-registry`, `liquidity-forecaster`, `chain-sync`, `agent-identity`, `agent-decision-framework`, the Hyperswitch core, and the marketing site. None of them is on the first launch path.

## 3. The go / no-go gates

From `launch/00-LAUNCH-STEPS.md`. Status words: **Open** (not started), **Partial** (preparation done, real-world step not), **Done**.

| # | Gate | Status | What exists | What is missing | Owner |
|---|---|---|---|---|---|
| 17 | Review firm's findings fixed and re-checked, written sign-off | **Open** | Review pack (`docs/security-review/`) and engagement guide (`launch/01`) | No firm engaged per anything in the repository; no frozen tag sent; fixes and re-check time still to budget | Founder |
| 18 | Counsel's written answers, requirements met | **Open** | Briefs `02-counsel-brief.md` and `12-popia-custody-attestations.md`. The brief was set aside by the founder on 6 October | Nothing sent. Whether scoring agents triggers National Credit Act registration, the POPIA position on custody data, and what must hold before the first unit of revenue | Founder + counsel |
| 19 | Staging and testnet complete, no unexplained balance difference | **Open** | Smoke script (19/19 local chain), dust procedure, 115-check local e2e | No staging. No Base Sepolia run through a deployed stack. Two runs a day apart not done | Founder (AWS) + me |
| 20 | Sanctions proven to refuse a listed address and to fail closed, in the production-shaped deployment | **Partial** | Compliance monitor fails closed until lists load and are under 72h old; bureau refuses when the monitor is down (tested locally) | Never loaded live. The South Africa list copy in the repository expires **5 November 2026** and needs refreshing; not proven in a deployed environment | Me (code) + Founder (feed access) |
| 21 | On-call named, alerts tested this week, game day done, reconciliation owner named | **Open** | Runbook `05`, alert test endpoint | No environment to test in; no named people, no pager | Founder |
| 22 | Rollback understood (`payout.signerEnabled=false`) | **Partial** | Documented; helm `--atomic`; running-pod digest proof in the deploy workflow | Never exercised on a real cluster | Founder + me |
| 23 | Conservative limits, unchanged | **Done in code** | Limits and defaults in `launch/04-conservative-launch.md` and the launch values | Only becomes true when deployed; keep it in the checklist | Founder |

Pre-gates (steps 4–16), where most of the real calendar time is:

| Step | Status | Note |
|---|---|---|
| AWS account secured, staging account, tools, domain and certificate | **Open** | Phase 1 instructions sent (`launch/15-aws-start-here.md`); I have no report back. Nothing in the repository touches AWS yet. The founder is doing the AWS build-out themselves |
| Four separate wallets generated offline | **Open** | Founder; keys never pasted anywhere |
| Secrets in a secret store | **Open** | Services refuse to start in production with missing or placeholder secrets |
| Terraform plan and apply to staging | **Open** | CI only validates (fmt, validate); never planned or applied. Expect to fix things |
| First image build, scan, sign on `main` | **Partial** | Runs on the branch: all 8 images built, Trivy-scanned, signed and self-verified in CI. The deploy workflow requires signatures from `main`, and `main` has no signed images because this work is not merged there |
| Deploy workflow end to end | **Open** | Has never run, not even as a dry run. Its first run is its test |
| KMS key-custody check, restore drill, `/alerts/test` | **Open** | Scripts exist; each has only run against fakes or locally |
| Game day | **Open** | Needs staging |
| Testnet runs and dust test | **Open** | Needs staging, RPC provider, funded throwaway wallets, and the Circle-documented test USDC address (verify it there; do not trust a recalled address) |

## 4. Product by product

### FORGE credit bureau (`agent-credit-bureau`) — launch target

**Built and tested:** Mode 1 rules scoring; Mode 2 on-chain scoring read from an agent's own wallet; institution keys with limits and signed webhooks; single-use consent tokens; disputes; billing; a lender sandbox; operator verification through a company-register seam; custody attestations; an activity indexer for Base, Ethereum (EVM) and Solana (finalized commitment, per-account cursors, atomic page commits).

**Still not proven:**
- Never deployed. Persistence is tested against real Postgres in CI, but not on managed Postgres with backups.
- Operator verification: the Didit provider is written with guards (sandbox cannot be selected as a production source; spend cap). Its HTTP paths and auth header are **unconfirmed** because Didit's documentation host and API were not reachable from the build sandbox, and Didit lists South Africa as `validated: false`. It needs one smoke run (`scripts/didit-kyb-smoke.mjs`) against a real South African company with a key read from the environment. The key the founder pasted into chat on 14 October must be treated as exposed and rotated.
- Mode 2 indexer: tested against fakes and fixtures; not against real RPC providers at volume.
- Legal: whether the bureau scores "consumers" under the National Credit Act, and what POPIA requires of data derived from custody (gate 18).

### Console (`apps/platform`)

83 tests pass. Custody attestation screen, institution onboarding and wallet binding exist. Published-key fallbacks were removed: with no credential in production it now refuses rather than using a baked-in key. The console has its own Helm chart and deploy path (new this week), which has never been installed on a cluster. Now on Next 16; production audit is clean (section 5).

### Stablecoin gateway — the bureau's payment rail

233 tests, 115-check e2e, 19/19 smoke on a local chain. Payouts can be signed by a hot key or sent through FORGE custody (`PAYOUT_SIGNER_MODE=custody`, recipient list required in production, ambiguous results resolved by status lookup, reply mismatch refused). Settlement timing is compared in whole seconds with deterministic boundary tests.

**Not proven:** any run against a real chain through a deployed service; custody payouts against a real custody backend; KMS key wrapping against real KMS. A daily-payout-ceiling double-count issue was found and has been handed off as a separate task, not fixed. Production audit is clean after the 20 October upgrade (section 5).

### Compliance monitor

Fails closed until lists are loaded and fresh. The South Africa list copy expires 5 November 2026. Loading from live sources has never been demonstrated from a deployed environment.

### FORGE Custody

Two codebases. The real backend is the separate repository `KHAYAAI/openfireblocks` (Elastic License 2.0), pinned in `config/base/pinned-upstreams.yaml` at `5b6ab125…` on branch `claude/platform-explanation-h0st5y`. The agent-attestation work is on its own branch `claude/agent-attestation` (commit `81c3728`), pushed but **not merged and not deployed**. The vendored copy under `services/openfireblocks` is older and smaller. Neither is audited. Custody is **testnet and capped pilots only** and is not on the bureau's critical path except as an optional payout signer and an attestation source.

### Payments stack (Hyperswitch core, unified-router, mor-layer, billing-engine)

Built; never run against a real acquirer or bank. Out of scope for the bureau launch. Needs licences or a partner first. Website checkout is closed by default (per the 7 October audit; not re-inspected today).

### Treasury, wallet

Treasury reads and approvals persist; settlement, yield and tokenised-asset execution do not exist. Hosted wallets (`open-privy`) are off by decision because the design can decrypt keys. Near-term wallets are bring-your-own.

### Off by decision

`agent-credit-lines`, `agent-negotiation`, `agent-liquidity-manager`. FORGE is a bureau: lenders fund credit. These stay off.

### On-chain contracts

The five-contract stack (`ForgeReputationRegistry`, `ForgeTransactionValidator`, `ForgeBudgetEnforcer`, `ForgeCore`, `ForgeCrossChainReputation`) was deployed to **Base Sepolia on 2 September 2026**: 15 successful receipts in `on-chain/broadcast/Deploy.s.sol/84532/run-latest.json`. Not on mainnet. The shielded-payment contracts have never been deployed. The bureau's first launch does not depend on any of these contracts.

### Website

Static marketing site; not re-inspected today.

## 5. Cross-cutting

**Supply chain.** Images are built, Trivy-scanned by digest, signed keylessly with cosign, self-verified, then listed by digest. The deploy workflow checks the digest format, the expected repository, and the cosign identity (`…/forgepay-bureau-images.yml@refs/heads/main`) **before** any AWS credential is used; uses OIDC (no stored AWS keys); waits for a human approver in the `production` GitHub Environment; defaults to a dry run; installs atomically; and proves the running pods are on the approved digest. Charts can refuse to render without a digest. Third-party actions are pinned to commit SHAs (98 references) with a CI guard, and Dependabot proposes weekly updates. **Gaps:** nothing here has run against a cluster; no in-cluster admission control re-checks signatures; the real custody repository's charts have not been switched to digests.

**Dependency advisories (production dependencies only).** On 20 October the gateway and console were upgraded and `npm audit --omit=dev` now reports **0 findings for the bureau, the gateway and the console**.

| Package | Before | Change |
|---|---|---|
| stablecoin-gateway | 4 high, 2 moderate | `fastify`, `ethers`, `ws`, `fast-uri`, `find-my-way` to patched versions in range; `uuid` 10 to 11.1.1 (not imported by the source). Fastify now treats a bare number `trustProxy` as "trust nothing", which would have put every client behind the load balancer on one rate-limit key; the gateway now passes a hop function (as the bureau already did) and a test covers forged `X-Forwarded-For` |
| console | 1 high, 1 moderate | `next` 15.5 to 16.4.2 (only fixed in 16). Typecheck, 83 tests and the production build pass locally. Not yet exercised in a browser or a container |
| agent-credit-bureau | none | none |

Only the audit's *production* view was checked; dev-only dependencies and the other services were not. The non-blocking "npm audit" CI jobs should be re-read on the new commit.

**CI state.** The inherited upstream Hyperswitch scheduled workflows (the nightly tag and the Postman run) fail on this fork; they are not ForgePay's. The flaky nightly end-to-end test (two sequential Redis fallback calls near a 5 s limit) was fixed with an explicit timeout and verified locally three times; it is **verified in CI only after the next nightly run**.

**Observability and operations.** A runbook and alert test endpoint exist. There is no deployed pager, no on-call rota and no dashboards in any environment.

**Privacy and legal.** POPIA position on custody-derived data and the National Credit Act question are with counsel in name only; nothing has been sent. Where South African personal data may live in production (region) is deliberately deferred to counsel; staging is planned for `eu-west-2` with test data only.

## 6. What changed since 7 and 16 October

- Corrected: the 7 October survey said the on-chain contracts were "never deployed". They were deployed to Base Sepolia on 2 September (the shielded contracts were not). A correction note has been added to that document.
- Deploys are manual, digest-only, signature-verified, OIDC-authenticated and approval-gated. The old deploy workflow could never have worked (it had no chart); a console chart now exists.
- Digest enforcement and CI cases exist for console, bureau, gateway, mpc-node and the vendored custody chart.
- Custody-backed payouts, custody attestations, a Solana and EVM activity indexer, and a Didit company-register provider were added.
- A flaky nightly test was found and fixed; a settlement boundary was nailed down with deterministic tests.
- README rewritten with conservative status; errors in it (retired services, credit lines, service counts) removed.

## 7. Critical path and timeline

The order that matters; durations are my estimates and mostly other people's time.

1. **Start now, in parallel (calendar-bound):** engage the review firm (weeks to book, then findings and a re-check); send the counsel brief (weeks for written answers); rotate the Didit key; refresh the South Africa list before 5 Nov.
2. **AWS build-out (founder):** secure account, staging account, tools, domain and certificate (days), then plan and build staging (a day or two once prerequisites exist; real cost, a few hundred US dollars a month if left running).
3. **Merge to `main`** so signed images exist; run the deploy workflow as a dry run, then for real in staging (a day).
4. **Staging proof:** sanctions refusal and fail-closed, KMS check, alert test, restore drill, game day (about a week with fixes).
5. **Testnet money path:** two runs a day apart, then the dust procedure through staging (days).
6. **Level 0 sandbox pilot** can begin as soon as step 3 works and a public sandbox URL exists.
7. **Level 2 soft launch** only after review sign-off, counsel's answers, on-call and a production environment with the step-10 checks repeated.

Realistic range: **level 0 in roughly 2–4 weeks** if AWS work starts now; **level 2 in roughly 2–4 months**, set by the review firm and counsel rather than by engineering. Level 3 is beyond that and depends on the National Credit Act answer.

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Counsel concludes NCA registration is required before scoring | Medium | Launch blocked or restructured | Ask early; the bureau could start with synthetic or non-consumer data |
| Review firm finds serious issues in the gateway | Medium | Weeks of rework | Book early; fix known advisories first; frozen tag |
| Didit's ZA coverage is unusable | Medium | Operator verification needs another provider | The seam is provider-agnostic; run the smoke test first |
| First real run of anything fails | High | Delay only if staging time is scarce | Treat every first run as a test; budget fix time |
| Staging cost overrun | Medium | Surprise bill | Budget alerts (phase 1); tear down when idle |
| Single approver for production deploys | Medium | Defeats the gate | Name a second person |
| Exposed Didit key | Certain it was exposed | Misuse of credit balance | Rotate; never stored in the repository |
| South Africa sanctions list copy expires 5 Nov | Certain | Screening fails closed (safe but blocks) | Refresh; then automate |
| Gateway dependency advisories | Medium | Exploitable endpoint | Upgrade and re-test before the tag freeze |

## 9. Decisions only the founder can make

1. Engage the review firm and counsel (and when). 2. Region for staging (recommended `eu-west-2`). 3. Who is the second production approver. 4. Where `myforgepay.com` is registered. 5. Merge to `main`. 6. Whether to guard the inherited upstream scheduled workflows on the fork. 7. Whether to switch the real custody repository's charts to digests.

## 10. Evidence index

- Gates: `docs/launch/00-LAUNCH-STEPS.md`; limits: `04-conservative-launch.md`; runbook: `05-operations-runbook.md`
- Deploy path: `docs/launch/14-deploying-services.md`, `.github/workflows/deploy-service.yml`, `.github/workflows/forgepay-bureau-images.yml`
- AWS: `docs/launch/15-aws-start-here.md`, `infra/staging/`
- Contracts: `on-chain/broadcast/Deploy.s.sol/84532/run-latest.json`
- Earlier assessments: `LAUNCH_READINESS_2026-10-16.md`, `LAUNCH_READINESS_BY_SERVICE_2026-10-07.md`
