# What it takes to build everything out, tier by tier

**7 October 2026.** Companion to `LAUNCH_READINESS_BY_SERVICE_2026-10-07.md` (what is missing) and `launch/06` to `08` (decisions, partners).
This says what has to be done, who does it, roughly how long, and what outside parties are needed.

**About the numbers.** Effort figures are my own rough estimates in **engineer-weeks** (one person working for one week), assuming experienced
engineers who know this codebase, and they exclude waiting time. They are for planning, not commitments, and will move once the first real
deployment finds problems (it will). **Elapsed time is mostly other people's:** review firms, regulators, banks and licensing set the pace,
not the code. No prices are given because I cannot quote them; where money is needed I name the category so you can get quotes.

## The team this assumes

| Role | Why |
|---|---|
| Backend lead (Node and some Python/Go) | Owns the bureau, gateways and the money paths |
| DevOps / SRE | AWS, Terraform, Kubernetes, alerts, on-call design. Currently the biggest single gap |
| Security engineer | Fixes review findings, key handling, custody operations |
| Frontend engineer | Console, operator screens, bring-your-own-wallet flow |
| Compliance officer (named person) | Screening decisions, goAML filing, regulator contact. A legal requirement, not an engineering one |
| Product and partnerships | Microfinance institutions, banks, payments partner, review firms |
| **External:** counsel, review firms, bank, payments partner, insurer, auditor | None of these can be replaced by code |

One person can hold two roles in the first months, but **do not combine the compliance officer with engineering**, and **never let the same person both request and approve a payout.**

---

## Tier 1: bureau soft launch, then public launch

Goal: real design partners (microfinance institutions, lenders) using the Credit Bureau. Roughly **16 to 24 engineer-weeks** of build, in parallel with an elapsed time of **2 to 3 months** for public launch (soft launch in 2 to 4 weeks).

| # | Work package | Effort | Notes |
|---|---|---|---|
| 1 | **AWS staging then production**: apply Terraform, fix what breaks, secrets in Secrets Manager, domain, certificate, CI deploy credentials, deploy by image digest | 3 to 4 | The first apply has never happened. Two accounts (see `08`) |
| 2 | **Observability and on-call**: alert destinations, dashboards, a tested path from alert to a person, daily reconciliation owner | 1 to 2 | Needs a named on-call rota |
| 3 | **Compliance live**: OFAC, EU, UN and UK lists loading in production, the FIC address confirmed (or a daily refresh job), an operator screen for goAML export | 2 | Needs the compliance officer |
| 4 | **Money path on testnet then a $1 mainnet test**: Base Sepolia smoke tests twice, KMS check against the real account, reconciliation, failure rehearsals | 2 to 3 | Needs funded test wallets generated offline, an RPC provider |
| 5 | **Lender and furnisher experience for the microfinance institutions**: sandbox environment, per-institution keys and quotas, onboarding flow, API documentation, webhooks for report and dispute events | 3 to 4 | The core of the product for your customers |
| 6 | **Controller verification**: company-register (KYB) check on each agent's operating entity, wired into registration | 2 to 3 | Needs a KYB data provider or the national company register; choose one |
| 7 | **Mode 2 with real data**: an indexer for on-chain activity on Base so Mode 2 has something to score, with caching | 3 to 4 | Needs mainnet history to exist; thin for a new agent anyway |
| 8 | **Console**: per-workspace treasury data, email verification, shared rate limiting, operator screens, Next 16 for the postcss findings | 3 to 4 | Needs SMTP and mailboxes |
| 9 | **Resilience**: multi-replica tests of the bureau's write-through state, load test, a restore drill from a real backup | 1 to 2 | |
| 10 | **Website and docs**: live domain, the docs site behind `docs.myforgepay.com`, fix the two inaccurate claims | 1 to 2 | |
| 11 | **Independent review (scope A)** and fixing its findings | 2 to 3 of fixes | The review itself is the firm's 4 to 6 weeks, plus booking time |
| 12 | **Zero-knowledge threshold proofs** (the "coming soon" feature): real circuits and prover | 8 to 12 | **Optional.** Keep the website saying "coming soon". Needs its own cryptographic review |

**Outside parties:** counsel (National Credit Act bureau registration question, POPIA, FSCA/FIC position), review firm, the first design-partner institutions, an RPC provider, a KYB provider.
**Spend categories:** AWS, the review, legal, RPC, KYB data, domain and mail, insurance if you want it.
**Soft launch is reachable after packages 1, 2, 3, 4 and part of 5.** Public launch also needs 6 to 11, the review findings closed, and the regulatory answers.

## Tier 2: custody

Goal: a threshold-signing custody product for named pilot customers. About **10 to 16 engineer-weeks**, **4 to 6 months elapsed**.

| # | Work package | Effort | Notes |
|---|---|---|---|
| 1 | **Production topology**: nodes in separate AWS accounts and, ideally, separate providers, Vault or KMS sealing, mutual TLS everywhere, the topology check passing | 3 to 4 | Needs the third (backup) AWS account |
| 2 | **Key ceremony**: officers, hardware, a documented procedure, a restore drill done by the officers themselves | 2 | Needs 3 to 5 named people in different trust domains and purpose-bought hardware |
| 3 | **Soak, chaos and load tests** across hosts; failure of a node mid-signing; resharing under load | 2 to 3 | |
| 4 | **Operations**: incident response, key-holder procedures, support path, monitoring of signing latency and failures | 2 | |
| 5 | **Console custody**: only connected applications shown, officer screens polished, audit log export | 1 to 2 | |
| 6 | **Scope B independent review** and fixes, including the `tss-lib` version check | 3 to 4 of fixes | Firm: 4 to 6 weeks plus booking |
| 7 | **Pilot**: two or three design partners with small balances, weeks of clean reconciliation | 1 | Needs a customer agreement and limits |

**Outside parties:** a threshold-cryptography review firm (see `08`), counsel on whether holding keys for others is regulated, an insurer if available, hardware vendors.
**Do not start tier 2 pilots before the bureau has run cleanly**, and nothing in tier 3 that signs money should go live before custody has run across separate hosts.

## Wallet

| Phase | Work | Effort | Needs |
|---|---|---|---|
| **Now: bring your own wallet** | Connect a wallet, sign a message to bind it to an agent identity, no key ever sent to FORGE; remove the hosted wallet pages | 2 to 3 | Nothing external |
| **Later, non-custodial hosted**: keys on the user's device or a threshold scheme with a user-held share | 8 to 12 | A cryptographic review of the new scheme |
| **Later, custodial**: productionise `open-privy` (Dockerfile, chart, KMS key, legacy-wallet migration, mainnet limits, recovery tests) | 8 to 12 | Licence, counsel, review |

## Tier 3: payments, treasury, yield, assets (after licences or partners)

Each needs a decision or partner first (`08`). These run in sequence, not parallel, because they share custody and the bank.

### Payments (the first of tier 3): about **20 to 30 engineer-weeks**, **5 to 8 months**
| Work package | Effort | Needs |
|---|---|---|
| Choose and sign the partner (licence route), get sandbox credentials | 2 (mostly partnership time) | A partner |
| Deploy the Rust payment engine (root of repo), Postgres, Redis, the PCI vault; connect the partner's connector | 4 to 6 | Check Hyperswitch has a connector; PCI assessment |
| Deploy Kill Bill with the plugin; a tenant and catalogue per merchant | 3 to 4 | |
| Settlement payout ledger, bank instruction export, statement reconciliation | 4 to 6 | A bank partner |
| Merchant onboarding with KYB, chargeback and dispute screens | 4 to 6 | KYB provider |
| Write the missing alert code in unified-router, fix mor-layer key rotation, tax rules reviewed per country | 3 to 4 | A tax adviser |
| Fix the JS SDK and the type check, publish SDKs | 1 to 2 | |
| Independent review of the payments path | 3 of fixes | Review firm |
| Pilot with 2 to 3 merchants | 2 | Merchants |

### Treasury: about **8 to 12 engineer-weeks** after a bank partner
Bank API integration in `bank-connectivity`, settlement execution with human approval, the record-an-executed-settlement screen, reconciliation, per-workspace data. Needs the bank partner and a treasury policy (who approves what).

### Yield engine: about **6 to 10 engineer-weeks** after custody and a decision
One protocol integration with withdrawals (the missing piece), signing through custody with limits, position reconciliation against the chain. Needs a chosen protocol and counsel on whether offering yield is regulated.

### Tokenised assets (rwa-registry): about **8 to 12 engineer-weeks** per issuer
An issuer adapter interface with no default issuer (the user chooses), subscription and redemption flows, real NAV refresh, reconciliation. Needs an account with each issuer you support and counsel on securities rules.

### Smaller items
| Service | Work | Effort |
|---|---|---|
| bank-whitelabel | Add a database layer (everything is in memory today), then a review | 2 to 3 |
| institutional-reporting | Persist reports and an audit trail; real tax inputs; a filing channel | 2 to 3 |
| agent-decision-framework | Persist policies and the velocity ledger so restarts do not reset limits | 1 |
| liquidity-forecaster | Needs real upstream data; then measure forecast accuracy | 2 |
| crypto-gateway | **Decide whether to keep it** (it overlaps the stablecoin gateway); if kept, per-coin review and deployment | 6 to 10 |
| accounts-service | Circle production account, a real KYC provider, FSCA and FIC position | 3 to 4 |
| chain-sync and the shielded-payment contracts | Deploy contracts (never deployed), an independent smart-contract audit, then enable. **Not near term; consider parking it** | 8 to 12 plus a separate audit |

## Tier 4: not planned for FORGE
agent-credit-lines, agent-liquidity-manager and agent-negotiation escrow stay off. If a lender wants a ledger of lines it has funded itself, a small read-only view of the
lender's own records is a few weeks of work, but FORGE should not move lending money. The **lender and furnisher API (tier 1, package 5)** is the real build.

---

## What must exist across every tier

1. **Real environments:** staging and production in separate AWS accounts, a backup account for custody. Terraform applied and kept in code.
2. **Operations:** an on-call rota, alert paths proven to reach a person, runbooks rehearsed, daily reconciliation with a named owner, incident procedure.
3. **Security review before real money**, per scope, with findings fixed and re-checked.
4. **Regulatory position in writing:** National Credit Act bureau registration, FSCA status, FIC registration, POPIA, and any payments or custody licence, before the product they affect launches.
5. **Release discipline:** a protected branch, CI green before deploy, deploy by image digest, a rollback you have tried.
6. **Security of the company itself:** MFA everywhere, no secrets in the repo, least-privilege AWS roles, a plan for lost keys and departing staff.

## Suggested order and rough calendar

| When | What |
|---|---|
| Weeks 0 to 4 | Tier 1 packages 1 to 4, wallet "bring your own", persistence fixes for the three in-memory services; request review quotes; approach banks |
| Weeks 4 to 8 | Soft launch to design partners; tier 1 packages 5 to 9; review scope A in progress |
| Weeks 8 to 12 | Review fixes; regulatory answers; public launch of the bureau if the gates close |
| Months 3 to 6 | Custody topology, ceremony, review, pilot; start the payments partner and licence application |
| Months 5 to 9 | Payments pilot; treasury once the bank is in place |
| Later | Yield, tokenised assets, custodial wallet, zero-knowledge proofs |

The calendar assumes the owner decides quickly and the outside parties respond; a slow review booking or regulator answer moves the whole of tier 1's public launch.

## What I can build in this repository

Everything marked "engineering" above that is code: persistence for the three in-memory services, the lender and furnisher API and sandbox, the bring-your-own-wallet flow, console items,
operator screens, KYB integration (once you pick a provider), the Mode 2 indexer, issuer and partner adapters, notification code, SDK fixes, tests and docs.
What I cannot do: create AWS resources or secrets for you, hold keys, run a ceremony, contact firms or regulators, sign agreements, or make the legal and commercial calls.
