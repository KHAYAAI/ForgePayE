# ForgePay — Regulatory Business Plan
## FSCA Payment Service Provider License Application

**Document Classification:** Confidential — Regulatory Submission
**Version:** 1.0
**Date:** 2026-06-25
**Prepared By:** Chief Executive Officer and Chief Compliance Officer

---

## 1. Company Overview

### 1.1 Legal Entity

| Field | Detail |
|---|---|
| **Company Name** | ForgePay (Pty) Ltd |
| **Registration Number** | [CIPC Registration Number] |
| **Registered Address** | [Registered Office Address], South Africa |
| **Business Address** | [Principal Place of Business], South Africa |
| **Jurisdiction of Incorporation** | Republic of South Africa |
| **Date of Incorporation** | [Date] |
| **Company Type** | Private Company (Proprietary Limited) |
| **Financial Year End** | [Month] |
| **Authorised Share Capital** | [Amount] |
| **Issued Share Capital** | [Amount] |
| **Tax Reference Number** | [SARS Tax Number] |
| **VAT Registration Number** | [VAT Number] |

### 1.2 Directors and Key Management

| Name | Role | Nationality | Appointment Date |
|---|---|---|---|
| [Director 1] | Chief Executive Officer | [Nationality] | [Date] |
| [Director 2] | Chief Financial Officer | [Nationality] | [Date] |
| [Director 3] | Chief Technology Officer | [Nationality] | [Date] |
| [Director 4] | Non-Executive Director | [Nationality] | [Date] |

### 1.3 Shareholders and Ultimate Beneficial Owners

| Name | Entity Type | % Holding | Country |
|---|---|---|---|
| [Shareholder 1] | [Individual/Company] | [%] | [Country] |
| [Shareholder 2] | [Individual/Company] | [%] | [Country] |

All shareholders holding 25% or more are identified as Ultimate Beneficial Owners (UBOs) in terms of the FIC Act and Company Act requirements.

### 1.4 Group Structure

ForgePay (Pty) Ltd is the primary South African operating entity. [Describe any holding company, offshore entities, or subsidiaries. Attach organogram.]

---

## 2. Business Model

### 2.1 What ForgePay Does

ForgePay is a payment orchestration platform that enables South African merchants — from sole traders to enterprise retailers — to accept payments across multiple rails through a single integration. ForgePay acts as a technical intermediary and, where licensed, as a payment service provider transmitting funds on behalf of merchants.

**Core value proposition:** A single API endpoint that intelligently routes transactions across card networks, bank transfer systems, stablecoin rails, and crypto networks — selecting the lowest-cost, highest-reliability path in real time.

### 2.2 Payment Rails Supported

| Rail | Currency | Settlement | Regulation |
|---|---|---|---|
| Card (Visa, Mastercard) | ZAR, USD, EUR | T+1 to T+3 | FSCA PSP license; card scheme rules |
| EFT / Bank Transfer | ZAR | T+0 to T+1 | NPS Act; SARB |
| USDC (USD Coin) | USDC (USD-pegged) | Near-instant | FSCA; SARB exchange control |
| USDT (Tether) | USDT (USD-pegged) | Near-instant | FSCA; SARB exchange control |
| Bitcoin (BTC) | BTC | 10-60 minutes | CASP registration (TBC) |
| Ethereum (ETH) | ETH | 1-5 minutes | CASP registration (TBC) |
| Litecoin (LTC) | LTC | 2-5 minutes | CASP registration (TBC) |
| Monero (XMR) | XMR | 2-5 minutes | CASP registration (TBC); enhanced KYC required |
| x402 (AI agent payments) | USDC / fiat | Near-instant | Covered by PSP license; novel protocol |

### 2.3 Revenue Model

| Revenue Stream | Mechanism | Estimated % of Revenue (Year 1) |
|---|---|---|
| Transaction fees | Percentage of GMV (0.5%–2.5% depending on rail) | 65% |
| Monthly platform fees | SaaS subscription per merchant tier | 20% |
| FX spread | On cross-currency settlement | 10% |
| Premium features | AI routing, advanced analytics, dedicated support | 5% |

### 2.4 Merchant-of-Record (MoR) Services

ForgePay's `mor-layer` service (built on a Polar fork, Python FastAPI) acts as the Merchant of Record for qualifying merchants. In MoR mode:
- ForgePay contracts directly with payment networks.
- ForgePay assumes liability for chargebacks, fraud, and regulatory compliance.
- Merchants operate under ForgePay's license umbrella.
- ForgePay collects payments, deducts fees, and remits net proceeds to merchants.

This MoR arrangement requires ForgePay to hold a valid PSP license and to maintain adequate capital and insurance as detailed in `06_financial_requirements.md`.

---

## 3. Products and Services

### 3.1 Unified Payment API

The core product is a REST API (hosted on AWS EKS af-south-1) that provides:
- **Payment intent creation:** Merchant specifies amount, currency, and preferred rails.
- **Intelligent routing:** The router selects the optimal acquirer/gateway based on cost, success rate, and latency (powered by Hyperswitch's Rust-based routing engine).
- **Tokenization:** All card data is immediately tokenized via the Hyperswitch vault before storage or transmission — no plain-text PANs are ever stored by ForgePay.
- **Webhook normalisation:** The `unified-router` service (TypeScript/Fastify) normalises events from all payment gateways into a single webhook schema delivered to merchants.
- **Settlement:** Net proceeds settled to merchant bank accounts on T+1 or T+3 schedule depending on tier.

### 3.2 Merchant Dashboard

A Next.js 14 web application providing merchants with:
- Real-time transaction views and reports
- Dispute / chargeback management
- Payout scheduling and bank account management
- KYC/KYB status tracking
- AML alert notifications (where applicable to merchant)

### 3.3 Stablecoin Gateway

The `stablecoin-gateway` (TypeScript) enables merchants to accept USDC and USDT payments:
- Integrates with Circle's API for USDC issuance/redemption
- Supports on-chain and off-chain USDC via x402 protocol for AI agent-initiated payments
- Automatic conversion to ZAR at merchant request (subject to SARB exchange control)

### 3.4 Crypto Gateway

The `crypto-gateway` (TypeScript) enables BTC, ETH, LTC, and XMR acceptance:
- Generates unique deposit addresses per transaction
- Monitors blockchain for confirmations
- Converts to USDC or ZAR at settlement (merchant option)
- XMR accepted with enhanced KYC given privacy coin characteristics

### 3.5 x402 AI Agent Payments

ForgePay implements the x402 HTTP-native micropayment protocol, enabling AI agents to pay for API services autonomously using USDC on supported chains. This is a novel product; ForgePay applies AML controls to all x402 payments regardless of size, given the automated nature of the payment initiation.

---

## 4. Market Analysis

### 4.1 South African Payments Market

South Africa's digital payments market is one of the largest and fastest-growing on the African continent:
- Total digital payments volume: approximately R 5.4 trillion per year (SARB, 2025 estimate)
- E-commerce market size: approximately R 100 billion per year and growing at 15% CAGR
- Smartphone penetration: approximately 80% of adults (2025)
- Banked population: approximately 80% of adults; financial inclusion expanding through mobile wallets
- Unbanked/underbanked: approximately 20% of adults, representing an opportunity for crypto/stablecoin rails

Key trends driving ForgePay's market opportunity:
- Crypto-asset adoption among South African adults (6th highest globally by Chainalysis adoption index)
- SARB Intergovernmental Fintech Working Group (IFWG) policy evolution supporting innovation
- Cross-border payment demand (South Africa–SADC corridor)
- AI agent economy: growth in programmatic spending requires x402-style payment infrastructure

### 4.2 Competitive Landscape

| Competitor | Rail Focus | Weakness ForgePay Exploits |
|---|---|---|
| PayFast (DPO Group) | Card, EFT | No crypto/stablecoin; limited routing intelligence |
| Peach Payments | Card, mobile | No crypto; limited multi-currency |
| Ozow | EFT-only | No card, no crypto |
| Yoco | Card-only (SME) | No online payments; no crypto |
| Binance Pay | Crypto-only | No card; no ZAR settlement |
| BitPay | Crypto-only | No SA focus; no ZAR settlement |

ForgePay's differentiation: unified multi-rail orchestration with AI-powered routing, native crypto and stablecoin support, and South African regulatory compliance across all rails.

### 4.3 Target Market Segments

1. **E-commerce merchants (SME):** Retailers, subscription services, digital goods sellers.
2. **Gig economy platforms:** Driver platforms, freelance marketplaces requiring fast settlement.
3. **Crypto-native businesses:** NFT platforms, DeFi tools, blockchain gaming.
4. **SaaS providers:** Companies billing international customers in USD wanting USDC settlement.
5. **Remittance recipients:** Individuals receiving funds from diaspora (USDC → ZAR).
6. **AI-native companies:** Businesses building AI agents that need x402 payment infrastructure.

---

## 5. Organisational Structure

### 5.1 Board of Directors

The board consists of [N] directors, including at least [N] non-executive directors. The board is responsible for:
- Setting strategic direction and risk appetite
- Approving material policies (AML/CFT, IT Security, Compliance)
- Overseeing management's execution of the compliance programme
- Reviewing and approving financial statements

Board committees:
- **Audit and Risk Committee:** Oversees financial reporting, internal audit, and risk management
- **Compliance Committee:** Reviews AML/CFT programme; receives quarterly compliance reports

### 5.2 Key Management Roles

**Chief Executive Officer (CEO)**
- Overall strategic and operational leadership
- Primary relationship with FSCA
- Accountable for regulatory compliance

**Chief Financial Officer (CFO)**
- Financial reporting and capital adequacy
- Client funds safeguarding oversight
- Signatory on financial regulatory submissions

**Chief Technology Officer (CTO)**
- Platform architecture and security
- PCI DSS compliance
- POPIA data protection (technical controls)

**Chief Compliance Officer (CCO)**
- FSCA license management
- Policy framework ownership
- Regulatory reporting and liaison

**Anti-Money Laundering Compliance Officer (AMLCO)**
- FIC Act compliance
- Transaction monitoring oversight
- SAR preparation and FIC reporting

**Data Protection Officer (DPO)**
- POPIA compliance
- Data subject rights management
- Privacy impact assessments

### 5.3 Staffing Plan

| Role | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Engineering (platform) | 6 | 10 | 15 |
| Engineering (security) | 1 | 2 | 3 |
| Compliance (CCO + AMLCO + DPO) | 3 | 4 | 5 |
| Customer Success / Merchant Support | 2 | 5 | 8 |
| Finance | 2 | 3 | 4 |
| Sales and Marketing | 2 | 4 | 6 |
| **Total** | **16** | **28** | **41** |

---

## 6. Financial Projections (3-Year)

### 6.1 Key Assumptions

- Payment processing margin: 0.5%–2.5% of GMV net of acquirer / network fees
- GMV growth: Conservative estimate; based on 50 merchants at launch scaling to 500+ by Year 3
- Average transaction value: R 850 (Year 1), growing with enterprise adoption
- Chargeback rate: 0.5% of GMV (industry benchmark; ForgePay targets <0.3% via ML fraud scoring)
- Operating expenses include compliance, technology, and staffing as above

### 6.2 Revenue Projections

| Metric | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Active Merchants | 50 | 200 | 500 |
| GMV (ZAR millions) | 120 | 480 | 1,500 |
| Blended Take Rate | 1.2% | 1.1% | 1.0% |
| **Gross Revenue (ZAR millions)** | **1.44** | **5.28** | **15.00** |
| Platform Fees Revenue | 0.36 | 1.20 | 3.00 |
| FX Revenue | 0.18 | 0.60 | 1.80 |
| **Total Revenue (ZAR millions)** | **1.98** | **7.08** | **19.80** |

### 6.3 Operating Expenses

| Expense | Year 1 (ZAR m) | Year 2 (ZAR m) | Year 3 (ZAR m) |
|---|---|---|---|
| Staff costs | 4.80 | 8.40 | 12.30 |
| Technology / infrastructure | 1.20 | 2.40 | 4.20 |
| Compliance (external audit, legal) | 0.60 | 0.80 | 1.00 |
| Insurance (PI, crime) | 0.30 | 0.35 | 0.40 |
| FSCA license fees | 0.05 | 0.03 | 0.03 |
| Marketing and sales | 0.60 | 1.20 | 2.40 |
| Office and admin | 0.36 | 0.48 | 0.60 |
| **Total Opex** | **7.91** | **13.66** | **20.93** |

### 6.4 EBITDA and Path to Profitability

| | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Revenue | R 1.98m | R 7.08m | R 19.80m |
| Opex | R 7.91m | R 13.66m | R 20.93m |
| **EBITDA** | **(R 5.93m)** | **(R 6.58m)** | **(R 1.13m)** |

ForgePay is funded by [describe funding: venture capital, founder equity, loans]. Break-even is projected at [Month/Year] subject to GMV growth assumptions. Detailed cash flow model and balance sheet projections are provided as Appendix C1.

### 6.5 Capital Position

- Minimum regulatory capital requirement: R 1,000,000 (confirmed available; see `06_financial_requirements.md`)
- Working capital runway at submission: [N] months
- Additional capital raises planned: [Describe funding rounds or credit facilities]

---

## 7. Risk Management

### 7.1 Risk Framework

ForgePay adopts a three-lines-of-defence risk model:
- **First line:** Business units (engineering, merchant success) own and manage day-to-day risk
- **Second line:** CCO and AMLCO provide oversight, policy, and challenge functions
- **Third line:** External auditors and regulators provide independent assurance

### 7.2 Key Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Money laundering / terrorist financing | Medium | Critical | 8-rule AML engine; OFAC/UN/EU screening; AMLCO oversight |
| Card fraud / chargebacks | High | High | Hyperswitch ML fraud scoring; 3D Secure; velocity limits |
| Crypto volatility | High | Medium | Instant conversion option; settlement risk limits |
| Regulatory non-compliance | Low-Medium | Critical | Dedicated CCO; external legal; quarterly compliance reviews |
| Cyber breach / data loss | Medium | Critical | PCI DSS controls; penetration testing; SOC 2 (target) |
| Operational failure / downtime | Medium | High | Multi-AZ AWS; BCP/DRP; SLA monitoring |
| Acquirer / partner failure | Low | High | Multi-acquirer routing; no single-acquirer dependency |
| XMR / privacy coin risk | High | High | Enhanced KYC; manual approval for XMR merchants |
| Exchange control violation | Low | Critical | SARB Authorised Dealer bank; legal sign-off on each rail |
| Chargeback rate breach | Medium | High | Fraud filters; dispute management; merchant monitoring |

### 7.3 AML/CFT Risk

ForgePay's AML/CFT risk profile is **Medium-High** due to:
- Crypto asset acceptance (higher anonymity risk)
- Cross-border settlement capability
- AI agent (x402) payments — automated, potentially high-frequency
- XMR (Monero) acceptance — privacy-preserving, requires enhanced controls

Mitigating factors:
- All crypto wallets verified against blockchain analytics (Chainalysis or equivalent)
- XMR merchants require Enhanced Due Diligence (EDD) and manual approval
- x402 payments limited to whitelisted wallets; daily volume caps
- Real-time OFAC, UN, EU, and FSCA sanctions screening on all transactions
- Automated SAR generation for triggered thresholds

---

## 8. Governance

### 8.1 Board Oversight

The Board of Directors receives:
- Monthly management accounts and KPIs
- Quarterly compliance reports (CCO and AMLCO reports)
- Annual AML/CFT programme review
- Immediate notification of material regulatory events (regulatory actions, significant breaches, SAR filings above threshold)

### 8.2 Compliance Reporting to FSCA

ForgePay will submit the following to FSCA as required:
- Annual Statutory Return (FSP Annual return)
- Quarterly transaction volume reports (if required by license conditions)
- Immediate notification of material events (cyber incidents, liquidity concerns, regulatory actions in other jurisdictions)
- Annual audited financial statements within 4 months of financial year end

### 8.3 Policy Review Cycle

| Policy | Review Frequency | Approver |
|---|---|---|
| AML/CFT Policy | Annual (and on regulatory change) | Board |
| IT Security Policy | Annual | Board |
| Risk Management Policy | Annual | Board |
| Consumer Protection Policy | Annual | CEO |
| POPIA Compliance Policy | Annual | Board |

### 8.4 Internal Audit

ForgePay will conduct internal compliance audits semi-annually. External compliance audits will be conducted annually by an independent party (CISA-registered compliance professional or legal firm with financial services practice).

---

## 9. Consumer Protection

ForgePay is committed to treating customers fairly in line with the FSCA's Treating Customers Fairly (TCF) framework:

1. **Fair culture:** Compliance with TCF is a board-level priority; TCF outcomes are reported quarterly.
2. **Clear communication:** Merchants and consumers receive clear, accurate, non-misleading fee schedules and terms before contracting.
3. **Fit-for-purpose products:** Products are designed for identified target markets; XMR and crypto products carry explicit risk warnings.
4. **Advice suitability:** ForgePay does not provide financial advice; where routing recommendations are made algorithmically, these are disclosed as automated.
5. **Performance standards:** Service levels are disclosed; outages and delays are communicated proactively.
6. **Complaints:** A formal complaints procedure is in place; complaints are resolved within 30 days; escalation to FSCA ombudsman is facilitated on request.

---

## Appendices (to be attached to submission)

- Appendix A: Organogram
- Appendix B: Audited / management financial statements
- Appendix C1: Detailed 3-year financial model (spreadsheet)
- Appendix C2: Capital adequacy confirmation letter
- Appendix D: Technology architecture diagram
- Appendix E: Insurance certificates
- Appendix F: Director CVs and qualifications
