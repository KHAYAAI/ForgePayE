# Launch readiness, 16 October 2026: where we are and how far from live

Builds on `LAUNCH_READINESS_BY_SERVICE_2026-10-07.md` and `BUILD_OUT_PLAN_2026-10-07.md`. Dates and durations are **my estimates**, not commitments, and most of the time is
other people's: the AWS build-out (yours), the review firm, counsel. Nothing here has run against a real cloud account, a real chain, or a real customer.

## The short answer

The **software** for the credit bureau soft launch is built and tested. What stands between us and "live" is now almost entirely **operational and external**: environments that do not
exist yet, runs that have never happened, and two outside sign-offs. I cannot shorten those by writing more code, and I would be wrong to say we are close to taking real money.

| What "live" means | Where we are | Rough distance (assuming you start the AWS build-out now) |
|---|---|---|
| **0. Sandbox pilot**: design partners integrate against the bureau sandbox; no real money; scores not relied on | All software exists. Needs a staging environment and one deploy | **about 2 to 4 weeks**, set by the AWS build-out |
| **1. Testnet money path**: the full payment path on Base Sepolia, including payouts through custody | Software built; never run end to end | **+1 to 2 weeks** after level 0 (needs funded test wallets, an RPC provider, custody staging) |
| **2. Soft launch with real money**: USDC on Base, capped, a handful of customers you know | Blocked by external gates | **about 8 to 12 weeks** from engaging the review firm and counsel; sooner only if you accept written risk |
| **3. Public launch** | Further out | **3 to 6 months** |
| **Custody in production** (separate product) | Testnet and capped pilots only, by its own documents | mid-2027 by its own timeline (separate hosts, hardware HSM, audit, SOC 2) |

## The bureau's own "missing" list from 7 October, line by line

| Missing on 7 Oct | Now |
|---|---|
| Run on AWS with real settings | **Not done.** The deploy path now exists and is safe (below), but no environment does |
| A live-list screening run (OFAC, EU, UN, ZA) | **Not done.** The bundled South Africa list copy expires on **5 November** |
| The money path on Base Sepolia | **Not done.** New since: the gateway can pay through FORGE custody instead of a hot key (built, tested against a stand-in; no run against real custody) |
| Mode 2 has almost nothing to read | **Built, unproven live.** Indexer for Base, Ethereum and Solana wallets; signed custody statements supply success rate and budget compliance. Needs a real RPC provider, verified token addresses, and a real run |
| Zero-knowledge proofs are a stub | **Unchanged.** Stays "coming soon" |
| Controller (operator) verification has no provider | **Built, unverified.** Didit provider with sandbox, ambiguity and spend guards. Its HTTP details are unconfirmed from here, and Didit lists South Africa as **not validated**: test a real South African company before relying on it |
| A lender-facing sandbox and per-lender quotas | **Built.** Sandbox, per-institution keys, rate limits and daily caps, signed webhooks, console onboarding, conformance script |
| Multi-replica behaviour untested | **Unchanged** |
| Independent review of billing, payouts and consent | **Unchanged.** I see nothing in the repository showing a firm is engaged |
| Counsel on National Credit Act bureau registration | **Unchanged.** You set the brief aside on 6 October; the question still gates public launch. A second brief (POPIA and the custody data) is written |

## What today's work moved, and what it did not

**Moved (the path to a safe deploy):**
- Before: the console's deploy workflow could not have worked (the chart did not exist), built its own unscanned `latest` image, used long-lived AWS keys, and needed no approval; two console credentials fell back to keys published in this repository.
- Now: images are built, **scanned, then signed**; deploys are manual, by digest, **refuse an image our pipeline did not sign**, use a short-lived AWS role, wait for an approver, default to a dry run, roll back on failure, and prove the running pods are on the approved digest. The console, bureau, gateway, custody-node and vendored custody charts all refuse to render without a digest when asked. Third-party actions are pinned and a CI job keeps them so.

**Did not move:** every external gate. No new environment, run, review, sign-off or partner exists because of this work. It removes a way for the launch to go wrong; it does not bring the date forward.

**Still unproven, by design of the sandbox I work in:** signing and verification have never run (they need GitHub and Sigstore); nothing has touched AWS; the Didit calls are unconfirmed; custody payouts have not run against real custody. The first real runs are the tests, and they will find something.

## The critical path, in order

1. **AWS build-out (you).** Everything else waits for staging. `docs/launch/14-deploying-services.md` lists exactly what the workflow expects.
2. **Merge to `main` and let the images workflow run there.** Production deploys accept only images signed from `main`; until then nothing can be deployed to production, intentionally. The first run also tests signing.
3. **First dry-run deploys**, then live to staging.
4. **Engage the review firm and counsel now**, in parallel: they are the longest lead and nothing I build shortens them. Without a written sign-off or a written list of accepted risks you have read, level 2 does not happen.
5. **The runs only you can do:** funded Sepolia wallets and an RPC provider; a custody staging environment (`docs/launch/11-custody-backend.md`); the Didit smoke check on a real South African company; refresh the South Africa sanctions list before 5 November.
6. **Operations:** on-call named, alerts tested, a game day (`05-operations-runbook.md`), reconciliation owner. Not code, and a hard gate.

## Open risks worth naming

- **Advisory scans are red** (`govulncheck` on the signer, two `npm audit` jobs). They are marked non-blocking; they need triage before review, because a reviewer will read them.
- **The review will find things.** Budget time to fix and re-check; the plan assumes 2 to 3 engineer-weeks of fixes.
- **Public repository:** keep it free of anything sensitive; the secret scan is blocking and has already caught a false positive in my own tests.
- **POPIA and the credit-bureau regime** are legal questions I can only frame (`02`, `12`).
