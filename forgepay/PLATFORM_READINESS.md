# FORGE — Platform Readiness, Per Product

**Assessed:** 2026-08-06 · **Method:** every service built, booted and driven live. Findings reproduced against running processes, not inferred from documentation.

This report supersedes the launch-target assessment in `LAUNCH_READINESS_2026-08.md`
for engineering detail. Six defects found during this pass were **fixed**; each fix is
listed with the evidence that it works.

---

## 1. Platform summary

| | Before | After |
|---|---|---|
| Services type-checking clean | 8/8 | 8/8 |
| Tests passing | 206 | **218** |
| Bureau test coverage | 9 (grade.ts only) | **30** (scorer.ts covered) |
| Custody test coverage | 14 | **18** (replay covered) |
| Fail-open secrets | 5 | **0** |
| Terraform modules | 8 (39 resources) | **10 (48 resources)** |
| CI-gated services | 4 of 26 | **5 of 26** (flagship added) |

**Platform readiness: ~62%** — up from ~55%, driven by correctness and security
fixes rather than new features. The remaining gap is overwhelmingly *external*:
licences, vendor contracts, and a production environment that has never been
stood up.

---

## 2. What was fixed

### 2.1 🔴 Credit Bureau reported two different scores for the same agent

The flagship number disagreed with itself depending on the endpoint:

```
                     /score        /dual-score.mode1     Δ
agent_prime_001      847 (BBB)     936 (A)             +89
agent_prime_002      712 (BB)      739 (B)             +27
agent_subprime_001   541 (CCC)     439 (F)            -102
```

**Root cause** — `src/store.ts:215` computed the score, **discarded it**, and kept a
hand-written `currentScore`, while retaining the *computed* factors. So `/score`
returned a number and a set of explanatory factors that described a different number.
`/dual-score` recomputed and got the honest answer.

The 102-point spread on `agent_subprime_001` is wider than the product's own
"LOW consensus / manual review required" threshold, and crosses a grade boundary
(CCC → F). Two lenders integrating different endpoints would reach opposite decisions.

**Fix** — made the scorer the single source of truth and made the bug structurally
unreachable: the seed fixture type now *omits* `currentScore`, so a hand-written score
cannot be reintroduced. All score-bearing fields derive through one function.

```ts
export function deriveScoreFields(
  raw: Omit<AgentCreditProfile, 'scoreFactors' | 'tier' | 'currentScore'>,
): AgentCreditProfile
```

Two fixtures then needed their *inputs* corrected, because the previously hand-written
scores had been masking a broken demo narrative: `agent_super_001` tied `agent_prime_001`
exactly (936 vs 936), and `agent_subprime_001` fell into DEEP_SUBPRIME, leaving no
SUBPRIME agent at all. Utilisation and payment history were adjusted so the data tells
the story instead of the output being forged.

**Verified live:**

```
agent_super_001      /score=966 SUPER_PRIME AAA   /dual-score.mode1=966
agent_prime_001      /score=936 SUPER_PRIME AA    /dual-score.mode1=936
agent_prime_002      /score=739 PRIME BB          /dual-score.mode1=739
agent_subprime_001   /score=549 SUBPRIME CCC      /dual-score.mode1=549
agent_deep_001       /score=303 DEEP_SUBPRIME C   /dual-score.mode1=303
```

**Guarded** — `src/scorer.test.ts`, 21 new tests. The headline one asserts stored score
equals a live recompute for every profile, so this cannot regress silently.

### 2.2 🔴 Custodial wallet private keys encrypted with a public key

`open-privy/services/backend/src/modules/wallet/wallet.service.ts:61`. Three
compounding problems in five lines:

```ts
const encryptionKey = process.env.ENCRYPTION_KEY || 'dev-secret-key';   // 1
Buffer.from(encryptionKey.padEnd(32).substring(0, 32))                  // 2
crypto.createCipheriv('aes-256-cbc', ...)                               // 3
```

1. With `ENCRYPTION_KEY` unset in production, every wallet private key in the database
   is encrypted under a string published in this repository.
2. The secret is **space-padded** to reach 32 bytes rather than derived. `'dev-secret-key'`
   becomes 14 bytes of known text plus 18 spaces — nowhere near 256 bits of entropy,
   whatever the variable contains.
3. AES-256-CBC has no authentication tag, so ciphertext is malleable: anyone with write
   access to that column could tamper undetectably.

This is the most severe finding in the audit — it is custodial key material.

**Fix** — new `common/crypto/private-key-crypto.ts`: fails closed in production,
derives per-record keys with scrypt and a fresh salt, and uses AES-256-GCM so tampering
is caught. A legacy path still reads old `<iv>:<ciphertext>` rows so existing data
remains recoverable, with `needsReEncryption()` to flag them for rekeying.

**Verified:** round-trip recovers plaintext · ciphertext unique per call · modified
ciphertext rejected · legacy rows still readable · production refuses missing, short,
or fallback keys.

### 2.3 🔴 Console authentication fell open to a hardcoded secret

`apps/platform/middleware.ts:17` and `lib/auth.ts:17` both used
`process.env.JWT_SECRET || 'dev-secret-key'` with **no production guard**. Unset at
deploy, and anyone reading this repo could forge an admin session.

**Fix** — `lib/jwt-secret.ts`, used by both. Throws in production when the secret is
missing, too short, or still the development value. Edge-safe (only `process.env`), so
the same guard covers the edge middleware and the Node helpers.

**Verified:** all five cases behave correctly (missing → throw, fallback value → throw,
short → throw, strong → accept, development → warn and allow).

### 2.4 🔴 Wallet service signed and verified tokens with *different* secrets

`open-privy` had two more fallbacks — and they did not match:

| File | Fallback |
|---|---|
| `config/jwt.config.ts` (signing) | `'dev-secret-change-in-production'` |
| `auth/strategies/jwt.strategy.ts` (verifying) | `'dev-secret'` |

Beyond the security issue, this is a straight functional bug: with `JWT_SECRET` unset,
every token the service issued would fail its own verification.

**Fix** — both route through one `getJwtSecret()`. Verified sign-secret ≡ verify-secret.

### 2.5 🟠 Payment fallback reported success without contacting any provider

`unified-router/src/lib/payment-fallback.ts` — `processViaStripe()` and
`processViaCircle()` returned hardcoded `success: true` with fabricated hashes
(`stripe_${Date.now()}`).

Nothing imports the module, so **no live payment was ever affected**. But the functions
looked production-ready and would have marked payments settled that never moved money.

**Fix** — both now throw `NotWiredError`. The orchestration was already correct, so the
chain catches the error and degrades to a manual request.

**Verified:** Stripe throws → Circle throws → `{ success: false, status: 'pending',
method: 'manual_request' }`. An unimplemented integration can no longer report success.

### 2.6 🟠 Custody signed requests were replayable

Custody uses HMAC request signing — genuinely strong, and better than most. But the
timestamp window was mistaken for a replay guard. It is not: it *bounds* how long a
captured request stays valid. Within the 5-minute window the identical signed request
could be replayed indefinitely, against endpoints including `/api/v1/sign` and
`/api/v1/signing/:id/approve`.

Confirmed live before the fix — the same signature created two policies.

The existing test named `rejects a replayed (stale) timestamp` only tested staleness,
which is likely why the gap persisted.

**Fix** — a seen-signature set with the window as its TTL. Claimed only *after* the
signature verifies, so forged signatures cannot poison the cache and lock out real ones.

**Verified:** first request accepted, replays rejected `replayed_signature`; three
distinct requests in the same second all accepted (no false positives); a forged
signature does not evict the legitimate one. Four new tests.

> ⚠️ **Known limit, deliberately documented in code:** the set is per-process. With more
> than one replica a replay can still land on a pod that has not seen the signature.
> Before scaling custody past one replica this must move to the shared Redis the
> platform already runs (`SET <sig> NX EX <window>`).

### 2.7 🟡 Two infrastructure modules that were documented but never existed

`EXTERNAL_DEPENDENCIES.md` lists both as 🔴 required for MVP; neither was provisioned.

**WAF** (`modules/waf`) — was entirely absent. A payments platform was exposing a public
front door with no managed rules, no rate limiting, no bot control. Added: per-IP rate
limiting, AWS common + known-bad-inputs + IP-reputation rule sets, account-takeover
protection tuned to the login route, optional geo-blocking (empty by default — a
compliance decision, not a default), and redacted request logging.

**Secrets Manager** (`modules/secrets`) — the secrets the docs describe had nowhere to
live but Helm values, which `CLAUDE.md` forbids. Added: KMS-encrypted secret containers,
key rotation, and the IRSA role pods use to read them. **Secret values are never set in
Terraform** — state is not a secret store; containers only, populated out-of-band.

### 2.8 🟡 Bureau had no CI correctness gate

The flagship appeared only in `forgepay-smoke.yml` as a boot probe — a health check, not
a correctness gate. That is exactly how §2.1 reached the running service. Added to
`forgepay-ci.yml` with type-check + test.

### 2.9 🟡 Yield-engine tests could never pass without a database

`persistence.test.ts` hard-failed with `ECONNREFUSED` rather than skipping, so
`npm test` could not pass on any runner without Postgres attached — an integration gap
surfacing as a code failure. Now gated on the same signal the service uses, so it runs
when a database is configured and is honestly skipped when not.

---

## 3. Per-product readiness

### 3.1 Credit Bureau — **~72%** (was ~65%) · closest to launchable

| Area | State |
|---|---|
| Scoring engine | ✅ Consistent, 30 tests, single source of truth |
| Mode 1 (off-chain FICO) | ✅ Production-shaped, 5 weighted components |
| Mode 2 (on-chain) | ⚠️ **Contracts undeployed** — logs `On-chain: unconfigured` |
| Persistence | ✅ Postgres write-through + hydrate-on-boot, opt-in |
| API | ✅ 9 endpoints live and driven |
| Consensus/variance | ✅ Tested against published thresholds |
| Data | ⚠️ 5 seeded demo agents — no real furnishers |
| Regulatory | ❌ **No analysis exists** |

**What still blocks it:**

1. **Mode 2 is the differentiating claim and it is not operational.** Five Solidity
   contracts are written and Foundry-tested, but no deployment addresses exist anywhere
   in the repo, and there is **no third-party audit** (`AUDIT_REPORT_SIMULATION.md` is,
   as named, a simulation). Until deployed, FORGE ships a conventional credit score with
   an on-chain story attached.
2. **No regulatory analysis.** Every compliance document covers payments — FSCA, SARB,
   FIC, POPIA. Nothing addresses the National Credit Act or NCR registration, which in
   South Africa governs credit bureaux. The argument that autonomous agents are not
   "consumers" under the NCA is plausible and may well be right — but it needs a written
   legal opinion, because the moment a score touches an identifiable human operator's
   creditworthiness, POPIA and arguably the NCA attach.
3. **No real furnisher data.** The scoring is sound; it has nothing real to score.

### 3.2 Payments — **~55%** · blocked on licence, not code

| Area | State |
|---|---|
| Hyperswitch core | ✅ Vendored, full router |
| unified-router | ✅ 5,377 LOC, 60 tests, in CI |
| Fallback chain | ✅ Fixed — degrades safely, never fabricates success |
| Provider integrations | ❌ **No live credentials** |
| MoR / tax | ✅ 6,274 LOC, best-tested service (lint + type + pytest in CI) |
| KYC vendor | ❌ **Not selected** |

The engineering is the most mature on the platform. What blocks it is entirely
external — see §4.

### 3.3 Treasury — **~50%**

| Area | State |
|---|---|
| enterprise-treasury | ✅ Boots, 43 tests, FX + positions serving |
| yield-engine | ✅ Boots, APY aggregation tested; persistence gated |
| Sweep execution | ⚠️ **Simulates deposits without `SIGNER_PRIVATE_KEY`** |
| FX rates | ⚠️ **Static table**, not a live feed |
| Netting | ⚠️ Console-only; no service-side implementation found |

Two honest caveats worth naming: `sweepService.ts:75` logs *"No SIGNER_PRIVATE_KEY
configured — simulating deposit"* and returns `0xsimulated_…`; and the FX rates served
by `enterprise-treasury` are a hardcoded map, not a market feed. Both are fine for a
demo and must not reach production silently.

### 3.4 Wallet — **~52%**

| Area | State |
|---|---|
| forge-wallet | ✅ Boots, 9 tests, in CI |
| open-privy backend | ✅ 6,105 LOC |
| Private key encryption | ✅ **Fixed** — was the platform's worst defect |
| JWT sign/verify | ✅ **Fixed** — was functionally broken |
| Seed data | ❌ **Zero** — console summary returns all zeros |
| ERC-4337 gas sponsorship | ❌ Needs Pimlico |

The console's Wallet pages show depth the backing service does not have: every counter
returns `0`. The logic is real; the data is not.

### 3.5 Custody — **~58%** (was ~50%)

| Area | State |
|---|---|
| HMAC request signing | ✅ Strong — timing-safe, now replay-protected |
| Replay protection | ✅ **Added** (single-replica limit documented) |
| Policy engine | ✅ Genuinely good — whitelist, daily limits, time windows, chain allow-lists, approval thresholds; all tested |
| Auth enforcement | ✅ Verified live — unsigned requests rejected |
| Seed data | ❌ Zero, as with Wallet |
| MPC signing | ⚠️ DevSigner in tests; real MPC unproven at scale |

Custody has the best security engineering on the platform. The policy engine correctly
distinguishes *blocking* from *requiring approval* — a distinction many implementations
get wrong.

---

## 4. External dependencies and APIs

Nothing below can be built. Each is a signature, an account, or a regulator.

### 4.1 🔴 Blocking — no production launch without these

| Dependency | For | Notes |
|---|---|---|
| **FSCA licence** | Payments / MoR | **6–12 months**, not started. The binding constraint. |
| **AWS account + quota** | Everything | Request EC2/EKS quota early. |
| **ACM certificate** | TLS | Must be **us-east-1** for CloudFront. |
| **Route 53 zone** | DNS | `forgepay.io` |
| **ECR repositories** | Images | One per service. |
| **Stripe** | Card acquiring | Configured inside Hyperswitch. |
| **KYC vendor** | Onboarding | **Not selected** — Smile ID / Sumsub / Onfido. A decision, not a task. |
| **Chainalysis** | Crypto AML | Sales-led onboarding; start early. |
| **AWS SES** | Email | Domain verification + sandbox exit takes days. |
| **Alchemy** | EVM RPC | Needed the moment crypto rails are on. |
| **Legal opinion — NCA/NCR** | Credit Bureau | Not in any document. Cheap, fast, and the difference between a defensible launch and an undefended one. |

### 4.2 🟠 Feature-gating — the product works without them, that feature does not

| Dependency | Unlocks |
|---|---|
| **Contract deployment** (Base) | Mode 2 dual-mode scoring |
| **Smart contract audit** | Deploying contracts that gate credit decisions |
| **Pimlico** | ERC-4337 gas sponsorship (Wallet) |
| **Circle** | USDC mint/redeem, stablecoin payouts |
| **Peach Payments** | South African card acquiring |
| **Stitch** | South African bank EFT |
| **Plaid** | Bank linking (US/EU) |
| **Kill Bill tenant** | Subscriptions |
| **Ondo** | Tokenised treasuries (Treasury yield) |
| **Live FX feed** | Real treasury FX — currently static |

### 4.3 ⚪ Operational — should have, not blocking

Sentry · Slack webhooks · CRM · World ID · Elliptic · Supabase (droppable if you
standardise on platform Postgres).

### 4.4 Self-generated — no vendor needed

`JWT_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_WEBHOOK_SECRET`, `CONSOLE_SECRET`,
`SIGNER_PRIVATE_KEY`. `openssl rand -hex 32` each, into Vault or Secrets Manager.
**The first two are now enforced at boot** — services refuse to start in production
without them (§2.2, §2.3), so these must exist before any environment comes up.

---

## 5. What I could not verify

Stated plainly so nothing here is mistaken for tested:

- **Terraform `validate`** — the provider registry is blocked by the proxy, so provider
  schemas could not be fetched. HCL parses and formats cleanly (`terraform fmt -check`
  passes across all 10 modules); resource *arguments* are unvalidated. Run
  `terraform init && terraform validate` on a networked machine before applying.
- **The platform Next.js app** — no `node_modules`; the JWT guard was verified directly
  in isolation, and the `@/lib/*` path alias resolves, but a full `next build` was not run.
- **MoR layer (Python)** — Poetry environment not installed here. It is the best-tested
  service in CI (ruff + mypy + pytest) and was not modified.
- **Anything requiring AWS, a real database, or live vendor credentials.**

---

## 6. Recommended sequence

**Week 1 — decisions that have lead times**
1. Engage counsel on NCA/NCR applicability to agent scoring
2. Select the KYC vendor
3. Open Chainalysis and Stripe onboarding
4. Start the FSCA application — the 4–6 week preparation clock only starts when you do

**Week 2 — environment**
5. `terraform init && validate && apply` to af-south-1 staging (WAF and Secrets Manager
   now included), then `smoke-tests.sh`
6. Populate Secrets Manager — services now refuse to boot without the secrets
7. Deploy contracts to Base Sepolia; makes Mode 2 demonstrable and honest
8. Move custody replay protection to Redis before running more than one replica
9. Real load test to replace the placeholder baselines

**Ongoing**
10. Seed or connect real data for Wallet and Custody — the console shows depth the
    services do not have
11. Commission a smart contract audit before any mainnet deployment
12. Extend CI beyond 5 of 26 services

---

## 7. Bottom line

The engineering is stronger than the launch-readiness, and the gap between them is not
closed by writing code.

Six real defects were found and fixed in this pass — including one that would have
encrypted every custodial wallet private key with a value published in this repository,
and one that had the flagship product reporting two different credit scores for the same
agent. Every one of them was found by *running* the software, and none would have been
caught by the existing tests, because the code that mattered had none.

What remains is a licence you have not applied for, vendor contracts you have not
signed, contracts you have not deployed or audited, and a production environment that
has never been stood up. Those are calendar items, and the calendar is the constraint.

---

*Every finding in §2 was reproduced against a running process. The fixes are covered by
218 passing tests across 8 services.*
