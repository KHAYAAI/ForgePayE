# Readiness, platform by platform — 3 October 2026

**Can we launch? No, not today.** The nearest launch is the **credit bureau on a small, human-approved money path**, and it is waiting on people outside engineering (review, counsel, issuer confirmation, real infrastructure, rehearsals), not on more code. Nothing else should be offered to customers yet.

**How to read the evidence.** I ran every Node service's own tests and typecheck, and the Python tests I could, on 3 October. A passing test suite means the service does what its authors checked; it is **not** a security assessment, a load test, or proof it works against real dependencies. Where I did deeper work (the first five rows) the notes say what. "Not assessed" means exactly that.

## Verdict table

| Platform | What I did | Result | Launch verdict |
|---|---|---|---|
| **Credit bureau** (`agent-credit-bureau`) with its **payments rail** (`stablecoin-gateway`) | Deep: fixed the bureau-path security defects, built leader lock, alerts, reconciliation, live-rate feed, token probes; real Postgres + local-chain end-to-end (115/115), load test, DB restore drill | bureau 388 pass (6 skipped); gateway 176 pass (2 skipped) + e2e | **Closest. Not yet.** Gated by: independent review, counsel, issuer confirmation of ZARP/OUSD, real infra + dust tests, rehearsed operations. Launch only in the conservative configuration |
| **Custody** (`openfireblocks` signer, nodes, gateway; console Custody pages) | Deep: fixed the custody-side defects; built backups + restore drill, signer mTLS, per-signer signatures, shared throttling, topology check, officer ceremony tooling | Go suite (incl. real distributed key generation, resharing, disaster recovery) passes; 120 gateway jest tests pass (5 need Postgres, passed against one) | **Not ready.** Never run on separate hosts; no officer has done the drill; independent review of the threshold stack not started; per-signer signing has no browser/hardware-token flow |
| **Console** (`apps/platform`) | Fixed auth/route defects; added tests | 8 pass (3 need Redis; passed against one); typecheck clean | **Not ready** as a multi-tenant product: data behind bureau/treasury/ontology views is platform-wide, not per tenant; no email verification; most of the console untested |
| **Treasury** (gateway treasury manager; `enterprise-treasury` service) | Gateway side: deep (above). `enterprise-treasury`: own tests only | enterprise-treasury 59 pass | Gateway treasury: part of the bureau launch. `enterprise-treasury` as a product: **not assessed** |
| **Wallet** (`forge-wallet`, `open-privy`) | Own tests only | forge-wallet 33 pass; **open-privy: its lockfile does not install and it does not typecheck in this repo** | **Not assessed / not ready**: the in-repo open-privy needs reconciling before it can be built reproducibly |
| **Compliance monitor** (sanctions/AML; Python) | Ran tests in a fresh venv (needed `pytest-asyncio`) | 129 pass, **4 fail** (dev-API-key parsing tests) | **Not ready**: failing tests unexplained; the bureau depends on it for sanctions screening (it logs "screen SKIPPED (dev only)" without it) |
| **Unified router** | Own tests | 87 pass | Not assessed beyond tests |
| **Billing engine** (Kill Bill wrapper), **MoR layer** (Python 3.12) | billing-engine own tests; MoR could not run (needs Python 3.12; this machine has 3.11) | billing-engine 23 pass; MoR **not run** | Not assessed |
| **Agent services**: identity, negotiation, credit lines, decision framework, liquidity manager | Own tests (decision-framework, negotiation needed `npm install`: their lockfiles are out of sync) | 77 / 49 / 28 / 42 / 67 pass | Not assessed beyond tests |
| **Yield engine**, **crypto gateway**, **institutional reporting**, **chain-sync**, **bank-whitelabel**, **liquidity-forecaster** (Python) | Own tests | 30 / 40 / 31 / 9 / 14 / 51 pass | Not assessed beyond tests |
| **Bank connectivity** | Own tests | 10 of 24 **fail** without a database configured (`DATABASE_URL`); unknown whether they pass with one | Not ready / unknown |
| **RWA registry** | Own tests | 6 of 67 fail: tests that count rows in a shared Postgres, so they depend on the database's state | Not ready / unknown |
| **Email service** | None | no tests | Not assessed |
| **Payment engine (Hyperswitch fork at the repository root)** | Not built or run (Rust; a full build is out of reach here) | — | **Not assessed** |
| **Marketing site, on-chain contracts, VS Code extension, dashboard hub** | Not examined | — | **Not assessed** |

## The bureau-first launch, concretely

Needed before taking real money, in order of who must act:

1. **You / outside parties:** engage the review firm (scope A: gateway, treasury, payout signer, bureau billing) and counsel (the seven questions); get the ZARP and OUSD contracts confirmed by their issuers and settle whether OUSD rebases; provide AWS, a Base RPC provider, wallet addresses (generated offline), alert credentials.
2. **Then, with those:** stand up staging, run the KMS check against the real account, run the dust tests (USDC, then ZARP, then OUSD), restore the database from a real backup, rehearse the game day (`docs/launch/05-operations-runbook.md`).
3. **Launch narrowly:** the values in `infra/helm/stablecoin-gateway/ci/launch-values.yaml` (human approval of every payout, $250 ceiling, $500 daily cap, USDC first, one replica, no merchants, custody product off).

Engineering follow-ups that would reduce risk but do not block that path: investigate the 4 compliance-monitor failures; the settlement scan makes calls per open deposit each pass and needs batching before volume on a real RPC; the console's per-tenant data partitioning.

## The custody launch is a separate, later decision

It additionally needs: nodes on genuinely separate infrastructure with the topology check passing (`docs/custody-separate-hosts.md`), a restore drill done by real officers (`docs/custody-officer-ceremony.md`), scope-B independent review (threshold signer, governance, DR), signers actually enrolled with their own keys and exercising the signing flow, and a long enough clean run of the bureau first. Do not combine the launches.

## Caveats on this document

- Test counts are from running each service's own `npm test`/`pytest` here; some suites were skipped or need infrastructure (noted).
- "Pass" for a service I did not work on says nothing about whether it is secure, correct for its job, or deployed anywhere.
- The earlier `PLATFORM_READINESS.md` (August) makes broader claims, including a percentage; I have not verified it and do not endorse the number.
