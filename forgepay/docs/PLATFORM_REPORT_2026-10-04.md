# FORGE / ForgePay: the whole platform, who it is for, and what is ready

4 October 2026. Built from a read of every service, app, contract, infrastructure file and company document in this repository, the
test runs of 3 October, and the launch work of the last weeks. Claims about code come from reading the code (file and line references are in the survey notes; the launch-path items were
also tested). Statements that come only from a company document say so. **"Real" means the code does the thing; it does not mean tested against
the real world, secure, or licensed.**

---

## 1. The company, as its documents describe it

- **Entity:** Forge Pay (Pty) Ltd, Johannesburg, South Africa (CIPC number, address and incorporation date are placeholders in the
  FSCA pack). A UK ForgePay Ltd is planned, not formed. Infrastructure planned in AWS af-south-1 (Cape Town).
- **What it says it is** has moved three times:
  - April 2026 (`FORGEPAY.md`): "Payments, forged better", a developer-first Stripe/Paddle competitor with Merchant of Record.
  - May 2026 (`docs/EXECUTIVE_SUMMARY.md`): "the autonomous-agent-native payment platform".
  - Now (website): "The financial infrastructure company for the agentic age", led by **"the credit bureau for AI agents"**, "five
    products, one underlying ledger".
- **Thesis:** one signed event log across every payment rail (the "Revenue Ontology"), and a reputation graph of AI agents as the moat.
- **Revenue lines stated:** payment fees (0.5-2.5% depending on rail), monthly SaaS fees, FX spread, bureau subscriptions and pulls
  (with a revenue share paid to data furnishers), and enterprise treasury fees ($5k-50k/month). Forecasts in different documents range
  from ~$510k ARR at month 12 to ~$8.6M in year 1; they are not reconciled with each other.
- **The current plan (October):** launch **the credit bureau only**, USDC only on Base, every payout approved by a person, small limits.
  Custody later. Payments, Merchant of Record and treasury only after licensing.

## 2. The five products and what implements them

| Product (as marketed) | What it is for | Main code |
|---|---|---|
| **Credit Bureau** | Scores, reports and verification of AI agents, for lenders | `agent-credit-bureau`, plus `agent-identity`, `agent-decision-framework`, `agent-negotiation`, `agent-liquidity-manager`, `agent-credit-lines`, `compliance-monitor`, `stablecoin-gateway` (billing and furnisher payouts), `on-chain/` (Mode 2) |
| **Payments** | Cards, bank transfers, stablecoins, crypto, x402, subscriptions, Merchant of Record | Hyperswitch fork (repo root), `unified-router`, `mor-layer`, `billing-engine`, `stablecoin-gateway`, `crypto-gateway`, `bank-connectivity`, `accounts-service`, `email-service`, SDKs |
| **Treasury** | Consolidate balances, net intercompany flows, sweep idle cash to yield / tokenised T-bills | `enterprise-treasury`, `yield-engine`, `rwa-registry`, `liquidity-forecaster`, `institutional-reporting`, `bank-connectivity` |
| **Custody** | Institutional MPC custody with policies and multi-approver sign-off | `openfireblocks` (signer, nodes, governance gateway), `forge-custody` (older, orphaned) |
| **Wallet** | Keyless wallets for people and AI agents | `open-privy` (the one the console uses), `forge-wallet` (older) |
| Also | Bank white-label console; console app; marketing site; VS Code extension; dashboard hub | `bank-whitelabel`, `apps/platform`, `website`, `apps/vscode-extension`, `apps/dashboard-hub` |

---

## 3. Platform by platform

Each section: **who it is for** -> **what is real** -> **what is not** -> **launch verdict**.

### 3.1 Credit Bureau (the launch candidate)

**Target market** (website and pricing): banks and insurers underwriting at volume; fintechs and smaller lending or DeFi protocols; bank
white-label partners; agent operators verifying their own agents; agent builders on ElizaOS, AutoGen, CrewAI, LangChain, Swarms. Price:
Observer $0, Growth $1,000/mo, Institutional $4,000/mo, Network $12,000/mo; pay-per-pull $2.80 falling to $2.00. First customers:
lenders or protocols that already see agent traffic.

**Real:** credit files and scores, lender underwriting reports with reason codes, signed consent bound to agent/lender/purpose, disputes
that change the record and re-score, furnisher ingest with revenue share, prepaid billing and top-ups through the stablecoin gateway,
furnisher payouts in USDC. 393 tests pass. This round fixed: double-credit of top-ups, payout authorisation, idempotency squatting,
the hold on ZARP/OUSD, and **(today) a fresh production database being seeded with demo agents and active demo furnishers whose keys are
published in `.env.example`** (anyone could have fabricated credit history; production now starts empty).

**Not real or weak:**
- The score is a hand-written FICO-style formula (35/30/15/10/10), not a model trained on outcomes. That is defensible for launch if it
  is described honestly; it is not "predictive power" in the sense the console's case studies claim.
- **"Mode 2" (on-chain) is empty in practice:** contracts are on Base Sepolia only, the bureau never writes the transaction stats it
  reads, ETH is priced at a fixed $2,500, so every agent returns "insufficient on-chain history".
- The agent's reputation inputs come from `agent-identity`, where every agent starts at 500 and the owning merchant can post its own
  "success" events: **reputation can be manufactured**. KYB (company register) is unconfigured; identity verification falls back to a heuristic.
- No real furnishers exist yet; disputes do not notify furnishers.
- Legal: whether an "agent credit bureau" touches the National Credit Act, POPIA, FSCA's crypto-asset rules, FIC obligations, and
  whether the name itself is allowed, is unanswered.

**Verdict:** closest to launch, **not yet**. Gates: independent review, counsel, real infrastructure and the USDC dust tests, a rehearsed
on-call. Sell only: profile, ingest, consent, report, lender report, disputes, top-ups. Do not sell credit lines, negotiation, decisioning
or Mode 2.

#### The rest of the agent stack (sold as part of the bureau)

| Service | Who it is for | Real | Not real | Verdict |
|---|---|---|---|---|
| `agent-identity` | Agent developers, merchants | `did:forge` ids, KYAPay JWT import, ES256 tokens + JWKS | Not resolvable W3C DIDs; reputation self-postable; **`/v1/verify-signature` always returns invalid** (wrong Node call for Ed25519) | Fix before the bureau relies on it |
| `agent-negotiation` | Agent-to-agent commerce | Offer/counter/accept sessions | Escrow is an internal IOU ledger, admin-funded, **lost on restart**; advertised auctions missing | Not launchable |
| `agent-credit-lines` | Lenders to agents | Line bookkeeping | **Lends nothing**: a draw lowers a number; anyone can open a line at any limit; reads reputation on the wrong scale (0-100 vs 0-1000) | Not launchable |
| `agent-decision-framework` | Agent operators | Deterministic approve/review/reject rules | All in memory; same scale bug | Not launchable |
| `agent-liquidity-manager` | Agent operators | Allocation bookkeeping | Hard-coded prices (ETH $3,200, BTC $68,000); calls yield-engine endpoints that do not exist | Not launchable |

### 3.2 Payments

**Target market:** across documents: SaaS (bootstrapped to $100k MRR), marketplaces, AI services, cross-border sellers, fintech platforms,
"high-chargeback merchants (gaming, crypto, gambling-adjacent)"; in South Africa SME e-commerce, gig platforms, crypto-native businesses,
USD-billing SaaS, USDC-to-ZAR remittance recipients; in the UK, AI and SaaS companies. Pricing conflicts across documents (Free $0 / $28
plan at 2.8%/2.4% + $0.24 cards and 1.8%/1.4% stablecoins on the website, other figures elsewhere).

**The honest summary: card and bank payments for merchants do not work end to end.**

| Piece | Real | Broken or missing |
|---|---|---|
| Hyperswitch (repo root) | Upstream router, pinned; dev uses the upstream image | **No ForgePay change to it**; no connector (Stripe, Peach) configured; one ForgePay merchant key for everyone, no per-merchant onboarding; the ZK file added is dead stub code |
| `unified-router` | Event bus: signed webhooks, dedup, Postgres, merchant fan-out; ForgePay's own plan checkout | **Rejects every real Hyperswitch webhook** (expects SHA-256, Hyperswitch signs SHA-512; expects Stripe-style event names); plan checkout **charges the card, then fails** provisioning (plan names don't match the Kill Bill catalogue) |
| `mor-layer` (Merchant of Record) | Checkout, tax tables, Avalara/TaxJar calls | Same webhook mismatch, so sessions never complete; **no merchant payout or settlement at all**; VAT/OSS/US tax filing simulated; remittance calls endpoints that don't exist. Not a Polar fork in practice. Needs Python 3.12 |
| `billing-engine` (Kill Bill) | Kill Bill config, 3-plan catalogue | Plugin **cannot load** into real Kill Bill (shim classes, no activator) and calls a Hyperswitch endpoint that doesn't exist; Docker build likely fails |
| `stablecoin-gateway` | **Well built**: USDC on Base deposits, settlement, payouts, sweeps, treasury, alerts, reconciliation, leader lock | Shielded (ZK) path accepts any proof (off by default); ZARP/OUSD on hold |
| `crypto-gateway` | BTC/LTC/XMR/ETH invoices, HD addresses, price feed | "50+ coins" is 4; ETH needs effectively zero confirmations; **no sweeping or payout**; one seed for all merchants |
| `bank-connectivity` | Plaid (US ACH) link and transfers | UK Open Banking adapter unlikely to work with a real bank; **no South African rail** (no Stitch/EFT); wire and stablecoin "settlements" are **fabricated references in memory** |
| `bank-whitelabel` | Admin console for SA banks (customers, limits, reports) | Entirely in memory; no money moves |
| `accounts-service` | Stored-value USD/USDC accounts, Onfido, Circle | **Sanctions screening always returns "no match" even in production** (fails open); **Onfido approves every completed check** regardless of result |
| `email-service` | none | One file; "sends" by `Math.random()`; not deployed (the console sends mail itself) |

**Verdict: not launchable.** Also licence-blocked: operating as a payments provider or Merchant of Record without the FSCA/SARB position
settled is, per the company's own August document, an offence. Realistic only after licensing, connectors, the webhook contract, a
settlement path and a South African rail exist.

### 3.3 Custody

**Target market:** treasuries and funds, institutions; "design partners" first (website marks it "Pilot · testnet").

**Real (`openfireblocks`):** per-workspace threshold keys (2-of-3) with real distributed key generation and signing across separate
processes, mutual TLS, shares sealed by Vault/KMS, resharing, encrypted backups and a restore drill, node-side policy limits, signer
votes that must be **signed by each signer's own key**, sealed proposals, signer API mutual TLS enforced in production, a topology
check for separate hosts, officer ceremony tooling. EVM only. Full Go suite and 125 gateway tests pass.

**Not real or not done:** never run on separate hosts; no real officer drill; no independent review; no browser/hardware-token signing
(CLI only). The website's "4-of-7", "HSM shards in separate jurisdictions", staking, collateral mobility and off-venue settlement are
**not built**. `forge-custody` is a second, older custody service that **cannot sign against production openfireblocks** and is still
referenced by `unified-router`'s routing; it should be retired.

**Verdict:** not ready; the most engineered product after the bureau's gateway, and a later launch (scope-B review, separate infrastructure,
real officers, licensing as a custodian).

### 3.4 Wallet

**Target market:** consumers and AI agents (keyless, social recovery).

- `open-privy` (the live one): real secp256k1 and Solana keys, encrypted per user, **but every user key derives from one master key**
  (custodial, single point of compromise); Ethereum is Sepolia-only; staking APY/TVL are mock numbers; account abstraction never ran end
  to end; in this repo its lockfile does not install and it does not typecheck; its "audit" is an AI-generated simulation.
- `forge-wallet` (older): "addresses" are hashes nobody controls (**funds sent there are lost**), the chain adapter is a dev stub
  everywhere, broadcast falls back to a fake hash with no production guard. Should be retired.

**Verdict:** not launchable. Holding consumer keys is also a licensing question (VASP / custodian).

### 3.5 Treasury, yield and tokenised assets

**Target market:** CFOs of high-volume platforms and enterprises ("Fortune 500 with 50-300 bank accounts", $5k-50k/month), crypto
platforms, funds.

| Service | Real | Not real |
|---|---|---|
| `enterprise-treasury` | Rules, netting, approval logic | Balances from an endpoint that doesn't exist (empty or stale data served silently); netting dispatch rejected or fabricated downstream; failed settlements dropped from the queue; sweeps call yield endpoints that don't exist; **no tenants**; default rule sweeps $5M+ to Aave without approval; console "approve" button only changes the screen |
| `yield-engine` | Reads Aave/Compound APY on-chain | Falls back to seeded APYs that look current; **one hot wallet for all merchants** (commingled); Ondo deposits fake; **withdrawals cannot execute in production** |
| `rwa-registry` | Ledger arithmetic | No tokenisation or chain access; **USDY priced as the ONDO governance token**; stale prices marked fresh; positions accepted with no payment, KYC or accreditation |
| `liquidity-forecaster` | Real ARIMA + Holt-Winters forecasting | Data contract with Hyperswitch unverified; alerts never delivered |
| `institutional-reporting` | Some reports read treasury/yield | **Tax "filing packets" and cash flows are fabricated numbers**; no authentication |

**Verdict:** not launchable. Several outputs (prices, tax packets, settled transfers) would mislead a customer or auditor today.

### 3.6 Compliance monitor (a dependency of every money product)

**Real:** OFAC SDN and EU list ingestion, fuzzy matching, Postgres for SAR/CTR/KYC/alerts, Chainalysis/Elliptic webhooks. Fixed in this
round: production service keys, and **screening no longer says "clear" when the list failed to load or is stale**. 144 tests pass.

**Missing:** UN, UK and South African lists; SAR filing only targets FinCEN and is unconfigured (**no goAML/FIC path for South Africa**);
no KYC provider; AML monitoring polls the payment engine without credentials and does not watch the stablecoin gateway.

**Verdict:** good enough to screen addresses for the bureau launch once deployed and proven; not a South African AML programme.

### 3.7 Console, website, SDKs, on-chain, infrastructure

- **Console** (`apps/platform`): every section shows live data or an honest empty state (no fake data). Auth, MFA, SSO, RBAC are real.
  Gaps: bureau/treasury/ontology data is **shared across tenants**; `/api/forge/health` is unauthenticated; **public pages carry
  fabricated case studies** ("R500K+ recovered", "+20% predictive power") and "99.7% uptime SLA / guaranteed" claims; no Helm chart and
  its deploy workflow will fail.
- **Website:** static; checkout depends on unified-router; **"Open beta, start taking payments in five minutes"** and **"Full PCI
  compliance, ISO 27001, SOC 2 Type II"** are not true; the deploy script uploads the wrong files; the CloudFront config is invalid JSON;
  four different domains are used.
- **SDKs and agent plugins:** cover payments, not the bureau; ElizaOS/Swarms plugins call `/v1/x402/pay`, which does not exist; the
  gateway's "x402" is a deposit-address flow, **not the x402.org protocol**.
- **On-chain:** five reputation contracts on Base Sepolia only, unaudited; the ZK verifier contract **accepts every proof** in its default
  stub mode; nothing on mainnet.
- **Infrastructure:** Terraform for AWS exists but **has never been applied**; Helm charts exist for most services, but **image wiring is
  broken** (charts pull images nobody publishes), there is **no console chart, no open-privy chart**, the umbrella chart omits custody and
  others, and the dev compose builds an app that doesn't exist. Delivery documents from June ("READY FOR MVP DEPLOYMENT", "79/100") are
  stale. The bureau's own path (gateway, bureau, console, openfireblocks images; gateway chart; launch values) is the one that has been
  brought to a lintable, renderable state.

---

## 4. Regulatory position (from the company's documents; not legal advice)

- **Nothing is licensed.** The FSCA pack is all "Draft"/"Pending"; August's readiness document says FSCA licensing "has not started" and
  that operating as Merchant of Record without it is an offence. No KYC vendor, no Chainalysis contract.
- The documents disagree with each other on what is needed (a "Money Transmitter License / MIL001" with R500k vs R1M capital; crypto as
  "not regulated as currency" vs FSCA-declared financial products needing crypto-asset service provider licensing; FIC, travel rule,
  exchange control). The October counsel brief treats all of it as open questions, correctly.
- UK (FCA) and US (FinCEN/state MTLs/BitLicense) packs exist as drafts; no entity, no filing.
- **Counsel's written view is the gate for every product, including the bureau.**

## 5. Claims to withdraw now (independent of any launch)

These are public or customer-facing and are not true today:
1. Console case studies with named customers and results (`apps/platform/app/case-studies`).
2. "99.7% success rate guaranteed / 99.7% uptime SLA" (`apps/platform/app/products/payments`).
3. Website "Open beta... start taking payments in five minutes" and "Full PCI compliance, ISO 27001, SOC 2 Type II".
4. "Merchant of Record in 200+ countries", "we're on the invoice, not you".
5. Custody "4-of-7", "HSM shards in separate jurisdictions", staking/collateral mobility, "processed real signed transfers" as a general claim.
6. Treasury "50+ banks", "25-40% fewer wires", "4-5% APY"; agents page "every piece of this stack is a real, running service".
7. "50+ coins"; x402 described as the open protocol.

## 6. Launch readiness at a glance

| Product / service | Primary target market | Code state | Can it launch? |
|---|---|---|---|
| Credit Bureau (+ stablecoin gateway, compliance monitor) | Lenders, DeFi protocols, agent operators | Real, hardened, tested | **Closest. Not yet:** review, counsel, real infra, dust tests, rehearsal |
| Agent identity | Agent developers | Partly real; signature check broken; reputation gameable | Only as the bureau's id lookup, after fixes |
| Negotiation, credit lines, decisioning, liquidity manager | Agent operators, lenders | Bookkeeping only, no money | No |
| Payments (cards/bank/MoR/billing/crypto) | SaaS, marketplaces, SA SMEs, cross-border sellers | Broken end to end; no settlement; no licence | No (licence + major build) |
| Stablecoin gateway (standalone, for merchants) | Crypto-native merchants | Real | Not for third parties until licensed |
| Bank white-label | South African banks | In-memory demo | No |
| Custody (openfireblocks) | Funds, treasuries, institutions | Real, deep; never on real infrastructure | Later: separate hosts, officers, review, licence |
| Wallet (open-privy) | Consumers, AI agents | Partly real, one master key, testnet | No |
| Treasury, yield, RWA, reporting | Enterprise CFOs, funds | Logic real, money and data paths fake or broken | No |
| Compliance monitor | Internal (all products) | Screening real; SA reporting missing | Yes, as the bureau's screen, once proven |
| Console | All customers | Real; tenancy gaps; false marketing pages | Bureau sections, after removing false claims |
| Website | Prospects | Static; overclaims; broken deploy | After the claims in section 5 are removed |

**Recommended order:** (1) remove the false claims; (2) bureau launch on the path in `docs/launch/00-LAUNCH-STEPS.md`; (3) custody with
design partners, after its own review, separate infrastructure and a real officer drill; (4) treasury and payments only after licensing,
and after rebuilding the money paths that are simulated today; (5) retire `forge-custody`, `forge-wallet`, `email-service` and
`dashboard-hub`, and decide whether `institutional-reporting`, `rwa-registry` and the agent-economy services are products or prototypes.
