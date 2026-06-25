# ForgePay — Regulatory Business Plan

**Document type:** FCA PI Application — Section C (Business Plan)  
**Applicant:** ForgePay Ltd  
**PSR 2017 reference:** Regulation 7(1)(b); Schedule 2 para 1(c)  
**Prepared:** 25 June 2026  
**Version:** 1.0  
**Confidential — submitted to FCA only**

---

## 1. Executive Summary

ForgePay Ltd ("ForgePay") is a UK-incorporated payment technology company seeking authorisation as a **Payment Institution** under the Payment Services Regulations 2017. ForgePay provides a unified payment orchestration API enabling business merchants to accept card payments, stablecoin (USDC/USDT) transfers, cryptocurrency payments (BTC/ETH/LTC/XMR), and machine-to-machine AI agent payments via the x402 protocol.

ForgePay's core technology is built on **Hyperswitch**, an Apache 2.0-licensed open-source payment router originally developed by Juspay Technologies. ForgePay has forked and extended this platform, deploying it on AWS EKS in the eu-west-2 (London) region with multi-AZ resilience and OpenTelemetry observability.

ForgePay targets the growing segment of technology-first merchants — particularly SaaS companies, AI platforms, and crypto-native businesses — that require payment infrastructure capable of handling both traditional card rails and emerging digital asset payment methods within a single integration.

**Key financial metrics (projected):**
- Year 1: £[X] total payment volume; £[X] gross revenue
- Year 2: £[X] total payment volume; £[X] gross revenue
- Year 3: £[X] total payment volume; £[X] gross revenue (see `04_financial_projections.md` for detail)

ForgePay has identified a clear regulatory gap: there is no FCA-authorised payment processor that natively integrates card, stablecoin, and crypto payment acceptance with robust AML controls designed for the AI agent economy. ForgePay is positioned to fill this gap.

---

## 2. Company Structure

### 2.1 Legal Entity

| Field | Detail |
|---|---|
| Company name | ForgePay Ltd |
| Company type | UK Private Company Limited by Shares |
| Registered in | England and Wales |
| Companies House No. | [To be obtained on incorporation] |
| Registered address | [UK address — to be confirmed] |
| Principal place of business | [UK address] |
| Accounting reference date | 31 March |

### 2.2 Ownership Structure

ForgePay Ltd is owned as follows (to be updated upon incorporation):

| Shareholder | Shareholding % | Role |
|---|---|---|
| [Founder 1 name] | [X]% | CEO |
| [Founder 2 name] | [X]% | CTO |
| [Investor / SEIS fund] | [X]% | Investor — no management role |

No shareholder holds a qualifying holding (>10%) in any other FCA-regulated entity. Full qualifying holding notifications are included in Application Section A.

### 2.3 Group Structure

ForgePay Ltd is not currently part of a wider group. If a holding company structure is established prior to FCA authorisation, the FCA will be notified immediately.

### 2.4 Subsidiaries

None at application stage. Any future subsidiary that provides regulated payment services in another jurisdiction will be notified to the FCA as a material change.

---

## 3. Management Team

### 3.1 Board Composition

| Name | Role | FCA SMF | Summary of relevant experience |
|---|---|---|---|
| [CEO Name] | Chief Executive Officer | SMF1 (if applicable) | [X years] in payments / fintech [detail] |
| [CFO Name] | Chief Financial Officer | SMF2 (if applicable) | [X years] in financial management [detail] |
| [Compliance Name] | Head of Compliance | SMF16 | [X years] in payments compliance, MLR 2017 experience |
| [MLRO Name] | Money Laundering Reporting Officer | SMF17 | [X years] in AML, CAMS-certified (or equivalent) |
| [CTO Name] | Chief Technology Officer | Non-SMF | [X years] in payments engineering |

Full CVs, Individual Questionnaires, and Statements of Responsibilities are provided in Application Section K and supporting document `08_smf_declarations.md`.

### 3.2 Fitness and Propriety

All proposed SMF holders have undergone internal fitness and propriety assessments covering:
- Honesty, integrity, and reputation (criminal record checks, adverse media screening)
- Competence and capability (qualification and experience review)
- Financial soundness (credit checks, insolvency history)

Results of these assessments are available for FCA review on request.

### 3.3 Advisory Board / External Expertise

ForgePay has engaged (or intends to engage) the following external advisers:
- **Legal counsel:** [Law firm — FCA regulatory practice]
- **Compliance consultant:** [FCA compliance consultancy]
- **PCI QSA:** [Qualified Security Assessor firm]
- **External auditor:** [Accounting firm for annual accounts]

---

## 4. Services Offered — Detailed Description

### 4.1 Unified Payment Orchestration

ForgePay's primary service is **payment orchestration** — receiving payment instructions from merchant API calls, routing them to the optimal payment processor or blockchain network, handling responses, and remitting settlement to merchants.

The orchestration layer is implemented in the Hyperswitch Rust-based router (`crates/router`), which:
- Processes card payment requests (Visa, Mastercard, Amex)
- Initiates SEPA and UK Faster Payments transfers
- Broadcasts Bitcoin, Ethereum, Litecoin, and Monero transactions
- Submits USDC/USDT transfers via on-chain contract calls
- Routes x402 micropayment challenges and responses

### 4.2 Smart Routing

ForgePay's routing engine dynamically selects the best acquiring/processing route for each transaction based on configurable criteria:
- Geographic location of payer and payee
- Card BIN country and issuer
- Historical success rate per acquirer
- Cost (interchange + scheme fees + acquirer discount)
- Latency

This reduces payment failures and optimises merchant costs.

### 4.3 Unified Webhook / Event Stream

The **Unified Router** service (`forgepay/services/unified-router`, TypeScript/Fastify) normalises webhook events from all connected payment processors and blockchains into a single ForgePay event format, delivered to merchants via HMAC-SHA256-signed webhook.

### 4.4 Merchant Dashboard

The merchant dashboard (`forgepay/apps/dashboard`, Next.js 14) provides:
- Real-time transaction monitoring
- Payout and settlement reporting
- Dispute and chargeback management
- KYB status and compliance document management
- API key management and webhook configuration

### 4.5 Subscription and Billing Services

The **Billing Engine** (`forgepay/services/billing-engine`, Java/Kill Bill) provides:
- Recurring billing / subscription management
- USDC-native subscription billing (on-chain recurring payment initiation)
- Dunning management (failed payment retry logic)
- Pro-rata billing, trial periods, coupon management

### 4.6 Cryptoasset Payments

**Stablecoin Gateway** (`forgepay/services/stablecoin-gateway`, TypeScript):
- USDC and USDT payment acceptance
- x402 protocol payment handling for AI agent micropayments
- Real-time stablecoin to fiat conversion via integrated exchange partner

**Crypto Gateway** (`forgepay/services/crypto-gateway`, TypeScript):
- BTC (mainnet + Lightning), ETH, LTC, XMR acceptance
- Wallet address generation per transaction (never reuse addresses — AML control)
- Blockchain confirmation monitoring with configurable confirmation thresholds

---

## 5. Revenue Model

### 5.1 Revenue Streams

| Revenue Stream | Description | Indicative Rate |
|---|---|---|
| Card processing fee | % of transaction value + fixed per-transaction fee | 0.2–0.5% + £0.10–£0.25 |
| Stablecoin processing fee | % of USDC/USDT transaction value | 0.1–0.25% |
| Crypto processing fee | % of BTC/ETH/LTC transaction value | 0.5–1.0% |
| Monero processing fee | % of XMR transaction value (premium for enhanced AML) | 1.0–2.0% |
| SaaS dashboard fee | Monthly subscription for dashboard access | £49–£499/month |
| x402 micropayment fee | Per-call fee for AI agent payment routing | £0.001–£0.01 per call |
| Interchange share | Share of interchange revenue from acquirer | Variable (BIN-dependent) |
| FX conversion spread | Spread on crypto-to-fiat and cross-currency conversions | 0.5–1.0% |

### 5.2 Cost Structure

| Cost Category | Year 1 Estimate |
|---|---|
| Staff costs (8 FTEs) | £[X] |
| AWS infrastructure (EKS, RDS, KMS) | £[X] |
| Payment scheme / acquirer fees | £[X] |
| Compliance and legal (FCA, AML, PCI) | £[X] |
| External audit and QSA | £[X] |
| Office and general overhead | £[X] |

See `04_financial_projections.md` for full 3-year model.

### 5.3 Unit Economics

- Target blended take rate: 0.3–0.5% of processed volume
- Target gross margin: 60–70% after acquirer fees and infrastructure costs
- Target payback period per merchant: 6–9 months

---

## 6. Customer Acquisition Strategy

### 6.1 Direct Sales

ForgePay will hire a small commercial team (1–2 sales personnel in Year 1) targeting:
- UK-based AI companies requiring x402 payment infrastructure
- UK SaaS companies seeking USDC billing capabilities
- Crypto-native businesses seeking FCA-regulated payment acceptance

### 6.2 Developer Community

ForgePay will invest in open-source contributions to the Hyperswitch ecosystem and developer community engagement (conferences, GitHub presence, documentation quality) to drive organic adoption.

### 6.3 Partner Channel

ForgePay will establish referral agreements with:
- UK-based accountants and financial advisers serving fintech SMEs
- Crypto infrastructure providers and wallets
- AI infrastructure companies (LLM API providers, agent frameworks)

### 6.4 Merchant Onboarding

All merchants undergo a **KYB (Know Your Business)** onboarding process before processing live payments:
1. Business verification (Companies House / equivalent for non-UK)
2. UBO identification and verification (AML/CDD)
3. PEP and sanctions screening (OFAC, HMT, EU)
4. Business purpose and payment volume assessment
5. Risk scoring and tier assignment
6. Commercial agreement signature

High-risk merchant categories (gambling, adult content, pharmaceuticals, XMR-only merchants) are subject to enhanced due diligence and board approval.

---

## 7. Technology Overview

### 7.1 Architecture

ForgePay is a cloud-native, microservices-based platform:

```
Merchant API Request
        |
        v
[Hyperswitch Router — Rust/Actix-Web] (crates/router)
        |                |                |
        v                v                v
[Card Acquirers]  [Stablecoin GW]  [Crypto GW]
(Visa/MC/Amex)   (USDC/USDT/x402)  (BTC/ETH/LTC/XMR)
        |                |                |
        v                v                v
[Unified Router — TypeScript/Fastify] (forgepay/services/unified-router)
        |
        v
[Merchant Webhook — HMAC-SHA256 signed]
```

**Additional services:**
- **MoR Layer** (`forgepay/services/mor-layer`, Python/FastAPI): Merchant of Record tax calculation, checkout, and compliance
- **Billing Engine** (`forgepay/services/billing-engine`, Java/Kill Bill): Subscription management
- **Dashboard** (`forgepay/apps/dashboard`, Next.js 14): Merchant self-service portal
- **Marketing Site** (`forgepay/apps/web`, Next.js 14): Public-facing marketing

### 7.2 Infrastructure Security

- **Deployment:** AWS EKS (eu-west-2, London), multi-AZ across 3 availability zones
- **Secrets management:** HashiCorp Vault (not hardcoded in Kubernetes manifests or Helm values)
- **Encryption at rest:** AWS KMS-managed keys for all RDS databases and S3 buckets
- **Encryption in transit:** TLS 1.3 mandatory for all internal and external communications
- **Observability:** OpenTelemetry (OTEL) traces, metrics, and logs exported to AWS CloudWatch + Grafana
- **Network isolation:** All services run in private VPC subnets; only API gateway exposed to internet

### 7.3 PCI DSS Compliance

ForgePay's card tokenisation architecture is designed for **PCI DSS v4.0 compliance**:
- The **Hyperswitch Vault** (PCI DSS Level 1 component) handles all card data
- No PAN (Primary Account Number) is stored outside the Vault in plaintext
- ForgePay's operational systems are out of PCI DSS CDE scope for PAN storage
- Annual PCI DSS QSA assessment will be conducted before card processing commences

### 7.4 Card Data Policy

Per ForgePay's security rules:
- The Hyperswitch PCI vault is never disabled — all card tokenisation is mandatory
- Vault bypass is a critical security violation subject to immediate incident response
- Tokenised payment instruments are stored using format-preserving encryption

### 7.5 Resilience and Availability

- **Target SLA:** 99.9% monthly uptime for payment API
- **RTO:** 4 hours (see `09_operational_resilience_policy.md`)
- **RPO:** 1 hour
- Multi-AZ EKS ensures single-AZ failure does not cause service outage
- AWS RDS Multi-AZ standby provides automatic database failover within ~60 seconds
- Payment data is replicated across AZs in real time

---

## 8. Risk Management Framework

### 8.1 Key Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Card scheme de-risking | Medium | High | Multiple acquirer relationships; Mastercard and Visa direct engagement |
| Crypto exchange partner failure | Medium | Medium | Multiple exchange partner relationships for on/off-ramp |
| FCA authorisation delay | High | High | Conservative timeline planned; no regulated services commenced before authorisation |
| AML regulatory action | Low | Very High | Dedicated MLRO; automated transaction monitoring; external AML audit |
| Cyber attack / data breach | Medium | High | PCI DSS compliance; penetration testing; SOC2 in roadmap |
| Key person risk | Medium | High | Documented succession plans; cross-training |
| Acquirer withdrawal | Low | High | Secondary acquirer onboarded; 90-day exit clause required in contracts |

### 8.2 Risk Governance

The Board of Directors is responsible for setting ForgePay's risk appetite and reviewing material risks quarterly. The MLRO and Compliance Officer report to the Board on financial crime and regulatory risk. The CTO reports on technology and cyber risk.

A formal **Risk Register** is maintained and reviewed at each Board meeting. Material changes to the risk profile are reported to the FCA under PSR 2017 reg 29.

### 8.3 Outsourcing Risk

ForgePay's primary outsourcing dependency is **Amazon Web Services (AWS)**, which hosts all production infrastructure. ForgePay mitigates this by:
- Multi-AZ deployment (partial resilience to single datacentre failure)
- Regular Business Continuity testing including simulated AWS region failure
- Documented exit plan for migration to alternative cloud provider (estimated 12-week migration)

FCA Outsourcing Policy (FG13/3) obligations are addressed in ForgePay's Third-Party Risk Management Policy.

---

## 9. Three-Year Summary Narrative

### Year 1 (Post-Authorisation)
ForgePay will focus on:
- Completing PCI DSS QSA assessment and commencing card processing
- Onboarding first 20–50 merchants
- Establishing safeguarding account and reconciliation processes
- Completing FCA Cryptoasset Registration for stablecoin/crypto services
- Achieving operational MLRO function and AML monitoring

**Capital adequacy:** ForgePay will maintain capital equal to or exceeding the higher of €125,000 and the applicable fixed overhead method calculation throughout Year 1, when payment volumes are expected to be below the payment volume method threshold.

### Year 2
ForgePay will:
- Scale to 100–500 active merchants
- Launch x402 AI agent payment product
- Expand to EEA merchants (where UK-EEA cross-border payments are within PSR 2017 scope)
- Achieve breakeven at the operating level

**Capital adequacy:** Review whether fixed overhead or payment volume method produces the higher requirement; maintain appropriate buffer.

### Year 3
ForgePay will:
- Scale to 1,000+ active merchants
- Explore EEA Payment Institution licence (if UK PI passport not available post-Brexit)
- Assess whether Electronic Money Institution (EMI) authorisation is required for wallet/e-money features
- Target profitability

See `04_financial_projections.md` for detailed financial model.

---

## 10. Consumer Duty

ForgePay's customers are exclusively B2B merchants (businesses, not retail consumers). Consumer Duty (FCA PS22/9) applies where the end-user of the payment journey is a retail consumer, even if ForgePay's direct customer is a merchant. ForgePay's obligations include:

- Ensuring merchant onboarding materials and integration documentation are clear and not misleading
- Flagging to merchant clients their own Consumer Duty obligations in payment acceptance contexts
- Maintaining a complaints handling procedure accessible to merchant clients (DISP rules)

ForgePay does not design or price retail payment products directly and is not a consumer-facing entity. Consumer Duty obligations are proportionate and primarily implemented through merchant contractual terms.

---

*Document version: 1.0 — 25 June 2026*  
*Owner: CEO / Compliance Officer*  
*Confidential — FCA submission only*
