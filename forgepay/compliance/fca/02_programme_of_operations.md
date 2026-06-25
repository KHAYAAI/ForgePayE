# ForgePay — Programme of Operations

**Document type:** FCA PI Application — Section B (Programme of Operations)  
**Applicant:** ForgePay Ltd  
**PSR 2017 reference:** Regulation 7(1)(b); Schedule 2 para 1(b)  
**Prepared:** 25 June 2026  
**Version:** 1.0  

---

## 1. Introduction

ForgePay Ltd ("ForgePay") applies for authorisation as a **Payment Institution** under the Payment Services Regulations 2017 (PSR 2017) to provide payment services to business merchants in the United Kingdom and internationally.

ForgePay operates a technology-first payment orchestration platform built on an open-source payment router core (Hyperswitch, Apache 2.0 licence). The platform routes card payments, bank transfers, stablecoin payments (USDC/USDT) and cryptocurrency payments (BTC, ETH, LTC, XMR) through a unified API, enabling merchants to accept multiple payment methods without integrating multiple providers.

This Programme of Operations sets out:
- The payment services ForgePay intends to provide
- The payment instruments and currencies handled
- The target market and customer segments
- Distribution and access channels
- Geographic scope
- Correspondent banking and settlement arrangements

---

## 2. Payment Services to Be Provided

ForgePay intends to provide the following payment services as defined in **PSR 2017, Schedule 1**:

### 2.1 Money Remittance (Schedule 1, Part 2, paragraph 6)

ForgePay will provide money remittance services enabling merchants to collect payments from their end-customers and receive settlement in the merchant's preferred currency (GBP, EUR, USD, USDC, or USDT). ForgePay does not hold payer funds beyond the time required for settlement (maximum T+2 for card-based flows; same-day for stablecoin flows).

**Scope:** Card-funded remittances, stablecoin transfers, crypto-to-fiat conversion settlements.

### 2.2 Payment Initiation Services (Schedule 1, Part 1, paragraph 7)

ForgePay may provide payment initiation services ("PIS") by initiating payment transactions from merchants' customers' payment accounts at third-party account-holding institutions, with the explicit consent of the customer. This is a planned capability dependent on Open Banking API integrations with UK-regulated account information service providers.

**Note:** PIS requires separate regulatory consideration and will be implemented only after authorisation with written FCA confirmation that the activity is within scope of ForgePay's authorisation.

### 2.3 Merchant Acquiring / Payment Processing (Schedule 1, Part 1, paragraphs 3 and 4)

ForgePay will provide payment processing and acquiring services, acting as a technical intermediary between merchants and card scheme acquirers. ForgePay's Hyperswitch-based router selects the optimal acquiring route for each transaction based on cost, success rate, and geographic availability.

ForgePay will operate as a **Payment Facilitator (PayFac)** model under card scheme rules, with sub-merchant onboarding under a master merchant acquiring agreement with one or more FCA-authorised or PRA-regulated acquiring banks.

### 2.4 Crypto and Stablecoin Payment Facilitation

ForgePay will facilitate acceptance of:
- **USDC** (USD Coin — ERC-20 and Solana) 
- **USDT** (Tether — ERC-20 and TRC-20)
- **BTC** (Bitcoin — Lightning Network and on-chain)
- **ETH** (Ethereum — ERC-20 native)
- **LTC** (Litecoin)
- **XMR** (Monero — subject to enhanced due diligence requirements)

> **Regulatory note:** Crypto payment facilitation falls within the FCA's Cryptoasset Business Registration regime under MLR 2017 Regulation 14A. ForgePay will submit a separate registration application. Crypto services will only commence after MLR 2017 registration is confirmed. See `10_fca_cryptoasset_registration.md`.

### 2.5 x402 AI Agent Payment Protocol

ForgePay will support the **x402 payment protocol**, an HTTP-based micropayment standard enabling AI agents and automated systems to initiate machine-to-machine payments. Each x402 payment is a discrete payment transaction authenticated by a cryptographic challenge-response mechanism.

From an FCA regulatory perspective, x402 payments are treated identically to standard merchant-initiated transactions: the same AML, sanctions screening, and transaction monitoring controls apply. ForgePay will discuss the x402 protocol with the FCA case officer at the pre-application meeting to confirm the regulatory characterisation.

---

## 3. Payment Instruments Accepted

| Payment Instrument | Networks | Settlement Currency |
|---|---|---|
| Visa (credit, debit, prepaid) | Visa Europe | GBP, EUR, USD |
| Mastercard (credit, debit, prepaid) | Mastercard | GBP, EUR, USD |
| American Express | Amex | GBP, USD |
| SEPA Credit Transfer | SEPA | EUR |
| Faster Payments (UK domestic) | UK Faster Payments | GBP |
| BACS Direct Debit | UK BACS | GBP |
| USDC | Ethereum, Solana | USDC (settled natively or converted to GBP/USD) |
| USDT | Ethereum, Tron | USDT (settled natively or converted to GBP/USD) |
| Bitcoin | Bitcoin mainnet + Lightning | BTC (converted to GBP/USD at settlement) |
| Ethereum | Ethereum mainnet | ETH (converted to GBP/USD at settlement) |
| Litecoin | Litecoin mainnet | LTC (converted to GBP/USD at settlement) |
| Monero | Monero mainnet | XMR (subject to enhanced controls — see AML policy) |

---

## 4. Target Market and Customer Segments

### 4.1 Primary Customer Segment

ForgePay serves exclusively **business-to-business (B2B) customers** — specifically, merchants and software platforms that need to accept online payments. ForgePay does not provide services directly to retail consumers (natural persons acting outside their trade or profession).

Target merchant types:
- **SaaS and subscription software companies** (requiring recurring billing, USDC settlement)
- **AI companies and agent platforms** (requiring x402 micropayment capabilities)
- **E-commerce merchants** requiring multi-currency, multi-method payment acceptance
- **Crypto-native businesses** requiring USDC/USDT settlement and on/off-ramp
- **Platforms and marketplaces** requiring sub-merchant onboarding and split payments

### 4.2 Customer Size

ForgePay initially targets small and medium enterprises (SMEs) with annual gross merchandise volume (GMV) of £50,000–£10,000,000. Enterprise merchants (>£10m GMV) will be onboarded after the platform has achieved operational maturity and regulatory authorisation.

### 4.3 Geographic Reach of Target Merchants

- **Priority markets:** United Kingdom, Republic of Ireland, Germany, Netherlands, France
- **Secondary markets:** Canada, Australia, Singapore, United States (where PSR 2017 scope permits)
- **Excluded markets (initial phase):** High-risk jurisdictions identified on FATF grey/blacklists, OFAC-sanctioned jurisdictions, and UK HMT asset freeze targets

---

## 5. Distribution Channels

### 5.1 Direct API Integration

Merchants integrate ForgePay directly via a RESTful payment API (compatible with Stripe's API surface to ease migration). Documentation is provided at `docs.forgepay.io`. Authentication uses API key pairs (publishable key + secret key) with optional webhook signing.

### 5.2 SDK Libraries

ForgePay publishes client libraries in:
- JavaScript / TypeScript (npm)
- Python (PyPI)
- Ruby (RubyGems)
- PHP (Composer)
- Go (pkg.go.dev)

### 5.3 Merchant Dashboard

A Next.js 14 web dashboard (`forgepay/apps/dashboard`) enables:
- Merchant self-service onboarding (KYB flow)
- Transaction monitoring and reporting
- Payout management and scheduling
- Dispute management
- API key management

### 5.4 No Consumer-Facing Channel

ForgePay does not operate a consumer-facing payment interface or wallet application. All ForgePay-branded interfaces are accessed exclusively by authorised merchant users.

---

## 6. Geographic Scope

### 6.1 UK Domestic Services

ForgePay will provide payment services for transactions where the payer, the payee (merchant), or both are located in the United Kingdom. UK domestic services include GBP Faster Payments, BACS, and card payment acceptance.

### 6.2 Cross-Border / EEA Services

ForgePay will enable cross-border payment acceptance for UK merchants receiving payments from EEA-based payers, and vice versa, within the scope of PSR 2017 as it applies post-Brexit (UK PSR 2017, as retained and amended by the Financial Services (Banking Reform) Act 2013 and subsequent UK instruments).

### 6.3 Third-Country Services

ForgePay enables UK merchants to accept payments from payers located outside the EEA (one-leg-out transactions). These transactions are within scope of ForgePay's AML obligations under MLR 2017 but are not subject to full PSR 2017 conduct requirements for the third-country leg.

### 6.4 Jurisdictions Not Served

ForgePay will maintain a **prohibited jurisdictions list** (reviewed quarterly) covering:
- OFAC-sanctioned countries (Cuba, Iran, North Korea, Syria, Russia — OFAC SDN list)
- UK HMT financial sanctions targets
- FATF blacklisted jurisdictions (currently Myanmar, as at June 2026)
- High-risk jurisdictions assessed by ForgePay's AML team as posing unacceptable ML/TF risk

---

## 7. Correspondent Banking and Settlement Arrangements

### 7.1 Card Acquiring

ForgePay will operate under a **master merchant / payment facilitator** agreement with one or more FCA-authorised or PRA-regulated UK acquiring banks. Candidate acquirers at application stage include (subject to commercial negotiation):
- [Acquiring bank name — to be confirmed]
- [Secondary acquirer for redundancy — to be confirmed]

Card settlement flows: Acquiring bank receives interchange net of scheme fees and acquirer discount; remits settlement (T+1 or T+2) to ForgePay's operational account; ForgePay remits to merchant's nominated bank account on agreed payout schedule.

### 7.2 UK Bank Transfers (Faster Payments / BACS)

ForgePay will access UK payment systems via an **Indirect Participant** arrangement with a directly connected payment service provider. ForgePay will not apply for direct scheme membership at initial launch.

### 7.3 Stablecoin Settlement

USDC and USDT settlements will be routed via ForgePay's **stablecoin gateway** (`forgepay/services/stablecoin-gateway`). Merchants may elect:
- **Native stablecoin settlement** — USDC/USDT remitted to merchant's on-chain wallet
- **Fiat off-ramp settlement** — USDC/USDT converted to GBP/USD via a registered crypto exchange and remitted via bank transfer

ForgePay will use only FCA-registered (MLR 2017) and/or MiCA-compliant virtual asset service providers (VASPs) for stablecoin on/off-ramp services.

### 7.4 Crypto Settlement

Native cryptocurrency settlements (BTC, ETH, LTC) follow the same model as stablecoin settlements. Monero (XMR) settlements will be subject to enhanced due diligence given its privacy-enhancing features (see `07_aml_policy.md` for XMR-specific controls).

---

## 8. Services Explicitly Not Provided

For the avoidance of doubt, ForgePay does not, and will not without separate authorisation:
- Issue electronic money (e-money) — not an EMI
- Provide credit or lending products
- Provide account information services (AIS) as a standalone AISP
- Act as a foreign exchange dealer as principal
- Provide investment services under FSMA
- Operate a cryptocurrency exchange (buy/sell for own account)
- Hold customer funds beyond the period required for payment execution (no e-wallet)

---

## 9. Technology Infrastructure

### 9.1 Payment Router

The core of ForgePay's platform is the **Hyperswitch payment router** (`crates/router`), an open-source payment orchestration engine written in Rust using the Actix-Web framework. The router:
- Handles all payment API requests
- Routes transactions to the optimal acquirer/processor
- Manages retry logic, cascading, and fallback routing
- Stores no card data in plaintext — all tokenisation goes through the Hyperswitch Vault (PCI DSS Level 1 compliant tokenisation)

### 9.2 Infrastructure

ForgePay's platform runs on:
- **AWS Elastic Kubernetes Service (EKS)** in the **eu-west-2 (London)** region
- **Multi-Availability Zone (multi-AZ)** deployment across three AZs for resilience
- **OpenTelemetry (OTEL)** instrumentation for distributed tracing, metrics, and logging
- **AWS RDS (PostgreSQL)** with multi-AZ standby for payment data persistence
- **AWS KMS** for encryption key management (encryption at rest for all PII and payment data)
- **HashiCorp Vault** for secrets management (API keys, database credentials)

### 9.3 Security Controls

- PCI DSS v4.0 in scope — annual QSA assessment required before card processing commences
- All card data tokenised via Hyperswitch Vault — PAN never stored in ForgePay systems
- TLS 1.3 in transit for all API communications
- Webhook signatures: HMAC-SHA256 with per-merchant secret keys
- OTEL-based anomaly detection feeding into transaction monitoring alerts

---

*Document version: 1.0 — 25 June 2026*  
*Owner: Compliance Officer*  
*Next review: Prior to FCA submission / upon material change*
