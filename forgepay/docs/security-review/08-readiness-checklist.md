# 08 - Readiness checklist: what must be true before engaging a reviewer

Status as found on 2026-10-01 at commit `da11f54`, determined by looking at the repository and running the commands in
[05-test-evidence.md](05-test-evidence.md). Status values: **Ready**, **Partial**, **Not ready**, **Unknown** (could not be
determined from the repository: someone must answer). "Unknown" is not "fine".

## 1. The code under review

| # | Item | Status | Evidence / what to do |
|---|---|---|---|
| 1.1 | A **review tag** exists and the working tree is clean at it | **Not ready** | `git tag` returns nothing. At the time of writing `git status` shows about 40 modified or untracked paths (README section 7). Cut a tag after item 1.2 and 1.3 |
| 1.2 | The four in-progress items are **committed and reviewed by their author**: key-share backup / disaster recovery in the Go signer; leader-locking for gateway workers; alert-routing module; live FX-rate source | **Not ready** | Not in `da11f54`. Uncommitted files for each exist in the working tree (not reviewed). When they land: re-cut the tag, update this package (line numbers, 04 section 1 and 4, 05 counts, 09 dependencies; the Go module already changed in the working tree) and add the new code to the lots |
| 1.3 | Defects marked **fix first** in 04 are fixed or consciously accepted in writing | **Not ready** | F-01, F-02, F-03, F-04, F-05, F-20, F-21, F-40, F-41, F-50, F-51, F-52, F-70. Giving reviewers a list of known critical issues and charging them to rediscover it is poor value; fix, or record the acceptance and owner |
| 1.4 | The scope in 07 matches the tag (paths, line counts) | **Unknown** | Recount at the tag and fill in 07 section 3 |
| 1.5 | The Mode 2 contracts are excluded or scheduled separately | **Partial** | Listed in README section 6 and 07 section 3.3; no decision recorded on whether to commission lot 5 |

## 2. Environment the reviewers will use

| # | Item | Status | Evidence / what to do |
|---|---|---|---|
| 2.1 | A **staging cluster** with three `mpc-node` instances on genuinely separate hosts/accounts, mTLS, Vault- or KMS-wrapped seal keys, per-node policies | **Unknown / not evidenced** | The authors' own docs say separate-host behaviour, KMS and the container image were never exercised (`threshold-signing.md:148-153`). `mpc-dev-cluster.sh` runs three processes on one machine (one trust domain). An example Helm chart and Terraform for nodes are uncommitted |
| 2.2 | A **disposable second cluster** reviewers may break (retire, corrupt, delete) | **Not ready** | Needed because F-03 shows destructive requests exist and no backup exists at `da11f54` |
| 2.3 | The api-gateway, console, stablecoin gateway and bureau deployed against a public test network with test tokens and seeded data (workspaces, signers in each role, merchants, furnishers) | **Unknown** | `forgepay/docs/TESTNET_DRESS_REHEARSAL.md` (last changed 2026-09-09; not reviewed here) says the signer had never sent a transaction and settlement had never run end to end *when written*; whether that has since been done is unknown |
| 2.4 | Vault and a KMS key in a **non-production account**, with the example policies applied (and the KMS example corrected, F-15) | **Not ready** | `kms-policy.example.json` does not match what the node calls; `mpc-node seal-check -provider awskms` and `verify-key-custody.ts` have never been run against a real account by the authors |
| 2.5 | A **seeded Postgres** and a way to reset it | **Unknown** | `init-*.sql` scripts exist; `init-phase1.sql` seeds a demo tenant with a public API key (F-35): make sure staging does not rely on it |
| 2.6 | The e2e script and long Go tests run green in the staging toolchain | **Unknown** | Not run by the authors for this package; needs Postgres + ganache and 30-60 minutes of CPU |
| 2.7 | Environments set `NODE_ENV=production` / `MPC_ENV=production` exactly as production will | **Unknown** | Several protections only exist then (F-55); staging should match |
| 2.8 | No real funds, customer data or production secrets reachable from staging | **Unknown** | Confirm and write it down for the rules of engagement |

## 3. Documentation

| # | Item | Status | Evidence / what to do |
|---|---|---|---|
| 3.1 | Reviewer package complete (01-09) | **Ready (for `da11f54`)** | This directory. Needs refresh per 1.2 |
| 3.2 | `threshold-signing.md` accurate | **Partial** | Inaccuracies listed in 04 section 3 (coordinator "holds only an ed25519 key", "everything on disk is sealed", KMS policy) |
| 3.3 | `OFBDOC/docs/security/threat-model.md`, `audit-checklist.md`, `runbook.md` | **Not ready** | Stale: they describe plaintext API keys and in-process-only MPC; the runbook still describes the signer as holding key material (`runbook.md` service map). Replace by this package's `03` or delete |
| 3.4 | `SGW/README.md` accurate | **Partial** | EURC/HD derivation claims, unit-test statements (04 section 3) |
| 3.5 | Operator runbooks for: share loss, node replacement, CA rotation, coordinator-key rotation, seal-key rotation, Vault/KMS outage, incident response for key compromise | **Not ready** | Partly described (reshare, retire-stale, seal-migrate, rewrap). No procedure for lost shares (no backup yet), for rotating a node identity or the coordinator key (`cluster.go:267-278`), or for deposit-key wrapping-key rotation |
| 3.6 | Architecture and data-flow diagrams the engineers agree with | **Partial** | 01 was written from the code; no engineer sign-off recorded. Ask the owners to review it before the kick-off |

## 4. Known-issue list and tracking

| # | Item | Status | Evidence / what to do |
|---|---|---|---|
| 4.1 | A single list of known defects and limitations | **Ready (for `da11f54`)** | `04-known-limitations.md`; the authors' ratings are provisional |
| 4.2 | Each item has an owner, a status and a tracker entry | **Not ready** | Create tracker items for F-ids and decide fix / accept / defer; then ask the reviewers to map their findings to them |
| 4.3 | A named triage contact and response times | **Unknown** | Needed for 07 section 12 |

## 5. Test evidence reproducible

| # | Item | Status | Evidence |
|---|---|---|---|
| 5.1 | Fast unit tests pass at the tag, with documented commands | **Ready (for `da11f54`)** | Go: 27 passed, 2 skipped; api-gateway: 12 suites, 92 passed; stablecoin gateway: 135 passed; bureau: 386 passed, 6 skipped (05) |
| 5.2 | The same tests run in CI on every change | **Not ready** | `forgepay-ci.yml` runs the bureau tests, but has no job for the Go signer, the openfireblocks api-gateway or the stablecoin gateway tests, and the console has only type-check and build. Add jobs. (Two uncommitted workflows, `forgepay-custody-ci.yml` and `forgepay-custody-nightly.yml`, appeared in the working tree; not reviewed) |
| 5.3 | Long integration tests and the e2e script pass | **Unknown** | Not run for this package |
| 5.4 | Coverage of the governance core and the console | **Not ready** | No tests for `custody.service.ts` or the console (05 sections 3.1 and 3.2); none for settlement (05 section 4) |
| 5.5 | `go test -race`, `go vet` (including the `tss` build tag), fuzzing | **Partial** | `go vet ./...` clean at HEAD (the `tss` package is excluded by its build tag); `-race` never run |

## 6. Dependencies

| # | Item | Status | Evidence |
|---|---|---|---|
| 6.1 | Dependency inventory with versions | **Ready (for `da11f54`)** | `09-dependency-inventory.md` |
| 6.2 | Known-vulnerability scan with triage | **Partial** | `npm audit --omit=dev` run on 2026-10-01 reported 6 / 6 / 16 / 5 advisories (stablecoin gateway / bureau / api-gateway / console), including one critical (`next`) and many high; listed in 09, **not triaged**. Go modules were **not scanned** (`govulncheck` not available) |
| 6.3 | Automated update tooling covers all in-scope projects | **Partial** | `.github/dependabot.yml` covers the console, bureau and stablecoin gateway but has no entry for `forgepay/services/openfireblocks/services/api-gateway` or for any Go module (`mpc-signer`) |
| 6.4 | Pinned, reproducible builds and an SBOM | **Partial** | Lockfiles and `go.sum` are committed; images not built or scanned by the authors; no SBOM |

## 7. People, process and contracts

| # | Item | Status | What to do |
|---|---|---|---|
| 7.1 | Budget approved and an executive sponsor | **Unknown** | Use the estimates in 07 section 6 only as a starting point |
| 7.2 | NDA and safe-harbour wording, legal review of sharing known vulnerabilities | **Unknown** | The package describes unfixed issues; restrict distribution |
| 7.3 | Repository access method for outside reviewers (read-only, time-limited) | **Unknown** | Decide: scoped GitHub access, or a signed archive of the tag |
| 7.4 | Engineers named per component and available during fieldwork | **Unknown** | |
| 7.5 | Insurance / regulatory requirements for the report or attestation (banking partners, regulators) | **Unknown** | Decide whether an attestation letter is needed (07 section 4.8) |
| 7.6 | A repository-wide secret scan and removal of seeded or default credentials from anything a reviewer will receive | **Partial** | Quick searches at `da11f54` found no private-key blocks or cloud access keys in the in-scope paths and no committed `.env` (only `.env.example`); public development credentials exist (F-35, `dev-demo-key`, `dev-admin-key`, `dev-only` DB password, `devpassword` in examples). No tool-based scan (for example `run_secret_scanning`/gitleaks) was run |

## 8. Suggested order of work

1. Decide and fix the **fix-first** list (1.3); at minimum put authentication and network policy in front of the
   coordinator API (F-01), remove or unload the legacy key (F-02), and close F-40, F-50, F-51.
2. Land and review the four in-progress items (1.2); cut the tag; refresh this package.
3. Prepare staging (2.1-2.8) and the disposable cluster; run the long tests and e2e on it.
4. Add the missing CI jobs and the tests listed in 05 for the governance core, settlement and the new fixes.
5. Triage dependency advisories (6.2) and extend Dependabot (6.3).
6. Fix the stale documents (3.2-3.5); have engineers review `01`.
7. Complete 7.x, send the RFP (`07-rfp.md`), and give the shortlisted firms the NDA first.

When items 1.1-1.3, 2.1-2.4, 4.2, 5.1-5.2 and 7.2-7.3 are green, the company is ready to engage.
