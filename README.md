<h1 align="center">FORGE</h1>
<p align="center"><strong>The Revenue Ontology</strong> — financial infrastructure for traditional finance, stablecoins, autonomous AI agents, and tokenized real-world assets, normalized into one canonical event.</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue" /></a>
  <img src="https://img.shields.io/badge/status-pre--launch%20%C2%B7%20nothing%20live-orange" />
  <img src="https://img.shields.io/badge/real%20money-none%20processed-lightgrey" />
</p>

<hr/>

## What FORGE is

Most companies run money through five disconnected systems — a card processor, a crypto wallet, a tax tool, a billing platform, a spreadsheet holding it together. FORGE aims to replace that with one ledger: every payment, on every rail, normalizes into the same signed `ForgePayEvent` schema. The rail becomes a parameter, not a decision.

## Status — read this first

**Nothing here is live, and no real money has been processed.** No staging or production environment exists yet; the AWS build-out has started (account security, staging region chosen: Stockholm, `eu-north-1`). What exists is a large, tested codebase and the machinery to deploy it safely. This table is deliberately conservative; the evidence behind each line is in [`forgepay/docs/LAUNCH_READINESS_2026-10-19.md`](./forgepay/docs/LAUNCH_READINESS_2026-10-19.md), and progress since then is under [Road to launch](#road-to-launch).

| Product | What it is | Where it stands (28 Oct 2026) |
|---|---|---|
| **FORGE Credit Bureau** | Dual-mode reputation scores for AI agents (Mode 1: rules from reported payment history; Mode 2: on-chain activity, read from an agent's own wallet), lender and furnisher APIs with per-institution keys, rate limits and signed webhooks, single-use consent, disputes, billing, a lender sandbox, operator verification against a company register | **The first launch target.** Code complete and tested; signed images build in CI for it and the three services it depends on (compliance monitor, stablecoin gateway, console). Never deployed to a cloud environment. Soft launch needs the AWS environments, the live runs, an independent review and counsel's answers |
| **FORGE Custody** | Threshold-signature key custody (2-of-3 by default; ECDSA and Ed25519), policy and approvals, an agent-payments API | **Testnet and capped pilots only.** The backend lives in its own repository, [`KHAYAAI/openfireblocks`](https://github.com/KHAYAAI/openfireblocks) (Elastic License 2.0). The copy under `forgepay/services/openfireblocks` is an older, smaller vendored tree. Not audited |
| **FORGE Payments** | Card, bank, stablecoin and x402 machine-payment checkout (Hyperswitch core, `unified-router`, `stablecoin-gateway`, `mor-layer`, `billing-engine`) | Built; the stablecoin gateway passes a full local end-to-end (115 checks). **Never run against a real acquirer or bank.** Website checkout is closed by default (per the 7 October audit) |
| **FORGE Treasury** | Cash position, netting, approvals | Reads and approvals work and persist; **settlement, yield and tokenised-asset execution do not exist yet** |
| **FORGE Wallet** | Hosted keyless wallets (`open-privy`) | **Off.** The hosted design can decrypt keys, so it is not non-custodial. The near-term product is bring-your-own-wallet in the console |

**Not offered, by decision:** agent credit lines, agent-to-agent escrow and liquidity moves (`agent-credit-lines`, `agent-negotiation`, `agent-liquidity-manager`) stay in the code but off. FORGE is a bureau: lenders fund credit; FORGE reports on it.

**What gates a launch, none of it code:** (1) the cloud environments being built and the first runs on them (a staging stack, a Base Sepolia payment path, the sanctions lists loading live, a restore drill); (2) an **independent security review** of the money paths; (3) **counsel's written answers** — notably whether scoring agents brings the bureau into National Credit Act registration, and the POPIA position on the custody data it uses; (4) on-call, tested alerts and a rehearsed runbook. See [`forgepay/docs/launch/00-LAUNCH-STEPS.md`](./forgepay/docs/launch/00-LAUNCH-STEPS.md).

**On-chain:** the five-contract stack (`ForgeReputationRegistry`, `ForgeTransactionValidator`, `ForgeBudgetEnforcer`, `ForgeCore`, `ForgeCrossChainReputation`) was deployed to **Base Sepolia** on 2 September 2026 (15 successful receipts in the committed [broadcast record](./forgepay/on-chain/broadcast/Deploy.s.sol/84532/run-latest.json)). It is **not on mainnet**; the scripted path is in [`MAINNET_DEPLOYMENT_WALKTHROUGH.md`](./forgepay/docs/MAINNET_DEPLOYMENT_WALKTHROUGH.md). The separate shielded-payment contracts have never been deployed.

## Repository structure

Two things layered together: a fork of [Hyperswitch](https://github.com/juspay/hyperswitch) (the Rust payment router at `crates/`, the card and bank engine) underneath the FORGE platform, which lives entirely under `forgepay/`.

```
crates/                    Hyperswitch payment router (Rust) — forked; treat like upstream
forgepay/
├── apps/platform/         Console — bureau, custody, treasury screens (Next.js 15)
├── website/               Marketing site — static HTML/CSS/JS, no build step
├── services/              23 services — see below
├── packages/              SDKs (sdk-js, sdk-python) and agent integrations
├── on-chain/              Solidity contracts + Foundry deploy scripts (Base)
├── infra/                 Helm charts, Terraform, launch templates and scripts, staging scripts
├── config/                Pricing, upstream pins (base/pinned-upstreams.yaml), environments
└── docs/                  Runbooks, readiness assessments, architecture, security review pack
.github/workflows/         CI, image build/scan/sign, and the manual deploy workflow
```

### Services (`forgepay/services/`)

| Service | Role | State |
|---|---|---|
| `agent-credit-bureau` | Agent scoring, lender/furnisher APIs, consent, disputes, billing, indexer, operator verification | **Launch target** |
| `compliance-monitor` | Sanctions screening (OFAC, EU, UN, UK, South Africa lists; fails closed until loaded), SAR/CTR drafts | Launch dependency |
| `stablecoin-gateway` | USDC/USDT/ZARP/OUSD deposits, sweeps, payouts (hot key or through FORGE custody), x402 | Launch dependency (the bureau's payment rail) |
| `agent-identity` | DID registry and resolution | Optional for soft launch |
| `openfireblocks` | Vendored custody tree (older); real backend is a separate repo | Custody |
| `unified-router`, `mor-layer`, `billing-engine`, `crypto-gateway`, `accounts-service` | Event bus, merchant of record and tax, subscriptions, crypto invoices, accounts | Payments, after licences or partners |
| `enterprise-treasury`, `bank-connectivity`, `bank-whitelabel`, `institutional-reporting`, `yield-engine`, `rwa-registry`, `liquidity-forecaster`, `chain-sync` | Treasury and banking, reporting, yield, tokenised assets, forecasting | Built to different depths; later |
| `agent-decision-framework` | Spend policies and velocity limits for automated callers | Supporting |
| `agent-credit-lines`, `agent-negotiation`, `agent-liquidity-manager` | Credit lines, escrow, liquidity | **Off by decision** |
| `open-privy` | Hosted wallets | **Off** |

## How it is built and shipped

- **CI** (`.github/workflows/forgepay-*.yml`): typecheck, tests, real-Postgres jobs for the services that persist state, Helm lint and render for every chart, Terraform validate, a blocking secret scan, and a check that every third-party GitHub Action is pinned to a commit.
- **Images** are built, **scanned** (Trivy, blocking on fixable critical findings), then **signed keylessly** (cosign) and listed by digest.
- **Deploys** are manual (`deploy-service.yml`), to **staging** or **production** (each its own GitHub environment, AWS account and values file), by digest only, refuse any image not signed by the images workflow on `main`, use short-lived AWS credentials through OIDC (no stored keys), wait for a human approver, default to a dry run, roll back on failure and verify the running pods are on the approved digest. The charts refuse to render without a valid digest when asked to.
- **Secrets** never live in the repository or in Helm values; services refuse to start in production with a missing or placeholder secret. See [`forgepay/docs/launch/14-deploying-services.md`](./forgepay/docs/launch/14-deploying-services.md).

None of the deploy path has yet run end to end against a real cluster.

## Road to launch

The bureau launches first, with the three services it needs (wave 1). Tracked step by step in [`forgepay/docs/launch/16-wave1-staging.md`](./forgepay/docs/launch/16-wave1-staging.md).

| Step | State (28 Oct 2026) |
|---|---|
| Code for the bureau and its dependencies | Done; tested locally and in CI |
| Build, scan, sign and digest-only deploy pipeline | Done; all four wave-1 images build, pass the scan and are signed in CI |
| Staging configuration (Stockholm, Base Sepolia testnet USDC, tiny limits, secret lists) | Done; Terraform validated in CI |
| AWS account secured, everyday admin login, audit trail | In progress |
| Separate staging account, domain zone (`myforgepay.com` is in Route 53) and certificate | Next |
| Build staging (network, Kubernetes 1.35, Postgres 16, Redis, keys), cluster add-ons | Not started |
| Merge to `main`, first dry-run deploy, wave 1 deployed and proven in staging | Not started |
| **Level 0: sandbox pilot** for lenders (synthetic data) | Roughly 2–3 weeks away if the AWS work keeps moving; also needs a public address for the bureau |
| **Level 1: testnet money path** (Base Sepolia, through the deployed stack) | Shortly after level 0 |
| **Level 2: capped real-money soft launch** | About 2–4 months; set by the independent review and counsel (neither engaged yet), plus on-call and a second deploy approver |

**Deadline:** the South Africa sanctions list copy in the compliance monitor expires on **5 November 2026**; after that, screening refuses everyone until it is replaced.

## Quickstart (local development)

```bash
# Hyperswitch payment router (Rust) — from the repository root
cargo build --release && cargo test

# Marketing site — static, no build step
open forgepay/website/index.html

# Any TypeScript service, e.g. the credit bureau
cd forgepay/services/agent-credit-bureau
npm install && npm test          # npm run dev to start it (sandbox mode: BUREAU_SANDBOX=true)

# The console
cd forgepay/apps/platform && npm install && npm run dev

# Everything together, local dev
docker compose -f forgepay/infra/k8s/docker-compose.dev.yml up
```

Most services document their environment in `.env.example` and refuse to boot in production with a missing or placeholder secret (fail closed, not silently insecure).

## Documentation

**Where to start**
- [`forgepay/docs/LAUNCH_READINESS_2026-10-19.md`](./forgepay/docs/LAUNCH_READINESS_2026-10-19.md) — the current, detailed readiness assessment: gates, evidence, risks, timeline
- [`forgepay/docs/launch/00-LAUNCH-STEPS.md`](./forgepay/docs/launch/00-LAUNCH-STEPS.md) — the bureau launch, step by step
- [`forgepay/docs/launch/16-wave1-staging.md`](./forgepay/docs/launch/16-wave1-staging.md) — the staging checklist: what is needed, deploy order, secrets per service, known gaps
- [`forgepay/docs/launch/15-aws-start-here.md`](./forgepay/docs/launch/15-aws-start-here.md) — the AWS build-out, for a first-timer
- [`forgepay/docs/launch/14-deploying-services.md`](./forgepay/docs/launch/14-deploying-services.md) — the deploy workflow and what GitHub and AWS must provide

**The bureau and its partners**
- [`09-institution-integration-guide.md`](./forgepay/docs/launch/09-institution-integration-guide.md) — how a lender or furnisher integrates (sandbox, keys, contract, webhooks)
- [`10-mode2-activity-indexer.md`](./forgepay/docs/launch/10-mode2-activity-indexer.md), [`11-custody-backend.md`](./forgepay/docs/launch/11-custody-backend.md), [`13-company-register-didit.md`](./forgepay/docs/launch/13-company-register-didit.md)
- [`02-counsel-brief.md`](./forgepay/docs/launch/02-counsel-brief.md), [`12-popia-custody-attestations.md`](./forgepay/docs/launch/12-popia-custody-attestations.md) — the legal questions

**Operations and review**
- [`05-operations-runbook.md`](./forgepay/docs/launch/05-operations-runbook.md), [`04-conservative-launch.md`](./forgepay/docs/launch/04-conservative-launch.md), [`01-review-engagement.md`](./forgepay/docs/launch/01-review-engagement.md), [`forgepay/docs/security-review/`](./forgepay/docs/security-review)
- [`forgepay/docs/PLATFORM_OVERVIEW.md`](./forgepay/docs/PLATFORM_OVERVIEW.md) — architecture; [`forgepay/docs/PRICING_STRATEGY.md`](./forgepay/docs/PRICING_STRATEGY.md) / [`config/pricing.yaml`](./forgepay/config/pricing.yaml) — pricing source of truth

[`CLAUDE.md`](./CLAUDE.md) holds the rules for working in this repository (branch, upstream pins, security rules).

## Security

- Never commit keys, secrets or credentials. A secret scan blocks the build.
- Webhook signatures are HMAC-SHA256 and are verified before anything is processed.
- All card tokenization goes through the PCI vault in Hyperswitch; it is never disabled.
- Report a vulnerability privately — see [`SECURITY.md`](./SECURITY.md).

## Hyperswitch heritage

`crates/` is a fork of [Hyperswitch](https://github.com/juspay/hyperswitch), an open-source, Rust-based payment router originally built by [Juspay](https://juspay.io). It remains the card and bank processing core underneath FORGE Payments. See [Hyperswitch's own docs](https://docs.hyperswitch.io) for the router's architecture, and its [contributing guidelines](https://github.com/juspay/hyperswitch/blob/main/docs/CONTRIBUTING.md) if working on that layer.

## License

[Apache 2.0](./LICENSE). The separate custody backend repository is under the Elastic License 2.0.
