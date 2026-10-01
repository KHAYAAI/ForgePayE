# 05 - Test evidence

Evidence base: commit `da11f54`. Path abbreviations: see [README.md](README.md).

**How the numbers below were obtained.** On 2026-10-01 the authors exported commit `da11f54` with `git archive` into a
scratch directory, linked the existing `node_modules`, and ran the commands exactly as written in section 1. Numbers are
what those runs printed; nothing is estimated. Tests that are not run in "short" mode, the e2e scripts, `go test -race`,
`govulncheck`, container builds and anything needing real Vault, AWS KMS, Postgres or ganache were **not run** by the
authors for this package. Line coverage was **not measured**; no coverage numbers are given.

The working tree contains uncommitted work by another engineer (README section 7). Re-run the commands on the tagged
review commit and update the counts.

## 1. Commands

All paths are relative to the repository root.

### 1.1 Unit and fast tests (run by the authors)

```bash
# A. Go signer + nodes (27 passed, 2 skipped by -short)
cd forgepay/services/openfireblocks/services/mpc-signer
go test ./... -short -count=1 -v
go vet ./...                      # printed nothing (the tss/ package is behind a build tag and is not vetted)

# B. api-gateway (NestJS, jest): 12 suites, 92 tests passed
cd forgepay/services/openfireblocks/services/api-gateway
npm ci && npx jest

# C. stablecoin-gateway (vitest): 11 files, 135 tests passed
cd forgepay/services/stablecoin-gateway
npm ci && POSTGRES_PASSWORD=x INTERNAL_WEBHOOK_SECRET=x npx vitest run

# D. credit bureau (vitest, whole service): 23 files passed + 1 skipped; 386 tests passed + 6 skipped
cd forgepay/services/agent-credit-bureau
npm ci && npx vitest run
```

Console (`forgepay/apps/platform`): **there are no tests.** CI runs `tsc` and `next build` only
(`.github/workflows/forgepay-ci.yml`, job `platform`).

CI at HEAD: the workflow runs bureau tests (job `agent-credit-bureau`) but contains no job that runs the Go tests, the
stablecoin-gateway tests or the openfireblocks api-gateway tests (`git show HEAD:.github/workflows/forgepay-ci.yml |
grep -n "mpc\|openfireblocks\|stablecoin"` returns nothing; `forgepay-docker.yml` builds the stablecoin-gateway image
only).

### 1.2 Long integration tests (not run by the authors)

```bash
cd forgepay/services/openfireblocks/services/mpc-signer

# Real 2-of-3 key generation, signing, policy, restart, audit across three in-process nodes (loopback HTTP).
# Source says "a minute of CPU"; the test allows 4 minutes.
go test ./internal/mpc -run 'TestThresholdSigningAcrossRealNodes' -count=1 -timeout 30m -v

# Real 2-of-4 key, then drop a node / refresh / replace / raise threshold. Source allows 25 minutes.
go test ./internal/mpc -run 'TestReshareMovesAKeyWithoutChangingItsAddress' -count=1 -timeout 60m -v

# tss-lib proof-of-concept package, behind a build tag (tss/README.md:21-23)
go test -tags tss -vet=off ./tss/ -run TestThresholdKeygenAndSign -v
```

### 1.3 End-to-end scripts (need external services; not run)

| Script | Needs | What it does |
|---|---|---|
| `SGW/scripts/multi-asset-e2e.cjs` (97 `check(...)` assertions) | Postgres reachable via `PGHOST/PGUSER/PGPASSWORD`; ganache (chain id 1337) on `:8545` (`RPC_URL`); `FUNDER_MNEMONIC`; optional Vault (`E2E_KEY_WRAP=vault`, `VAULT_ADDR`, `VAULT_TOKEN`) | Starts the real gateway with `tsx` against a throw-away database and mock ERC-20s; exercises quoting, x402, settlement (partial, late, wrong token, restart), payouts, payout worker reconciliation, sweeps, recovery, treasury tiers, asset verification. Run: `node scripts/multi-asset-e2e.cjs` from `forgepay/services/stablecoin-gateway` |
| `OFBDOC/scripts/mpc-dev-cluster.sh [DIR]` | Go toolchain; optional `MPC_DEV_TLS=1`, `MPC_DEV_SEAL=vault` with `VAULT_ADDR`/`VAULT_TOKEN`, `MPC_DEV_POLICY=0` | Runs three real `mpc-node` processes on one machine (one trust domain) and writes `signer.env`; used for manual end-to-end runs |
| `OFBDOC/tests/smoke/smoke.sh` | A running api-gateway stack | Health, tenant creation, signing, tenant isolation, audit trail |
| `mpc-node seal-check -provider vault\|awskms`, `npx tsx scripts/verify-key-custody.ts` | Real Vault / AWS KMS credentials | Wrap/unwrap throwaway keys against the real key service; **never run against a real AWS account by the authors** (`threshold-signing.md:148-149`, `SGW/README.md:108`) |
| `npm run preflight:signer` (`SGW/src/cli/signer-preflight.ts`) | RPC + signer env | Read-only check of the payout signer's chain, gas and daily-cap state |

Important limit of the gateway e2e script: it starts the gateway with `NODE_ENV=development` and sets neither
`VALID_API_KEYS` nor `MERCHANT_API_KEYS` (`multi-asset-e2e.cjs:72-73` and its `startGateway` env), so **every call is the
development "any key is admin" principal**. It therefore cannot detect merchant-key authorisation failures such as F-50,
and production boot guards are not exercised by it.

---

## 2. Component A - Go signer and nodes

Result at HEAD: 27 tests passed; 2 skipped in `-short` (`TestThresholdSigningAcrossRealNodes`,
`TestReshareMovesAKeyWithoutChangingItsAddress`). Source: 1,685 lines of Go tests vs 6,054 lines of non-test Go.

| Test (file:line) | What it proves | What it does **not** prove |
|---|---|---|
| `TestSealRoundTripAndBinding` (`cluster_test.go:30`) | Seal/open round trip; wrong key or AAD fails | Nothing about key management |
| `TestPeerMessagesAreAuthenticatedAndDirectional` (`:51`) | A peer message fails if altered, addressed elsewhere, or reflected | Forward secrecy; replay across sessions; compromised identity key |
| `TestCoordinatorSignature` (`:85`) | Body signature verifies/fails | Binding of a signature to an endpoint or recipient node |
| `TestClusterValidation` (`:101`) | Bad cluster files are rejected | Hot-reload races |
| `TestFinalizeSignatureFoldsHighS` (`:129`) | Low-S normalisation and recovery id | Behaviour with adversarial `R,S` |
| `TestAuditChainDetectsTampering` (`:151`) | Editing or deleting a middle line breaks verification | Tail truncation, full recomputation, write errors (F-09) |
| `TestOutgoingMessagesAreStillDeliveredAfterTheSessionCompletes`, `TestAFailedSessionStopsSending` (`:612,639`) | Delivery retry semantics of `post` | Network partitions on real hosts |
| `TestThresholdSigningAcrossRealNodes` (`:344`), **skipped in short**: shares sealed and differ (`:361`), key id cannot be overwritten (`:390`), every 2-node committee signs a valid EIP-155 transaction (`:396`), one node down tolerated and two down refused with a quorum error (`:416`), signing routes to the right key and a wrong address is refused (`:430`), unsigned/wrongly-signed/altered/stale requests refused (`:448`), a session id cannot be replayed (`:473`), forged peer messages refused (`:486`), a node enforces its own value cap (`:494`), policy file rules enforced: blocklist, allowlist, chain, fee, plain-transfers-only, token-recipient blocklist, daily limit, broken edit keeps rules (`:512`), shares survive restart (`:582`), audit chains intact (`:589`) | The cryptographic protocol works end to end on loopback and produces Ethereum-valid signatures; the listed refusals fire | Separate hosts, real latency, mTLS in this test (the harness uses plain HTTP, `newHarnessN` starts `httptest` servers), concurrency under load, malicious protocol messages, the duplicate-session release (F-04), negative values (F-05), `retire` abuse (F-03) |
| `TestReshareMovesAKeyWithoutChangingItsAddress` (`reshare_test.go:26`), **skipped in short**: drop a node, refresh, replace, raise threshold (`:71-158`), refusal when a new member is unreachable changes nothing (`:160`), bad requests refused (`:175`), audit lines present (`:194`) | The address survives four sequential reshares; old shares are destroyed on leaving nodes; failed pre-flight leaves state unchanged | **Commit failure / partial commit (F-07)**, a lying `KeyMeta` reporter (F-08), restart in the middle, the probe covering only one subset, malicious old/new party messages |
| `TestSelectorAllowlist`, `TestEmptyPolicyAllowsEverything`, `TestPolicyRejectsBadFiles`, `TestRollingLimitsAreReleasedAndPersist`, `TestLimitsExpireAfterTheWindow`, `TestEditedPolicyIsPickedUpAndABrokenEditKeepsTheOldRules`, `TestLegacyCapCombinesWithFile` (`policy_test.go:29-189`) | The static rules, rolling-window arithmetic, persistence across a reopen, release on failure, reload semantics | Duplicate-session release (F-04) and negative values (F-05) are not tested; ERC-20 amounts are not limited (F-06); ledger growth |
| `TestVaultProviderWrapsKeyAndBindsItToTheNode`, `TestVaultUnreachableFailsClosed`, `TestProductionRefusesKeysBesideTheData`, `TestKMSProviderUsesEncryptionContext`, `TestMigrateSealKeyFileToVaultAndResume` (`sealprovider_test.go:58-214`) | Seal-key wrapping, node binding, fail-closed on unreachable Vault, production refuses `file`/`env`, KMS context enforced by a **fake** that speaks KMS's protocol, file->Vault migration resumes after interruption | Real Vault/KMS behaviour (docs say a real Vault dev server was exercised manually, which is not in the repository), vault->vault or kms->kms re-keying |
| `TestNoSingleDomainMayHoldEnoughNodesToSign`, `TestProductionNodeRefusesToStartInADevTopology`, `TestMutualTLSIdentifiesCallers` (`topology_test.go:27,66,104`) | Domain rule; production refuses plain HTTP/dev topology; client certs required; certificates from another CA rejected; peers cannot start ceremonies or send as another node; coordinator cert alone is not enough without a signed body | Real certificates on separate hosts; renewal/expiry; revocation; the CA key handling |
| `signer_test.go` (4 tests) | Legacy single-key signing builds valid legacy and 1559 transactions | Nothing about threshold signing |
| `tss/tss_test.go` (behind `-tags tss`, skipped in `-short`) | A 2-of-3 in-process tss-lib keygen and signature recover the address | Anything about this repository's transport |

**Properties of component A with no automated test at all**

- Authentication of the coordinator HTTP API (none exists, F-01); the legacy key being loaded (F-02).
- `retire` with `leaving:true` (F-03), duplicate session release (F-04), negative values (F-05), calldata amounts (F-06),
  partial commit (F-07), `KeyMeta` with a dishonest reporter (F-08).
- `Preflight()` and `CheckSealProvider()` (`preflight.go`, `sealcheck.go`) have no unit test; neither has `cmd/mpc-node`
  or `internal/ethtx` on its own.
- Restart of a node with a pending (uncommitted) share on disk; crash between `Link` and `Remove` in `commit`.
- Clock skew, requests at the edge of the 2-minute window, restart-window replay.
- A node holding two roles (old and new) with an interrupted session; the party-key derivation under hash collisions of
  the mod-`q` reduction (06 Q-2).
- Race conditions: no `go test -race` run exists in CI or in the repository's docs.
- Fuzzing of any parser (`ethtx`, wire messages, policy JSON beyond a few cases).

---

## 3. Component B - api-gateway and console

### 3.1 api-gateway (12 suites, 92 tests passed)

| Suite (tests) | What it proves | What it does **not** prove |
|---|---|---|
| `auth/admin.guard.spec.ts` (4) | Fails closed with no `ADMIN_API_KEY`; wrong key rejected | Actor identity (the header) is not tested because nothing validates it |
| `auth/api-key.guard.spec.ts` (4), `auth/api-key.util.spec.ts` (3) | Key extraction, hashing, constant-time compare | |
| `sign/sign.service.spec.ts` (20) | Policy-deny and velocity-deny paths; queue-for-approval; deny when no signers; threshold key use; broadcast outcomes incl. `signed_not_broadcast`, "already known", nonce-used-by-other; rebroadcast claim race; balance refusal; "a database error while recording a successful broadcast is not reported as a broadcast failure" | Uses mocked pg/HTTP. Not tested: retry of an approved transfer after a post-persist failure (F-23) |
| `blockchain/nonce.service.spec.ts` (7) | Per-address ordering and lock release | Real Postgres advisory locks across processes; pool exhaustion |
| `blockchain/transfer-planner.service.spec.ts` (11) | Fee/gas planning and balance refusal | |
| `blockchain/tx-poller.service.spec.ts` (13) | State transitions, the advisory lock path (`pg_try_advisory_lock`), orphan repair | Reorgs (documented as unhandled) |
| `custody/keys-backfill.service.spec.ts` (8), `custody/keys-rotation.spec.ts` (12) | Backfill resumability, lock ordering around rotation, fleet rotation reporting | The signer's real behaviour; orphan keys (F-34) |
| `policies/policy.service.spec.ts` (2), `risk/risk.service.spec.ts` (4), `billing/billing.service.spec.ts` (4) | Fail-closed policy, velocity behaviour, metering never blocks | Redis fail-open default (F-29) |

**No tests exist** for `custody/custody.service.ts` (proposals, votes, quorum evaluation, cooling-off, API-key issuance,
retry), `custody/custody.controller.ts`, `custody/quorum.ts`, `customers/*`, `sign/sign.controller.ts`,
`database/*`. This is the governance core of component B: the vote counting, the removal of signers' votes, threshold
changes, the `eligibleSigner` checks and the cooling-off rules are untested.

### 3.2 Console

No unit, integration or e2e test exists in `apps/platform` (`find apps/platform -name '*.test.*' -o -name '*.spec.*'`
returns nothing). RBAC, session revalidation, invitation single-use, MFA and the custody-action permission map have no
automated tests. CI type-checks and builds only.

---

## 4. Component C - stablecoin gateway

Result at HEAD: 135 tests in 11 files, all passed (1,793 lines of tests vs 6,049 lines of `src`).

| File (tests) | What it proves | What it does **not** prove |
|---|---|---|
| `api-key-auth.test.ts` (18) | Production refuses to boot without real admin keys; merchant-key parsing; `merchantAccessError`; plugin end to end with a registered merchant key | Authorisation on `/payouts` (F-50); `/health*` prefix handling; spoofable rate-limit key |
| `assets.test.ts` (17) | Integer asset math for any decimals, rounding direction, registry reads decimals from the chain, wrong-contract and wrong-network refusal, pinned decimals mismatch, USDC carries on unverified with RPC down, `quoteFor` stale/future refusal | Behaviour with real tokens (fee-on-transfer, rebasing, blacklists, upgrades) |
| `keystore.test.ts` (14) | Seal/open, address binding, tamper detection, legacy blobs open, DEK reuse and rotation, provider mismatch refused, production env guard, Vault wrapping against a local HTTP stand-in for the transit API (`keystore.test.ts:104-125`), KMS against a fake | Real Vault or KMS (a real Vault is used only by the e2e script with `E2E_KEY_WRAP=vault`); Vault policy scoping; memory handling |
| `payouts.test.ts` (13) | Request validation, absolute ceiling, approval threshold, refusing broadcaster in production, simulated hash outside production, seam | The idempotency index, `submitPayout` claim/failure paths and approval routes **against a database** (none) |
| `payout-signer.test.ts` (15) | Off by default, fail-closed configuration, key never in errors, refusals at broadcast time (wrong chain, ceiling) | The 24 h cap against a ledger, the registry re-check, the transfer itself |
| `sweeper.test.ts` (9) | Gas-drip arithmetic; configuration fails closed; key not in errors | The **state machine** (`advance`), recovery rules (F-53), dust return, resumption after a crash: only the e2e script covers these |
| `treasury.test.ts` (18) | Pure replenishment/cold-sweep planning, dust arithmetic, valuation, configuration fails closed | The manager's `send`/`reconcile` against a database; caps across passes |
| `deposits.test.ts` (8), `config.test.ts` (4), `boot.test.ts` (3) | Route validation; CORS config guard; the whole app assembles and rejects an unauthenticated request | |
| `tests/shielded.test.ts` (16) | Shielded routes (stub verifier) | Out of this package's scope; flagged because the stub returns true |

**No unit test imports `lib/settlement.ts`** (`grep -l "settleChainOnce\|scanExpiredOnce\|startSettlement"` over
`__tests__`, `tests`, `scripts` finds nothing). The settlement logic that decides when a payment is "paid" (finality,
cursor, late units, reorg handling, expiry) is covered only by `multi-asset-e2e.cjs`, which was not run for this package.
Likewise there is no unit test for the fee/dust/cold paths of `treasury.ts` that touch the chain or the DB.

**What the e2e script shows (when run):** the e2e assertions listed in 1.3 include partial / late / wrong-token /
over-payment cases, restart recovery, payout reconciliation by hash, sweep crash recovery, gas ceiling deferral, dust
return, stray-token recovery, treasury top-up and cap behaviour, and asset verification failures. It does **not** test:
merchant-scoped authorisation, production auth guards (it runs in development mode), Vault policy scoping,
multi-replica behaviour, real reorgs (ganache `evm_mine` only), or an adversarial database.

---

## 5. Component D - credit bureau billing and payouts

The whole bureau suite (23 files) passes. The ones relevant here:

| File (tests) | What it proves | Does **not** prove |
|---|---|---|
| `billing.test.ts` (21) | Ledger credit/debit, entitlement-aware charging, top-up request/confirm basics | **Concurrent confirms** (F-70: reproduced by experiment, not covered by a test) |
| `furnisher-payouts.test.ts` (25) | Period closure, owed lines, idempotent re-run, asset mismatch handling | A hostile gateway or pre-existing payout with a different payee/amount (F-51) |
| `multi-asset.test.ts` (14) | USDC/ZARP/OUSD top-up and payout flows against a mocked gateway | Real gateway |
| `auth.test.ts` (18), `config-guards.test.ts` (14) | Deny-by-default scope table; admin key production guards; CORS guard | Rate-limit key spoofing |
| `settlement.test.ts` (9) | Agent settlement (not furnisher payout) | n/a |
| `persistence.test.ts`, `store-persist-retry.test.ts` | Write-behind retry and failure counting | Ordering of concurrent upserts (F-71) |

---

## 6. Experiments run by the authors that are not committed

These produced the evidence labelled "verified by experiment" in 03 and 04. They live only in a scratch directory; to
reproduce, add an equivalent test.

| Finding | Experiment | Result |
|---|---|---|
| F-03 | In the Go harness, plant a sealed epoch-0 share on node 1 with `saveKey`, then POST a coordinator-signed `/v1/reshare/retire` with `{keyId, epoch: 999, leaving: true}` | HTTP 200; the share file no longer exists |
| F-04 | `Policy{DailyLimitWei: 1000}`: `Reserve("S1", key, 900)`, `Reserve("S1", key, 0)`, `Release("S1")`, then `Used(key)` | 900 before, 0 after |
| F-05 | `ethtx.Build` with `Value: "-5000"`; `Policy.Reserve` with the daily limit 1 000 | Transaction builds, `signer.Hash` returns a hash, `MarshalBinary` fails with "cannot encode negative big.Int"; the negative reservation lets a later 5 900 reservation succeed |
| F-70 | vitest with `fetch` stubbed to answer `{valid:true}` after 20 ms, a $10 pending receipt, three concurrent `confirmTopUp` calls | All three report `alreadyConfirmed: false`; balance 3000 cents |

## 7. Summary of what the test suite can and cannot support

- It supports claims about **pure logic** (policy rules, asset math, seal/open, planning, config guards).
- It supports the claim that the threshold protocol works and produces Ethereum-valid signatures **on one machine** (long
  tests, not run by the authors for this package).
- It does **not** support claims about: real network separation, real Vault/KMS, chain reorgs, multiple replicas,
  hostile databases, merchant-scoped authorisation of money-moving routes, the console, or the governance quorum.
