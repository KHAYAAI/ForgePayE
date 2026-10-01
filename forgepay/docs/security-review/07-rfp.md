# Request for Proposal: independent security review of the FORGE custody and stablecoin payment components

> **Status of this document.** A draft, ready to be completed and sent. Items in `[square brackets]` are for the
> company to fill in. Effort and duration figures are **estimates prepared by the authors, not quotes**; each bidder must
> give its own figures. The company must verify each vendor's current availability, qualifications and references itself;
> nothing here is an endorsement of any firm.

| | |
|---|---|
| Issuer | `[Company legal name]`, `[address]` |
| Contact for this RFP | `[name, email]` (all questions in writing to this address) |
| RFP reference | `[reference]` |
| Issue date | `[date]` |
| Questions due | `[date]` |
| Proposals due | `[date, time, timezone]` |
| Confidentiality | Mutual NDA required before the technical package is released (section 11) |

---

## 1. Background

FORGE is a payments, custody and credit platform. This RFP concerns four components that hold or move value:

1. **Threshold-ECDSA custody** - a Go service (`mpc-signer`, a coordinator) and `mpc-node` processes that generate and use
   per-workspace secp256k1 keys by distributed key generation, built on `bnb-chain/tss-lib` v2. Keys can be reshared to
   new committees and thresholds without changing the address. Nodes apply their own signing policy, use mTLS and
   authenticated peer-to-peer messages, and seal key shares with a key held in HashiCorp Vault or AWS KMS.
2. **Custody governance and console** - a NestJS API gateway (signer quorum proposals and votes, cooling-off, transaction
   queueing, nonce allocation, broadcast and confirmation tracking, key backfill and rotation) and a Next.js console
   (RBAC, team invitations, session management, MFA, SSO) that fronts it.
3. **Stablecoin gateway** - a Fastify service that opens one-time deposit addresses and holds their keys (envelope-encrypted
   under Vault or KMS), settles incoming ERC-20 payments, sweeps them to a treasury, sends payouts from a hot wallet, and
   manages a tiered treasury (operating, payout and cold wallets).
4. **Credit bureau billing and payout paths** - prepaid-balance top-ups through the gateway and furnisher revenue-share
   payouts.

Not in scope: the Mode 2 on-chain smart contracts (`forgepay/on-chain/`), which need their own smart-contract audit (an
optional separate lot is described in section 3.3).

The company has prepared a package for reviewers (`forgepay/docs/security-review/`), including a system overview,
asset inventory, threat model, a candid list of known defects and limitations, test evidence, specific questions for
reviewers, a dependency inventory and a readiness checklist. It will be released under NDA. **The package lists known
unfixed vulnerabilities**; see section 11.

## 2. Objectives

1. Establish whether the cryptographic design and its implementation can reasonably be trusted to protect customer funds:
   correctness of the use of tss-lib (key generation, signing, resharing), the transport and message-authentication layers,
   sealed storage of shares, the per-node policy engine and the operational model (trust domains, PKI, Vault/KMS).
2. Establish whether the governance and authorisation layers (signer quorum, API keys, console RBAC, sessions, SSO) can be
   bypassed, forged, or abused by an insider, an external attacker or a compromised internal component.
3. Establish whether the stablecoin gateway and the bureau's payment paths can lose, misdirect or double-count value
   (deposit custody, settlement, sweeping, payouts, treasury, FX).
4. Confirm, rate and, where possible, reproduce the issues already known to the company, and find those it does not know.
5. Give the company a prioritised, actionable remediation plan and verify the fixes.

## 3. Scope

### 3.1 In scope (lots 1 to 4)

Repository access is read-only at a tagged commit `[review tag]`. Paths are relative to the repository root. Line counts
are approximate, taken at commit `da11f54`, and exclude tests unless stated.

| Lot | Component | Paths | Language | Size (approx.) |
|---|---|---|---|---|
| 1 | Threshold custody | `forgepay/services/openfireblocks/services/mpc-signer/**` (`internal/mpc/{node,coordinator,cluster,wire,identity,seal,sealprovider,sealmigrate,sealedfiles,tls,policy,preflight,audit,preparams}.go`, `cmd/mpc-node`, `main.go`, `internal/ethtx`); deployment examples `forgepay/services/openfireblocks/deploy/**`; design doc `forgepay/services/openfireblocks/docs/threshold-signing.md` | Go 1.24 | 6,100 lines (+1,700 test lines) |
| 2 | Custody governance and console | `forgepay/services/openfireblocks/services/api-gateway/src/{custody,sign,blockchain,auth}/**` (+ `database`, `customers`, `policies`, `risk` as supporting code); `forgepay/apps/platform/app/api/**`, `forgepay/apps/platform/lib/{auth,rbac,invitations,openfireblocks,jwt-secret,mfa,sso,audit}.ts`, `middleware.ts` | TypeScript (NestJS, Next.js) | 2,900 + 2,200 lines |
| 3 | Stablecoin gateway | `forgepay/services/stablecoin-gateway/src/**` and migrations `004`-`006` (asset registry, FX, x402, settlement, payouts, payout signer and worker, sweeper, treasury, keystore, auth plugin). Shielded-payment code (`lib/proof-verifier.ts`, `shielded-*`, `routes/x402-shielded.ts`, about 900 lines) is a stub, disabled by default, and is **optional** in this lot | TypeScript (Fastify) | 5,200 lines (+900 shielded) |
| 3 | Credit bureau payment paths | `forgepay/services/agent-credit-bureau/src/{billing,furnisher-payouts,auth}.ts` and the billing, settlement and payout-destination routes in `src/index.ts` | TypeScript | 1,200 lines |
| 4 | Cloud, KMS, Vault, platform configuration | Example Vault/KMS policies, Helm charts and Terraform for the above services under `forgepay/infra/**` and `forgepay/services/openfireblocks/infrastructure/**`, container images, secret handling and logging | YAML, HCL, Dockerfile | `[to be sized from the tagged commit]` |

Cross-lot concerns the bidder should plan for: the trust boundary between the gateway and the signer, secret handling
across all services, and the deployment topology that makes the cryptographic design true (separate administrative
domains, PKI, Vault/KMS roles).

### 3.2 Out of scope

- All other services in the repository (about two dozen) and other applications, dashboards and SDKs in the monorepo.
- Third-party services as systems under test (WorkOS, RPC providers, Vault/KMS as products, Temporal). Their *use* by
  FORGE is in scope.
- Social engineering, physical security, denial-of-service testing of shared infrastructure, and any testing of
  production systems or real funds.
- The Mode 2 contracts `ForgeCore`, `ForgeBudgetEnforcer`, `ForgeReputationRegistry`, `ForgeCrossChainReputation`,
  `ForgeTransactionValidator` and scripts (`forgepay/on-chain/`).

### 3.3 Optional lot 5: smart contracts

About 900 lines of Solidity in five contracts plus Foundry tests and deploy scripts (`forgepay/on-chain/src`,
`script`, `test`). Please quote separately and do not let it influence the pricing of lots 1 to 4. A committed
testnet deployment record exists (`forgepay/on-chain/broadcast/**`).

## 4. Deliverables

1. **Kick-off**: a working session with the authors (architecture walk-through, threat model, known issues).
2. **Interim notification**: any finding you rate Critical or High is reported to the named contact within 24 hours of
   confirmation, in writing, before the final report.
3. **Written report** (PDF plus a machine-readable list, CSV or JSON), containing at minimum:
   - executive summary for non-technical readers;
   - scope, commit hashes, tools and methods, what was and was not tested, and time spent per lot;
   - for each finding: unique id, title, severity, affected files and lines, description, impact, attack scenario or
     proof of concept, remediation advice, and whether it matches an item in the company's known-issue list
     (`04-known-limitations.md`, ids `F-nn`) or is new;
   - the same for observations and hardening advice that are not vulnerabilities;
   - a written cryptographic assessment of the use of tss-lib: version, applicable published attacks, and what the code
     around the library must do (lot 1);
   - answers, or reasoned partial answers, to the numbered questions in `06-questions-for-reviewers.md`;
   - an assessment of the claims in `docs/threshold-signing.md` and `SGW/README.md` against what the code does;
   - a prioritised remediation plan.
4. **Severity rating**: each finding rated Critical / High / Medium / Low / Informational with the bidder's stated
   criteria (likelihood x impact, with explicit weight on loss of funds, loss of key material, and loss of availability of
   keys). If CVSS is used, give the vector and also give the plain-language rating; CVSS alone is not acceptable for
   custody findings.
5. **Draft report** `[10]` business days after the end of fieldwork, **final report** `[5]` business days after the
   company's comments.
6. **Retest**: verification of fixes for every finding of Medium or above, within a fixed fixing window (section 12),
   with a short re-test report stating each finding as fixed, partially fixed or not fixed. The price must include one
   retest round; state the price of an extra round.
7. **Read-out**: a session for engineers and one for management/board.
8. **Attestation letter** (optional but requested): a short statement of scope and conclusion suitable for sharing with
   banking partners, regulators or insurers, issued only after retest, whose wording the vendor controls.

## 5. Required expertise

State, for each named reviewer, the relevant experience and the reviewer's role. We expect the team as a whole to cover:

| Area | What we need |
|---|---|
| **Applied cryptography, including threshold ECDSA / MPC** | Prior review or implementation of GG18/GG20/CGGMP-family protocols, tss-lib or comparable libraries, Paillier-based MtA, VSS, resharing and key refresh; knowledge of published attacks on MPC wallets; ability to read Go |
| **Go security** | Memory and concurrency issues, crash consistency, TLS/PKI code, parser safety |
| **Ethereum / EVM key management and custody systems** | Transaction construction (EIP-155, EIP-1559), nonce and fee handling, hot/warm/cold wallet design, ERC-20 edge cases, reorg and finality handling, custody operations and governance models |
| **Web application and API security** | Node.js (NestJS, Next.js, Fastify), authentication and session design, RBAC/IDOR, SSO/OIDC, MFA, SQL, secrets in logs and responses, dependency risk |
| **Cloud, KMS and infrastructure** | AWS KMS and IAM, HashiCorp Vault (transit, AppRole, policies), Kubernetes network policy and secret handling, Terraform/Helm review |

Reviewers named in the proposal must be the people who do the work. Tell us about subcontractors.

## 6. Engagement model and effort (ESTIMATES)

**Please state your own effort, duration and price. The ranges below are the authors' guess from line counts and the
nature of the code, to help bidders and the company compare proposals; they are not a budget and must be confirmed
or corrected by each vendor.**

| Lot | Authors' estimate of effort |
|---|---|
| 1 Threshold custody (cryptographer + Go engineer) | 4 - 6 person-weeks |
| 2 Governance, gateway and console | 2 - 3 person-weeks |
| 3 Stablecoin gateway + bureau payment paths | 2 - 4 person-weeks |
| 4 Cloud / KMS / Vault / platform configuration | 1 - 2 person-weeks |
| Retest (all lots) | 1 - 2 person-weeks |
| **Total, lots 1 to 4** | **about 10 - 17 person-weeks, two to four reviewers working in parallel over roughly 5 - 8 calendar weeks** |
| Optional lot 5 (contracts) | `[bidder to estimate]` |

Preferred commercial structure: fixed price per lot against the scope above, with a stated cap and rate card for
additional work. A time-and-materials structure with a capped total is acceptable. State what is excluded, how scope
changes are handled, and payment milestones. Lots may be bid separately or jointly; joint bids by two specialist firms
are welcome if one is accountable for the whole.

## 7. Timeline (to be completed)

| Milestone | Date |
|---|---|
| RFP issued | `[date]` |
| Questions due / answers circulated | `[date]` / `[date]` |
| Proposals due | `[date]` |
| Shortlist calls | `[date range]` |
| Selection and contracting (NDA, MSA/SoW) | `[date]` |
| Kick-off | `[date]` (not before the readiness checklist `08-readiness-checklist.md` is green) |
| Fieldwork | `[start]` to `[end]` (expected 4 - 6 weeks) |
| Draft report / final report | end + `[10]` business days / + `[5]` business days after comments |
| Fix window | `[4]` weeks from final report (Critical and High first) |
| Retest | `[start]` to `[end]` (about 1 - 2 weeks) |

## 8. Access the reviewers will be given

- **Source**: read access to the private repository at the tagged review commit, or a signed archive of it. Only the
  paths in section 3 are needed; the rest of the monorepo is available on request.
- **The reviewer package** (`forgepay/docs/security-review/`), including the known-issue list.
- **A seeded staging environment** `[to be prepared by the company, see readiness checklist]`: a three-node cluster
  (2-of-3) on separate hosts or accounts with mTLS and Vault/KMS-wrapped seal keys, a disposable second cluster that
  may be damaged, the api-gateway and console with seeded workspaces, signers and test users in each role, the stablecoin
  gateway and bureau against a public test network (for example Base Sepolia/Sepolia) with test tokens, Postgres with
  seed data, and Vault and a KMS key in a non-production account. No real funds, real customers or production secrets.
- **Tests and scripts**: the unit tests, the long integration tests (`go test` without `-short`), and the e2e script
  `forgepay/services/stablecoin-gateway/scripts/multi-asset-e2e.cjs` (needs Postgres and a local chain), plus the dev
  cluster script `forgepay/services/openfireblocks/scripts/mpc-dev-cluster.sh`. Exact commands are in `05-test-evidence.md`.
- **People**: a named engineer per component for questions, with a target response time of `[1]` business day, and a
  single point of contact for escalation.

## 9. Rules of engagement

1. Test only the staging environment and the supplied cluster. No production systems, no real customer data, no real funds.
2. Destructive testing of key shares, nodes and databases is allowed only on the disposable cluster designated for it.
3. No denial-of-service testing that affects shared infrastructure or third-party services (RPC providers, WorkOS, Vault
   or KMS as a service). Rate-limit and resource-exhaustion testing is allowed within limits agreed at kick-off.
4. No social engineering, phishing or physical testing of the company's staff, unless separately agreed in writing.
5. Report secrets, credentials or personal data you find immediately and do not copy them beyond what is needed.
6. Record testing windows and source IP addresses and share them before each active-testing session.
7. Do not disclose vulnerabilities to any third party. The company will provide a written safe-harbour statement
   authorising the agreed testing.
8. Stop and notify the contact if you cause an unexpected effect outside the test environment.

## 10. Proposal contents

Proposals must be in `[format]`, at most `[25]` pages excluding annexes, and cover:

1. Understanding of the scope and your approach per lot: what you will read, test and attempt, and how you will approach
   threshold-ECDSA review specifically.
2. Team: names, roles, CVs, relevant published work (reports, papers, advisories, talks) and availability for the
   proposed window.
3. At least two **redacted sample reports** of comparable engagements, and two references the company may contact.
4. Effort per lot in person-days, duration, fees, expenses and rate card; assumptions; what is excluded.
5. Tooling and methods (including fuzzing, symbolic or model-based tools, if any), and whether any code or findings will
   leave your secure environment.
6. Retest policy and price, report timelines, and the format of the machine-readable findings.
7. Conflict-of-interest disclosure: relationships with the authors of tss-lib or with any vendor in the custody or MPC
   market that could affect independence, and any prior work on FORGE.
8. Insurance (professional indemnity, cyber), data-handling and secure-storage practices, subcontractors.
9. Proposed contract terms, including limitation of liability, intellectual property of the report, and publication.

## 11. Confidentiality

- A mutual NDA is required before release of the package or repository access. The package contains **known unfixed
  vulnerabilities** and the design of key-custody controls; it is for the named reviewers only.
- Reviewers store materials only in encrypted storage under their control and delete them within `[30]` days of the final
  retest, confirming in writing. Reports remain the company's property; the vendor keeps the right to reference the
  engagement only with written consent.
- Findings are confidential until the company has had the fix window; if the company later wants to publish a summary
  it will agree the wording with the vendor. Vulnerabilities in third-party software (including tss-lib) will be disclosed
  responsibly by agreement with the company.

## 12. How findings will be tracked and fixed

- One tracker `[private issue tracker / vendor portal]`, one item per finding, using the vendor's ids mapped to the
  company's `F-nn` where relevant.
- The company will triage within `[3]` business days. Target fix times (counted from the final report, or from the interim
  notice for Critical/High): Critical `[7]` days, High `[30]` days, Medium `[60]` days; Low and Informational at the
  company's discretion with a written decision.
- Fixes are delivered as tagged commits; the vendor retests each finding Medium and above and reports status as fixed,
  partially fixed or not fixed, with evidence. Residual risk the company chooses to accept is recorded with an owner and
  a date.
- The company may ask for clarification calls on any finding at no extra charge.

## 13. Evaluation criteria

Proposals are scored out of 100 by a panel of `[engineering, security and management representatives]`.

| Criterion | Weight |
|---|---|
| Depth of threshold-ECDSA / MPC and applied-cryptography expertise, shown by named people and published work | 25 |
| Experience with EVM key management and custody systems (hot/warm/cold wallets, nonce/fee/finality handling, governance) | 20 |
| Web/API/authentication security and cloud/KMS/Vault expertise | 15 |
| Quality of method and of the sample reports; clarity of severity rating and remediation advice | 15 |
| Team availability, independence (conflict-of-interest disclosure) and communication | 10 |
| Retest, reporting timelines and contract terms | 5 |
| Price and value for money | 10 |

Mandatory: the named lead cryptographer has reviewed at least one threshold-signature or MPC wallet implementation
that handled real value; no undisclosed conflict of interest; willingness to sign the NDA and safe-harbour terms.
The company may interview shortlisted teams and may ask for a paid scoping call. This RFP is not an offer, creates no
obligation to award, and the company may reject any or all proposals.

## 14. Where to look for bidders (not an endorsement)

The company must verify current availability, relevant references and independence for any firm itself. Categories and
examples of well-known firms in each, listed for orientation only and in no order:

| Category | Examples of firms known in that area |
|---|---|
| Applied-cryptography and MPC specialists | Trail of Bits, NCC Group (cryptography services), Kudelski Security, Least Authority, Cure53, Verichains (published research on MPC wallet attacks) |
| Blockchain and custody security auditors | Trail of Bits, OpenZeppelin, Spearbit / Cantina, Zellic, ChainSecurity, Halborn, Quantstamp, Sigma Prime |
| Web, API and application security / penetration testing | NCC Group, Bishop Fox, Doyensec, Include Security, Cure53, Cobalt (a pentest marketplace) |
| Cloud, KMS and infrastructure assessors | NCC Group, Bishop Fox, Trail of Bits, the security consultancies of the major cloud providers' partner networks |
| Independent researchers and academics | Researchers who have published on threshold ECDSA attacks and implementations may be engaged individually; check publications and conflicts |

Suggested approach: invite 3 - 5 firms, with at least two that have published MPC/threshold-signature work, and consider
splitting lot 1 (cryptography) from lots 2 - 4 if no single firm covers all expertise areas to the required depth.
Check each firm's recent public reports, their disclosed conflicts and whether the named reviewers are still employed
there.

## 15. Submission

Send proposals to `[email]` by `[date, time, timezone]`. Late proposals may not be considered. Questions that the company
answers will be shared, without identifying the asker, with all invited bidders.
