# Launch readiness, service by service: what exists and what is missing

**7 October 2026.** Every service, app and package in `forgepay/`, with what it does, the evidence for its state, and the specific
components that are missing before it can run for real customers.

## How this was assessed, and its limits

- **Inspected this week, in depth:** bureau, compliance-monitor, console, unified-router, mor-layer, billing-engine, stablecoin-gateway,
  enterprise-treasury, bank-connectivity, rwa-registry, yield-engine, open-privy, openfireblocks (custody), agent-negotiation,
  agent-liquidity-manager, accounts-service (KYC), institutional-reporting, and the website. Tests were run and, for the bureau, console and
  compliance-monitor, the services were started and exercised.
- **Inspected today by survey only** (source search, route lists, persistence and stub markers, not run): agent-credit-lines,
  agent-decision-framework, agent-identity, bank-whitelabel, chain-sync, crypto-gateway, liquidity-forecaster. Treat these entries as
  "what the code says", not "what I observed".
- **Not examined:** the Hyperswitch Rust core at the repository root, the on-chain contracts (never deployed), the VS Code extension and
  most SDK-adjacent packages beyond what is stated.
- A passing test suite means the service does what its authors checked. It is not a security review, a load test, or proof it works
  against real partners. "Production ready" needs five things (runs for real, money reconciles, reviewed, allowed, operated); see
  `launch/06-production-readiness-roadmap.md`.

## Where each service sits

| Tier | Services | Position |
|---|---|---|
| **1. Bureau soft launch** | agent-credit-bureau, compliance-monitor, console, website, stablecoin-gateway (the bureau's payment rail); agent-identity is optional | Code ready; waits on AWS, live-list run, testnet money path, review |
| **2. Custody** | openfireblocks (signer, nodes, gateway, policy-service, temporal-worker) | Deep, tested on one host; waits on separate hosts, ceremony, scope B review |
| **3. After licences or partners** | unified-router, mor-layer, billing-engine, Hyperswitch core, crypto-gateway, accounts-service, bank-connectivity, bank-whitelabel, enterprise-treasury, yield-engine, rwa-registry, institutional-reporting, liquidity-forecaster, chain-sync | Built to different depths; each has named missing components below |
| **4. Not planned for FORGE** (bureau-only decision) | agent-credit-lines, agent-liquidity-manager, agent-negotiation escrow | Stay off; the work is the lender API for microfinance institutions |
| **Wallet** | open-privy | Off; the near-term product is bring-your-own-wallet |

---

## Tier 1: the bureau soft launch

### agent-credit-bureau  (Node/Fastify, port 3018, about 14,000 lines, 28 test files)
**Does:** registers agents, scores them (Mode 1: rules-based, 300 to 1000, AAA to D; Mode 2: on-chain, null when there is no data), takes furnished
payment events, lender reports with reason codes, consent tokens, disputes, per-pull billing (prepaid ledger, USD 2.80 list per inquiry), furnisher payouts, sanctions screening.
**Evidence:** about 406 tests pass. Run in production mode against Postgres and Redis: refuses to start without its secrets, a new agent starts at 300 / DEEP_SUBPRIME with
THIN_FILE cited, state survives a restart, unauthenticated calls get 401, per-workspace scoping holds through the console. The image scan passes in CI.
**Missing:**
- Run on AWS with real settings (the chart's defaults were fixed on 6 October; it has never been installed).
- A live-list screening run: OFAC, EU and UN lists have never been loaded together with the bureau calling the monitor.
- The money path on Base Sepolia (billing and payouts through the gateway): never run against a real chain.
- **Mode 2 has almost nothing to read:** it scores on-chain activity, which is thin on testnet. No lender should rely on it yet.
- **Zero-knowledge proofs are a stub** (`stub-sha256-commitment`, not cryptographically verifiable). Disabled in production unless explicitly acknowledged. Must stay "coming soon".
- **Controller verification:** agents are bound to a *named* operating entity. The check exists as a provider seam and an eligibility policy (`kyb.ts`, `POST /v1/agents/:id/operator-verification`), but **no register provider is connected** (the default says `registry_unavailable`), so an operator's registration is as submitted.
- **A lender-facing sandbox and per-lender quotas** for the microfinance institutions (the lender and furnisher APIs exist; the partner experience around them does not).
- Several in-memory working sets (17 maps) are hydrated from Postgres at start with write-through; that design has been tested only on a single replica. Multi-replica behaviour is untested.
- Independent review of billing, payouts and consent. Counsel's answer on National Credit Act bureau registration.

### compliance-monitor  (Python/FastAPI, port 8003, about 7,000 lines, 9 test files, 157 tests pass)
**Does:** sanctions screening (OFAC, EU, UN, UK, South African TFS) that fails closed, AML transaction rules, SAR/CTR drafting, goAML XML drafts (never submitted).
**Evidence:** tests pass; the South African list parser reads the real FIC file (1,002 entries) and loads from a recorded copy with honest age.
**Missing:**
- **The FIC download address is unconfirmed** and the bundled copy expires after 30 days (screening then refuses everyone).
- OFAC, EU, UN downloads and the UK list URL have **never run from a network that can reach them**. The UK list's format is "to confirm".
- A production deployment with its own database, Redis and the service-key hash for the bureau (`SERVICE_API_KEY_HASHES`).
- goAML is drafts only: a compliance officer must file in the FIC portal under the institution's own registration (`FIC_RENTITY_ID`); no operator screen for export yet.
- Monitoring-rule tuning against real traffic, and a named compliance officer. The Chainalysis and Elliptic address-screening keys are unset in the example config, so address screening beyond the lists is not in use.

### stablecoin-gateway  (Node, the bureau's payment rail, about 7,000 lines, 20 test files, 176 tests)
**Does:** one-time deposit addresses, sweeps, human-approved payouts, treasury manager, KMS key wrapping, reconciliation, leader lock, alerts, rate feed.
**Evidence:** 19 checks against a local chain; 111 end-to-end checks against ganache and Postgres; image passes the scan.
**Missing:**
- **Never run on a real chain or RPC**, nor against real USDC. The Base Sepolia smoke test is the first real contact.
- **KMS wrapping has only run against a fake KMS.** Run the key-custody check against the real account first.
- Alert delivery to a human (PagerDuty or Slack) never tested; daily reconciliation has no named owner.
- Settlement scanning makes a call per open deposit each pass; needs batching before volume on a real RPC.
- **Shielded (privacy) payments are scaffolding:** x402 shielded routes wait on contracts never deployed (TODOs for the auditor key and contract addresses). Keep off.
- Independent review (scope A is mostly this service).

### agent-identity  (Node, port 3010, 83 tests, 17 skipped)
**Does:** issues `did:forge:agent_<id>` identities, attestations, KYA import, signed tokens, JWKS.
**Evidence:** tests pass; the bureau treats it as optional (unreachable degrades to a local heuristic and says so).
**Missing:** a production deployment and key management for its signing keys; an operator process for attestations; 17 skipped tests need examining. Not required for the soft launch.

### console (apps/platform, Next.js 15)  (15 tests, builds, image scan passes)
**Does:** sign-up, sessions, workspaces, bureau and custody and treasury views, API keys (hashed).
**Missing:**
- **Pages for products it cannot show:** tokenised assets, yield, credit lines, billing, the record-an-executed-settlement step, goAML export.
- **Treasury and ontology views are platform-wide, not per workspace** (the bureau is done and checked).
- Email verification at signup; request throttling is per process, not shared.
- Production secrets and the operator workspace id; SMTP and mailboxes; the product-catalog service must be running for workspaces to enable products.
- Two HIGH findings in the postcss copy bundled inside Next (fix needs Next 16).
- Not yet reviewed independently (tenant boundaries and auth).

### website  (static, S3 and CloudFront)
**Done:** false claims removed, credit-bureau page rewritten with the intersection, bridge and protocols sections, checkout closed by default.
**Missing:** the domain, certificate, CloudFront and hosting are not set up; `docs.myforgepay.com` (14 links) has nothing behind it; two existing claims on the bureau page ("from on-chain transaction data", "verifiable on-chain data") are inaccurate and unfixed.

---

## Tier 2: custody

### openfireblocks  (Go signer and nodes, Node gateway, policy-service, temporal-worker; about 16,000 lines, 36 test files)
**Does:** threshold (multi-party) signing so no machine holds a whole key; governance and approvals; resharing; backup and disaster recovery; officer ceremony tooling.
**Evidence:** the Go suites pass (the long signing package takes about 15 minutes); 120 gateway tests; signer mutual TLS and per-signer signed approvals built; images pass the scan.
**Missing:**
- **Never run across separate hosts or accounts**; the topology check has not been passed for real.
- **No real key ceremony**: a restore drill with real officers and hardware has not happened.
- **Scope B independent review** (threshold signer, governance, recovery). The library `bnb-chain/tss-lib` v2.0.0 has had published implementation advisories; the reviewer must confirm which affect this version.
- Production Terraform for the backup bucket, Vault and nodes, never applied. No soak, chaos or multi-region testing.
- One accepted finding (btcd CVE-2022-44797) rests on the claim that the affected code is not compiled in; it needs a reviewer's agreement.
- Counsel: whether holding keys for others is a regulated activity.

---

## Tier 3: after licences or partners

### unified-router  (Node, 100 tests; about 6,000 lines)
**Does:** webhook normaliser (Hyperswitch, Kill Bill, KYAPay), merchant summary, product catalogue, checkout API.
**Evidence:** auth bypass on the events route closed; the console events feed works; tests pass; lint now runs.
**Missing:** the notification actions are TODOs (Slack, PagerDuty, email to customers, support tickets, in `payment-fallback`, `support-monitoring`, `killbill-sync`); churn-prevention success tracking is unimplemented; never run against a real Hyperswitch or Kill Bill; its product catalogue is needed by the console but it is not part of the bureau launch.

### mor-layer  (Python/FastAPI; merchant of record, tax, checkout; 107 tests)
**Does:** tax calculation, checkout sessions, webhooks and bridges, auditor key handling.
**Missing:** the type check fails in CI though it passes locally; **auditor key rotation does not archive the old key** (a TODO: rotation would lose the ability to read old records); tax rules not reviewed per country (I did not review them); never run against a live acquirer; a licence or a partner's model is needed first.

### billing-engine  (Kill Bill wrapper and a Java plugin `forgepay-hyperswitch`; 11 config tests and 10 plugin tests)
**Done:** catalogue per tenant, plugin builds, run live against Kill Bill 0.24.10 with deterministic payment ids.
**Missing:** a production Kill Bill deployment (its own database, tenant per merchant, catalogue upload), no state of its own to back up beyond Kill Bill's; never connected to a real payment engine.

### Hyperswitch core (Rust, repository root)
**Not examined.** A full build is outside the sandbox. **Missing:** a real deployment, an acquirer connector with credentials, the PCI vault on, database and Redis, an operations runbook, and the pinned upstream commit in `pinned-upstreams.yaml`.

### crypto-gateway  (Node, forked from Keagate; 40 tests; survey only)
**Does:** invoice-based crypto payments across many coins.
**Missing:** it claims 50+ coins and a 1.4% fee, but readiness for each coin (nodes, confirmations, address derivation) is unexamined; the HD wallet and monitor are in-process with no review; no deployment; and it overlaps the stablecoin-gateway. Decide whether it is needed at all before investing.

### accounts-service  (Node; Circle USDC accounts, KYC; 20 tests)
**Does:** accounts and transactions via Circle, with webhook signature verification and KYC.
**Evidence:** refuses to run without a Circle key in production (it mocks only in development).
**Missing:** a Circle production account and keys; KYC provider wiring has not been exercised against a real provider; FSCA and FIC position for holding accounts.

### bank-connectivity  (Node, Prisma; 21 tests need Postgres)
**Does:** bank account links, balances, internal routes used by treasury.
**Missing:** **a real bank integration** (no bank partner chosen); credentials handling for bank APIs; the test suite needs a database in CI (it runs in the Postgres job).

### bank-whitelabel  (Node; multi-tenant bank admin console; 14 tests; survey only)
**Does:** bank admin logins, customer registry, transactions, settlement reports, webhook forwarding.
**Missing:** **everything is held in memory** (banks, admins, customers, transactions are Maps in `store.ts`), so a restart loses all of it, with no database layer at all. Needs persistence, then a review, before any bank uses it. Only the health and metrics routes showed in my route survey, so confirm the route registration.

### enterprise-treasury  (Node; 66 tests)
**Does:** cash position, rules and approvals, netting; approvals persisted (6 October).
**Missing:** **execution**: no settlement rail, no recording of an executed bank settlement, no operator screen; depends on the bank partner; the console shows treasury platform-wide, not per workspace.

### yield-engine  (Node; 35 tests, 14 skipped)
**Does:** yield vaults and sweeps; refuses simulation in production.
**Missing:** **withdrawals are not implemented**, so deposits are refused on-chain by design (the code says so); no protocol integration chosen; the simulated transaction hash path exists for development only. Needs the custody signing path.

### rwa-registry  (Node, port 3008; 76 tests with Postgres)
**Does:** registry of tokenised real-world assets, income, redemptions.
**Missing:** the NAV refresh only "logs intent and updates timestamps" (a stub), and **redemption processing is a stub**; no issuer integration (decision: user chooses the issuer, so an adapter interface is needed); its reconciliation against chain balances depends on chain-sync, which is itself a stub.

### institutional-reporting  (Node; 36 tests)
**Does:** reports and CSV, tax filing generator.
**Missing:** **reports are held in memory** (lost on restart; no audit trail); the tax filing no longer returns made-up figures, but real tax computation inputs are not wired; no filing channel.

### liquidity-forecaster  (Python; ARIMA and Holt-Winters forecasting; survey only)
**Does:** 7, 30 and 90-day cash-flow forecasts and runway, from upstream payment history.
**Missing:** it needs history from payment-engine, billing-engine and the gateways, none of which carry real data yet; its cache is in-process; one test file (51 tests at the 3 October run); no accuracy track record.

### chain-sync  (Node; 9 tests)
**Does:** syncs the commitment tree and nullifiers for the shielded-payment scheme.
**Missing:** **contract addresses are all zero**: it skips its work on every chain and says "STUB". The contracts (`CommitmentTree`, `NullifierRegistry`, a Groth16 verifier) have never been deployed. It also lacks alerting where it has a TODO. It is not part of any near-term launch.

---

## Tier 4: not planned for FORGE (bureau-only decision)

### agent-credit-lines  (Node; 29 tests)
Credit lines, draws, repayments and overdue checks exist as **bookkeeping with no money movement**. Microfinance institutions will fund lines, so this stays off. If kept as a record, it is the lenders' ledger, not FORGE's. **Missing for any use:** disbursement and repayment collection, which would belong to the lender.

### agent-liquidity-manager  (Node; 70 tests)
Real prices feed it, but liquidity moves are bookkeeping. **Missing:** movement through custody's policy engine, which depends on custody launching. Stays off.

### agent-negotiation  (Node; 49 tests, 53 with Postgres)
Escrow is durable, but **funding and settlement on-chain are "not wired yet"** (its own comments say so). Stays off.

### agent-decision-framework  (Node; 42 tests; survey only)
A policy and velocity-limit engine. **Policies and the velocity ledger are in memory**, so a restart resets spend limits (a safety control that forgets). The bureau does not call it (only a stale environment variable in the chart mentions it). Needs persistence if it is ever relied on.

---

## Wallet

### open-privy  (Node/NestJS; 41 tests; not in a Docker image or chart in this repo)
Per-user wallets with envelope encryption and a testnet-only chain allowlist. **As built it is not non-custodial** (FORGE's service can decrypt keys). **Missing:** a Dockerfile and chart; the KMS key; a migration of legacy wallets; a mainnet limit policy; recovery tests; the workspace typecheck (the mobile app fails); an independent review. Near-term product: bring your own wallet. Keep off.

---

## Apps and packages

| Item | State | Missing |
|---|---|---|
| **sdk-js** | 74 of 75 tests pass; fails the build | Missing `@forgepay/privacy-payment-wasm` package; missing `tsconfig.esm.json` and `tsconfig.cjs.json`; shielded checkout calls a method that does not exist |
| **sdk-python** | Lint and 27 tests pass; had a syntax error, fixed | Not published; docs |
| **forge-agent, elizaos-plugin, claude-agents-cookbook, swarms-integration, integrations (crewai, langgraph, n8n)** | Present; not examined beyond a listing | Examine and decide which to support; none is needed for the bureau launch |
| **vscode-extension** | Present | Not examined |

## Shared infrastructure (all tiers)

| Item | State | Missing |
|---|---|---|
| AWS accounts, domain, certificate | One AWS account exists; nothing else | Staging and production accounts, hosted zone, ACM certificate, CloudFront, mailboxes |
| Terraform and Helm | Written and linted; **never applied** to any account | First apply will find problems; the console's chart mapping is unconfirmed; `open-privy` has none |
| CI | Seven of eight images pass the scan; unit tests run | The `mor-layer` type check, the JS SDK, AWS deploy credentials; no image has been deployed |
| Observability | Prometheus metrics and ServiceMonitors exist | Alert destinations never tested; dashboards untested on a live system |
| Operations | Runbooks written | Never rehearsed; no named on-call; reconciliation has no owner |
| Secrets | Generator and preflight check built | Real values not created; none are in Secrets Manager |

## Cross-cutting gaps

1. **Nothing has run on real infrastructure.** Every service has been proven locally only.
2. **Three services lose data on restart** (bank-whitelabel, institutional-reporting reports, agent-decision-framework policies and velocity) and several others rely on in-process state hydrated at start.
3. **Several "money" services have stubbed execution** (rwa-registry redemptions, yield withdrawals, chain-sync, agent escrow funding): their screens and docs now say so, but the code paths are absent.
4. **Operational notification code is TODOs** (Slack, PagerDuty and email) in unified-router.
5. **No independent review has started.** Nothing here has been security reviewed by an outside party.
6. **Regulatory position unconfirmed:** bureau registration under the National Credit Act, FSCA status, FIC registration, and licences for payments.

## What launch needs, by service

- **Bureau soft launch:** bureau, compliance-monitor, console, stablecoin-gateway (and optionally agent-identity), plus Postgres, Redis, secrets, the live-list run and the testnet money path.
- **Everything else** is off, labelled as off, and gated by `FORGE_LAUNCHED_PRODUCTS=credit-bureau`.
