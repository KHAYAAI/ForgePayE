# FORGE — Launch Readiness Assessment

**Assessed:** 2026-08-06 · **Target reviewed:** public launch 22 August 2026 (16 calendar days / ~11 working days)
**Method:** independent code audit — services built, booted and driven live; infra and CI read directly. Findings below are evidence-backed, not inferred from documentation.

> This assessment deliberately disagrees with `PRE_DEPLOY_AUDIT.md` and
> `DEPLOYMENT_READINESS_SUMMARY.txt` in places. Those documents are largely accurate
> about *code structure*. They understate three things this pass found by actually
> running the software: a scoring inconsistency in the flagship product, an
> authentication fail-open, and the fact that the operational go-live checklist has
> not been started.

---

## 1. Verdict

| Question | Answer |
|---|---|
| Can we deploy to AWS? | **Yes** — infrastructure is real and applyable. Staging in days, not weeks. |
| Can we run a **public launch** of the payments platform by 22 Aug? | **No.** Regulatory, not technical. FSCA licensing is 6–12 months and has not started. |
| Can we publicly launch the **Credit Bureau** by 22 Aug? | **Conditionally yes** — it is the one product not gated by a payments licence, but it has a correctness bug and an unresolved regulatory question. |
| Is the codebase in bad shape? | **No.** ~80k LOC of genuine implementation, 27 Helm charts, working IaC. The gap is *operational and regulatory*, not architectural. |

**Bottom line:** the engineering is far more mature than the launch-readiness. What blocks
22 August is licensing, live third-party credentials, and an untested production environment
— none of which can be compressed by writing more code.

---

## 2. What was actually verified

| Check | Result |
|---|---|
| `agent-credit-bureau` type-check | ✅ clean (`tsc --noEmit`, exit 0) |
| `agent-credit-bureau` tests | ✅ 9/9 pass — but only `grade.test.ts` exists |
| Service boots and serves | ✅ live on :3018, `/health` → 200 |
| Live scoring endpoints | ⚠️ **returns two different scores for the same agent** (§4.1) |
| Terraform module completeness | ✅ 39 resources across 8 modules, all wired in `main.tf` |
| Helm chart coverage | ✅ 27 charts |
| Smart contracts | ⚠️ written + Foundry-tested, **not deployed, not audited** |
| CI coverage | ⚠️ 4 of 26 services gated |
| Go-live checklist | ❌ **0 of 276 items checked** |
| Auth secret handling | ❌ **fails open to a hardcoded secret** (§4.2) |

---

## 3. Per-product readiness

Scored on *production* readiness — real data, real integrations, tested, operable.

| Product | Code | Tests | Integrations | Verdict |
|---|---|---|---|---|
| **Credit Bureau** | 3,077 LOC, clean build, boots | ⚠️ 9 tests, core scorer untested | Mode 2 needs undeployed contracts | **~65%** — closest to launchable |
| **Payments** | Hyperswitch core + unified-router (5,377 LOC) | 6 test files, in CI | Needs live Stripe/Peach creds | **~55%** — blocked on licence |
| **Treasury** | yield-engine 4,767 + enterprise-treasury 2,393 | thin | Simulates deposits without signer key | **~45%** |
| **Custody** | forge-custody 2,096 + openfireblocks | 1 test file, in CI | MPC signer unproven at scale | **~50%** |
| **Wallet** | forge-wallet 2,108 + open-privy 6,105 | 1 test file, in CI | Needs Pimlico for ERC-4337 | **~50%** |
| **MoR / Tax** | mor-layer 6,274 LOC, best-tested (7 files) | ✅ full lint+type+test in CI | Needs KYC vendor — **none selected** | **~55%** |
| **Compliance** | compliance-monitor 6,936 LOC | 2 test files | Needs Chainalysis contract | **~50%** |
| **Marketing site** | 20 components, builds in CI | n/a | none | **~90%** — genuinely shippable |

**Platform average: ~55%.** No product is at zero; none is at launch.

---

## 4. Critical findings

### 4.1 🔴 The Credit Bureau returns two different scores for the same agent

The flagship number is inconsistent depending on which endpoint you call.

```
agent_prime_001      /score = 847 (BBB)   /dual-score.mode1 = 936 (A)   Δ +89
agent_prime_002      /score = 712 (BB)    /dual-score.mode1 = 739 (B)   Δ +27
agent_subprime_001   /score = 541 (CCC)   /dual-score.mode1 = 439 (F)   Δ -102
```

Reproducible across three consecutive runs. **Root cause:**

- `GET /v1/agents/:id/score` returns the **stored** `profile.currentScore` (`src/index.ts:235`)
- `GET /v1/agents/:id/dual-score` **recomputes** via `computeScore(profile)` (`src/scorer.ts:391`)

The stored values do not match what the scorer produces from the same profile.

**Why this matters more than a normal bug:** the deltas cross grade boundaries. A lender
integrating `/score` and a lender integrating `/dual-score` get contradictory credit decisions
for the same agent. Worse, the consensus-variance logic (HIGH ≤50pts, MEDIUM ≤100pts) is
computed against the recomputed figure — so the product's own confidence signal is derived
from a number the primary endpoint never returns. On `agent_subprime_001` the two endpoints
disagree by 102 points, which is *itself* wider than the "LOW consensus / manual review
required" threshold the product publishes.

This is exactly the class of defect unit tests on `scorer.ts` would catch — and `scorer.ts`
(462 LOC, the core IP) has **no tests**. The only test file covers `grade.ts` (64 LOC).

**Fix:** decide which is authoritative, make both paths call it, add scorer tests. ~1 day.

### 4.2 🔴 Console authentication fails open to a hardcoded secret

```
apps/platform/middleware.ts:17   process.env.JWT_SECRET || 'dev-secret-key'
apps/platform/lib/auth.ts:17     process.env.JWT_SECRET || 'dev-secret-key'
```

There is **no production guard** — no startup assertion, no `NODE_ENV` check. If `JWT_SECRET`
is unset at deploy time, the console signs and verifies sessions with a secret that is public
in this repository. Anyone could forge an admin session token.

This directly contravenes the repo's own security rules in `CLAUDE.md`. **Fix:** throw on
missing secret outside development. ~1 hour. Do this before any environment is exposed.

### 4.3 🟠 Payment fallback reports success without moving money

`services/unified-router/src/lib/payment-fallback.ts` — `processViaStripe()` and
`processViaCircle()` return hardcoded `success: true` with fabricated transaction hashes
(`stripe_${Date.now()}`) and never call any provider.

**Currently unreachable** — `processPaymentWithFallback` is exported but imported nowhere,
so it is not faking live payments today. It is a landmine: the function looks
production-ready and would silently mark payments complete if wired. Delete it or gate it
behind an explicit `NODE_ENV !== 'production'` throw.

### 4.4 🟠 Mode 2 — the actual differentiator — is not operational

Five Solidity contracts are written and Foundry-tested, but **no deployment addresses exist
anywhere in the repo**, and the bureau logs `On-chain: unconfigured — Mode 1 only` on boot.

Dual-mode scoring is the product's core claim. Until contracts are deployed and their
addresses configured, FORGE ships a conventional credit score with an on-chain story
attached. There is also **no third-party smart contract audit** — `AUDIT_REPORT_SIMULATION.md`
is, as named, a simulation. Deploying unaudited contracts that gate credit decisions is a
material risk.

### 4.5 🟠 CI gates 4 of 26 services; the flagship is not one of them

`forgepay-ci.yml` runs lint/type-check/test for `unified-router`, `forge-custody`,
`forge-wallet`, `mor-layer` (+ web, dashboard, sdk-js). `agent-credit-bureau` appears only in
`forgepay-smoke.yml` as a boot probe — a health check, not a correctness gate. That is
consistent with §4.1 surviving.

### 4.6 🟡 Infrastructure hardening gaps

RDS is well-configured (encryption, multi-AZ, backup retention, deletion protection,
production-conditional final snapshot). But absent from Terraform entirely:

- **No WAF** (`aws_wafv2` appears nowhere) — a public payments front door without one
- **No Secrets Manager resources** — documented as required, not provisioned
- **KMS only for Vault unseal** — not for RDS/S3
- EKS has `endpoint_public_access = true` with no CIDR restriction visible

### 4.7 🟡 The go-live checklist has not been started

`GO_LIVE_CHECKLIST.md`: **276 unchecked, 0 checked.** The operational readiness work is
written down but not executed. Load-testing baselines remain placeholder data by the prior
audit's own admission — and that requires a real staging soak.

---

## 5. AWS: can we deploy?

**Yes — this is the healthiest part of the story.**

Working: 8 Terraform modules (VPC 14 resources, EKS 7, RDS 3, Redis, Vault+KMS, S3,
CloudFront, monitoring), all wired in `main.tf`; 27 Helm charts, previously verified against
a real Helm binary; `DEPLOY_AWS.md` runbook; `deploy.sh`; `smoke-tests.sh`.

Needed before apply: AWS account + EC2/EKS quota, ACM cert in **us-east-1** for CloudFront,
Route 53 zone, ECR repos, and the generated secrets in Vault.

**Realistic:** staging on af-south-1 in **3–5 working days**. Production-hardened
(WAF, Secrets Manager, soak test, mTLS) in **3–4 weeks**.

---

## 6. 22 August — what can and cannot happen

### ❌ Cannot: public launch of the payments platform

Not a technical judgement. Per your own `SOUTH_AFRICA_LICENSES.md`:

| Stage | Duration |
|---|---|
| Application preparation | 4–6 weeks |
| FSCA review & clarifications | 8–12 weeks |
| Final approval | 2–4 weeks |
| **Total** | **6–12 months** |

Operating as Merchant of Record — taking third-party funds — without an FSCA licence is not
a risk to manage, it is an offence. Your own roadmap places FSCA approval at **Month 4**.
There are 16 days. Additionally unresolved: no KYC vendor selected (Smile ID / Sumsub /
Onfido — still a decision), and no Chainalysis contract.

### ⚠️ Possible: Credit Bureau as a data product

The Credit Bureau is the one product **not gated by a payments licence** — it scores agents,
it doesn't hold funds. That makes it the only credible 22 August candidate.

But one thing must be resolved first, and it is not in the codebase:

> **There is zero regulatory analysis of the Credit Bureau anywhere in the repo.** Every
> compliance document covers the payments side — FSCA, SARB, FIC, POPIA. Nothing addresses
> the National Credit Act or National Credit Regulator registration, which in South Africa
> governs credit bureaux.

The plausible argument is that autonomous agents are not "consumers" under the NCA, so
registration doesn't attach. That argument may well be right — but it needs a written legal
opinion, not an assumption, because the moment a score touches an identifiable human
operator's creditworthiness, or you furnish data about one, POPIA and arguably the NCA are in
scope. **Get counsel on this in week 1.** It is cheap, fast, and it is the difference between
a defensible launch and an undefended one.

Also required: fix §4.1 (contradictory scores) and §4.2 (auth fail-open) — non-negotiable —
and be honest that Mode 2 is not live.

### ✅ Achievable and worth doing: a credible public moment

| Option | Feasible by 22 Aug | Notes |
|---|---|---|
| Marketing site + waitlist | ✅ Comfortably | Site is ~90% and builds clean |
| Developer preview — sandbox/testnet, no real funds | ✅ Yes | Needs §4.1 + §4.2 fixed |
| Credit Bureau public beta | ⚠️ Tight | Needs both fixes + legal opinion |
| Design-partner programme (3–5 named) | ✅ Yes | Best risk/reward |
| Public payments launch | ❌ No | Licence |

---

## 7. Recommended plan

**Reframe 22 August from "public launch" to "public unveiling + design-partner programme."**
You get the market moment, the credibility and the pipeline, without operating a regulated
business unlicensed. Nothing about this is a climb-down — a developer preview with real
architecture behind it is a stronger story than a payments launch you'd have to walk back.

**Week 1 (by 13 Aug) — correctness and legal**
1. Fix the score inconsistency; add tests to `scorer.ts` *(1 day)*
2. Remove the JWT dev-secret fallback; assert on boot *(1 hour)*
3. Delete or gate `payment-fallback.ts` *(1 hour)*
4. **Engage counsel on NCA/NCR applicability to agent scoring** *(start immediately)*
5. Add `agent-credit-bureau` to `forgepay-ci.yml` *(1 hour)*

**Week 2 (by 20 Aug) — environment**
6. `terraform apply` to af-south-1 staging; run `smoke-tests.sh`
7. Add WAF + Secrets Manager; restrict EKS public endpoint
8. Deploy contracts to **Base Sepolia** — makes Mode 2 demonstrable and honest
9. Real load test to replace placeholder baselines
10. Begin FSCA application preparation — the 4–6 week clock starts when you start it

**22 August — unveil**
Marketing site live · Credit Bureau developer preview on testnet · design-partner
applications open · the console tour videos as the product narrative.

**Then:** FSCA application in-flight, contract audit commissioned, KYC vendor selected,
production hardening. Payments go live when the licence does — realistically **Q1–Q2 2027**.

---

## 8. Summary

FORGE is a genuinely substantial platform: ~80k LOC of real implementation across 26
services, working infrastructure-as-code, and a differentiated product in the agent credit
bureau. The engineering is not the problem.

What stands between here and a public launch is a licence you haven't applied for, a
production environment you haven't stood up, third-party contracts you haven't signed, and —
in the flagship product — a scoring bug that would have shipped, because the code that
computes the score has no tests.

Sixteen days is enough to launch a **story**, a **sandbox** and a **partner programme**.
It is not enough to launch a **regulated payments business**, and no amount of engineering
changes that. Fix the two red findings, get the legal opinion, and take the unveiling — it's
a strong one.

---

*Findings §4.1–§4.3 were reproduced against the running service on 2026-08-06 and are
independently verifiable by booting `agent-credit-bureau` on :3018.*
