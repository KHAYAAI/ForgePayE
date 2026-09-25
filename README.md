<h1 align="center">FORGE</h1>
<p align="center"><strong>The Revenue Ontology</strong> — financial infrastructure for traditional finance, stablecoins, autonomous AI agents, and tokenized real-world assets, normalized into one canonical event.</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue" /></a>
  <img src="https://img.shields.io/badge/status-pre--mainnet-orange" />
</p>

<hr/>

## What FORGE is

Most companies run money through five disconnected systems — a card processor, a crypto wallet, a tax tool, a billing platform, a spreadsheet holding it together. FORGE replaces that with one ledger: every payment, on every rail, normalizes into the same signed `ForgePayEvent` schema. The rail becomes a parameter, not a decision.

Five products share that one ledger:

| Product | What it does | Service |
|---|---|---|
| **FORGE Credit Bureau** | Verifiable, dual-mode reputation scores for AI agents — DID identity, autonomous credit lines, agent-to-agent escrow, FCRA-style disputes | `services/agent-credit-bureau` |
| **FORGE Payments** | Card, bank, stablecoin and x402 machine-micropayment checkout in one API | `services/unified-router`, `services/stablecoin-gateway`, `services/crypto-gateway` |
| **FORGE Treasury** | Consolidate, net, and route cash across banks, wallets and gateways; sweep idle balances to yield | `services/enterprise-treasury` |
| **FORGE Custody** | Institutional MPC threshold signing (4-of-7), policy engine, multi-approver sign-off | `services/forge-custody` |
| **FORGE Wallet** | Keyless wallets with a verifiable DID, for people and AI agents alike | `services/forge-wallet` |

The marketing site (product pages, pricing, docs entry point) lives at [`forgepay/website`](./forgepay/website) — a static site deployed to S3 + CloudFront, no build step. The operator/merchant console lives at [`forgepay/apps/platform`](./forgepay/apps/platform) (Next.js).

## Status

**Not yet on mainnet.** The bureau's on-chain contracts (`ForgeReputationRegistry`, `ForgeTransactionValidator`, `ForgeBudgetEnforcer`, `ForgeCore`) are deployed and tested on Base Sepolia only. The scripted path to Base mainnet — 5-contract deploy, a 3-signer Safe multisig, two-phase admin handover — is written and ready in [`docs/MAINNET_DEPLOYMENT_WALKTHROUGH.md`](./forgepay/docs/MAINNET_DEPLOYMENT_WALKTHROUGH.md), but two things gate it ahead of anything mechanical:

- **A National Credit Act determination.** The bureau's data model allows agent operators to be natural persons, which may bring it into NCR-registration scope — needs an NCA-specialist attorney's opinion before launch, not after.
- **A signed sanctions-screening vendor contract** (Chainalysis or Elliptic). `compliance-monitor`'s OFAC check fails closed by design — no vendor configured means every lender report is declined, not silently approved.

The full seven-step path from here to a paying customer is in [`docs/LAUNCH_RUNBOOK.md`](./forgepay/docs/LAUNCH_RUNBOOK.md).

## Repository structure

This repo is two things layered together: a fork of [Hyperswitch](https://github.com/juspay/hyperswitch) (the Rust payment router at `crates/`, handling card/bank processing — see its own heritage below) underneath the FORGE platform proper, which lives entirely under `forgepay/`.

```
crates/                    Hyperswitch payment router (Rust) — forked, still the card/bank engine
forgepay/
├── apps/
│   └── platform/          Console — custody, wallet, treasury, credit bureau (Next.js)
├── website/                FORGE marketing site — static HTML/CSS/JS, no build step
├── services/                26 TypeScript/Python microservices — see table below
├── on-chain/                Solidity contracts + Foundry deploy scripts (Base)
├── infra/                   Kubernetes/Helm manifests, docker-compose
└── docs/                    Runbooks, architecture, pricing, security
```

### Services (`forgepay/services/`)

| Service | Role |
|---|---|
| `agent-credit-bureau` | Dual-mode agent credit scoring, disputes, billing, furnisher payouts |
| `agent-identity` | DID registry and resolution |
| `agent-decision-framework` | Real-time risk scoring and policy gates |
| `agent-negotiation` | Offer/counter-offer protocol and escrow between agents |
| `agent-liquidity-manager` | Auto-sweep and multi-currency rebalancing for agent wallets |
| `agent-credit-lines` | Net-30/60/90 credit lines issued to agents |
| `forge-custody` | Institutional MPC threshold signing, policy engine |
| `forge-wallet` | Keyless wallets, DID issuance |
| `enterprise-treasury` | Cash consolidation, netting, yield sweep |
| `accounts-service` | Stablecoin-backed USD/USDC accounts, deposits, withdrawals |
| `unified-router` | The internal event bus — normalizes every rail into `ForgePayEvent` |
| `stablecoin-gateway` | USDC/USDT/EURC across 5 chains, x402 native |
| `crypto-gateway` | BTC/ETH and 50+ coins, invoice-based |
| `mor-layer` | Merchant of record — tax calculation/collection/remittance, 200+ countries |
| `billing-engine` | Kill Bill-based subscription billing, usage metering |
| `rwa-registry` | Tokenized T-bills and money-market funds (BlackRock, Franklin Templeton, Ondo, OpenEden, Superstate) |
| `compliance-monitor` | OFAC/sanctions screening, SAR/CTR filing, KYC |
| `bank-connectivity`, `bank-whitelabel` | Open banking / white-label bank rails |
| `institutional-reporting`, `liquidity-forecaster`, `chain-sync`, `yield-engine`, `email-service` | Supporting services |
| `openfireblocks`, `open-privy` | Vendored MPC custody and identity forks |

## Quickstart

```bash
# Hyperswitch payment router (Rust) — from repo root
cargo build --release
cargo test

# Marketing site — pure static, no build step
open forgepay/website/index.html

# Any TypeScript service, e.g. the bureau
cd forgepay/services/agent-credit-bureau
npm install && npm run dev

# Everything together, local dev
docker compose -f forgepay/infra/k8s/docker-compose.dev.yml up
```

Each service documents its own required environment variables in its `.env.example` — most refuse to boot in production with a missing or placeholder secret by design (fail closed, not silently insecure).

## Documentation

- [`docs/PLATFORM_OVERVIEW.md`](./forgepay/docs/PLATFORM_OVERVIEW.md) — architecture, service-by-service
- [`docs/LAUNCH_RUNBOOK.md`](./forgepay/docs/LAUNCH_RUNBOOK.md) — the seven steps from code to a paying customer
- [`docs/MAINNET_DEPLOYMENT_WALKTHROUGH.md`](./forgepay/docs/MAINNET_DEPLOYMENT_WALKTHROUGH.md) — command-by-command Base mainnet deploy
- [`docs/PRICING_STRATEGY.md`](./forgepay/docs/PRICING_STRATEGY.md) / [`config/pricing.yaml`](./forgepay/config/pricing.yaml) — pricing source of truth
- [`forgepay/website/README.md`](./forgepay/website/README.md) — deploying the marketing site

## Hyperswitch heritage

`crates/` is a fork of [Hyperswitch](https://github.com/juspay/hyperswitch), an open-source, Rust-based payment router originally built by [Juspay](https://juspay.io). It remains the card/bank processing core underneath FORGE Payments. See [Hyperswitch's own docs](https://docs.hyperswitch.io) for the router's own architecture, and its [contributing guidelines](https://github.com/juspay/hyperswitch/blob/main/docs/CONTRIBUTING.md) if working on that layer specifically.

## License

[Apache 2.0](./LICENSE).
