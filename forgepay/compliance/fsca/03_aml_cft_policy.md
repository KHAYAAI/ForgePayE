# ForgePay — Anti-Money Laundering and Counter-Financing of Terrorism (AML/CFT) Policy

**Document Classification:** Confidential — Board Approved Policy
**Version:** 1.0
**Effective Date:** [Board Approval Date]
**Review Date:** Annual (next review: [Date + 1 year])
**Policy Owner:** Anti-Money Laundering Compliance Officer (AMLCO)
**Approved By:** Board of Directors

---

## 1. Policy Statement and Commitment

ForgePay (Pty) Ltd ("ForgePay") is committed to the highest standards of anti-money laundering (AML) and counter-financing of terrorism (CFT) compliance. This policy establishes the framework through which ForgePay detects, prevents, and reports money laundering and terrorist financing activities in accordance with applicable South African law and international standards.

ForgePay is an Accountable Institution in terms of Schedule 1, Item 22 of the Financial Intelligence Centre Act 38 of 2001 (FIC Act), as amended by the Financial Intelligence Centre Amendment Act 1 of 2017, being a person who carries on the business of a money remitter and payment service provider.

**Zero tolerance:** ForgePay has zero tolerance for the knowing facilitation of money laundering, terrorist financing, or sanctions violations. Any employee, contractor, or partner found to have knowingly assisted such activity will face immediate termination and referral to law enforcement.

---

## 2. Legal Framework

This policy is aligned with and gives effect to:

| Legislation / Standard | Key Obligation |
|---|---|
| FIC Act 38 of 2001 (as amended) | Registration as Accountable Institution; CDD; record keeping; reporting |
| Financial Intelligence Centre Amendment Act 1 of 2017 | Risk-based approach; beneficial ownership; enhanced CDD |
| FATF 40 Recommendations (2012, as updated) | International AML/CFT standards |
| FSCA FAIS Act 37 of 2002 | Conduct and compliance obligations for FSPs |
| Proceeds of Crime Act 76 of 1998 (POCA) | Criminalisation of money laundering |
| Protection of Constitutional Democracy against Terrorist and Related Activities Act 33 of 2004 (POCDATARA) | CFT obligations |
| SARB Exchange Control Regulations | Cross-border transaction controls |
| UN Security Council Resolutions | Sanctions implementation |
| OFAC SDN List | US sanctions compliance (for USD-denominated rails) |

---

## 3. Scope

This policy applies to:
- All employees, directors, contractors, and agents of ForgePay
- All ForgePay products and services (card, EFT, stablecoin, crypto, x402)
- All customers: merchants (business) and consumers (individual)
- All geographies where ForgePay processes or settles payments
- All technology systems involved in payment processing (Hyperswitch router, unified-router, mor-layer, stablecoin-gateway, crypto-gateway)

---

## 4. Business-Wide Risk Assessment (BWRA)

### 4.1 Risk Assessment Methodology

ForgePay conducts an annual Business-Wide Risk Assessment (BWRA) that evaluates ML/TF risk across four dimensions:

1. **Customer risk:** Who are our customers? What is their industry, location, and expected behaviour?
2. **Product/service risk:** Which of our products can be misused for ML/TF?
3. **Geographic risk:** In which jurisdictions do we operate or settle funds?
4. **Channel risk:** How do customers access our services (online, API, mobile)?

The BWRA produces an overall risk rating (Low / Medium / High / Critical) that determines the intensity of controls applied.

### 4.2 Inherent Risk Profile

| Risk Category | Inherent Rating | Rationale |
|---|---|---|
| Customer — retail consumers | Medium | Anonymous payments possible; variable volumes |
| Customer — merchants (standard) | Medium | Business activity verifiable; recurring patterns |
| Customer — crypto merchants | High | Anonymity risk; layering potential |
| Customer — XMR merchants | Critical | Privacy coin; highest ML typology risk |
| Product — card payments | Low-Medium | Strong network controls; chargeback visibility |
| Product — stablecoin (USDC/USDT) | High | Pseudonymous; cross-border; near-instant |
| Product — crypto (BTC/ETH/LTC) | High | Pseudonymous; irreversible; cross-border |
| Product — crypto (XMR) | Critical | Fully privacy-preserving; untraced on chain |
| Product — x402 (AI agent) | High | Automated; potentially high frequency; emerging |
| Geography — South Africa (domestic) | Medium | FATF member; evolving crypto regulation |
| Geography — SADC cross-border | Medium-High | Remittance risk; some high-risk jurisdictions |
| Geography — USD settlement (USDC) | High | US sanctions exposure; OFAC applies |
| Channel — API (merchant integration) | Medium | Programmatic; volume-based; needs monitoring |
| Channel — x402 (agent-initiated) | High | No human in loop; automated; novel |

### 4.3 Residual Risk After Controls

After applying the controls described in this policy, ForgePay's residual ML/TF risk is assessed as **Medium**, which the Board considers acceptable for a regulated payment service provider.

---

## 5. Customer Due Diligence (CDD)

### 5.1 CDD Principles

ForgePay applies a risk-based approach to CDD. The level of due diligence is proportionate to the ML/TF risk presented by the customer, product, and transaction. CDD is conducted:
- Before establishing a business relationship (onboarding)
- When transaction thresholds are triggered
- When the customer's risk profile changes materially
- When ForgePay suspects ML/TF regardless of threshold

### 5.2 Customer Risk Scoring

Each customer is assigned a risk score at onboarding and reviewed at least annually:

| Risk Factor | Low (1) | Medium (2) | High (3) | Critical (4) |
|---|---|---|---|---|
| Business type | Listed company / government | Standard retail / SaaS | Gambling / pawn / crypto exchange | Adult content / arms / XMR merchant |
| Geography (HQ) | SA, EU, UK, US, AU | SADC ex-high-risk | FATF monitored list | FATF high-risk / blacklisted |
| Payment volume | <R 100k/month | R 100k–R 1m/month | R 1m–R 10m/month | >R 10m/month |
| Cash-equivalent usage | None | <20% stablecoin | >50% stablecoin/crypto | XMR / untraceable |
| Beneficial ownership | Clear, simple | 1-2 layers | Complex structure | Unknown / bearer shares |
| PEP or sanctioned party | None | Related party | PEP family | Directly listed |

**Total score 4–6:** Standard CDD
**Total score 7–12:** Enhanced CDD
**Total score 13+:** Enhanced CDD + AMLCO manual approval + quarterly review

### 5.3 Standard CDD — Individual Consumers

Required for retail consumers transacting below R 50,000 per day cumulative:

| Document | Requirement |
|---|---|
| Full name | As per ID document |
| ID / Passport | Certified copy of South African green ID card, smart ID, or valid passport |
| Date of birth | Verified against ID |
| Residential address | Proof not older than 3 months (utility bill, bank statement, municipal statement) |
| Contact details | Email and mobile number; verified via OTP |

Verification: Automated eKYC via [vendor, e.g., Smile Identity, Jumio, or Onfido] with liveness check.

### 5.4 Standard CDD — Business Merchants

Required for all merchants at onboarding regardless of volume:

| Document | Requirement |
|---|---|
| Company name | As registered with CIPC |
| Registration number | CIPC CoR14.3 or equivalent |
| Registered address | As per CIPC records |
| Directors register | All directors identified; IDs verified |
| Ultimate Beneficial Owners (UBOs) | All persons owning 25%+ identified and verified |
| Business activity | Description; match to ISIC/SIC code |
| Bank account | South African business bank account in company name |
| Website / app | Active; consistent with stated business |

Additional for merchants with monthly volume >R 100,000:
- Last 3 months' bank statements
- Last financial year's financial statements (or management accounts if <2 years old)

### 5.5 Enhanced Due Diligence (EDD)

EDD is mandatory for:
- All merchants with total risk score ≥7
- All Politically Exposed Persons (PEPs) and their close associates
- All merchants accepting XMR
- All merchants with >50% of volume in crypto or stablecoin
- All merchants operating in FATF-monitored or high-risk jurisdictions
- Any customer where standard CDD cannot be completed satisfactorily

EDD requirements (in addition to standard CDD):
- Source of funds declaration (what generates the revenue being processed)
- Source of wealth declaration (for UBOs)
- Enhanced business activity verification (website audit, public record check)
- Reference from existing bank (for merchants with >R 1m/month volume)
- AMLCO approval before account activation
- Quarterly periodic review (rather than annual)
- Senior management sign-off for accounts in Critical risk category

### 5.6 Politically Exposed Persons (PEP) Screening

ForgePay screens all customers and UBOs against PEP databases at onboarding and via daily batch re-screening:

**PEP Categories (per FIC Act definitions):**
- Domestic PEPs: senior SA government officials, executives of state-owned enterprises, senior judicial officials
- Foreign PEPs: equivalent positions in foreign governments
- International PEPs: senior officials of international organisations
- Family members and close associates of the above

**Screening tool:** [Vendor — e.g., World-Check, Dow Jones Risk & Compliance, Comply Advantage]

**On PEP match:**
1. Automated alert generated in ForgePay's compliance dashboard
2. Alert reviewed by AMLCO within 24 hours
3. EDD automatically applied; additional source of funds required
4. Senior management (CEO or CCO) must approve relationship
5. Ongoing enhanced monitoring; 6-monthly periodic review

### 5.7 Ongoing CDD and Periodic Review

ForgePay conducts periodic reviews of existing customers:
- Standard risk: Annual review
- Medium risk: Semi-annual review
- High/Critical risk: Quarterly review

Triggers for ad hoc review:
- Unusual transaction pattern or volume spike (>3x monthly average)
- Change in business model or UBO structure
- SAR filed against or related to the customer
- Negative media or intelligence report
- Customer entering a high-risk jurisdiction

---

## 6. Sanctions Screening

### 6.1 Sanctions Lists Screened

ForgePay screens all customers, UBOs, counterparty wallets, and transaction beneficiaries against:

| List | Authority | Frequency |
|---|---|---|
| OFAC Specially Designated Nationals (SDN) | US Treasury | Real-time + daily batch |
| UN Consolidated Sanctions List | United Nations Security Council | Real-time + daily batch |
| EU Consolidated Financial Sanctions List | European Union | Real-time + daily batch |
| FSCA / National Treasury Sanctions | Republic of South Africa | Real-time + daily batch |
| UK Financial Sanctions (OFSI) | HM Treasury | Daily batch |

**For crypto transactions:** All blockchain addresses are screened against Chainalysis or equivalent blockchain analytics tool before funds are accepted. Addresses with risk scores above threshold (e.g., linked to darknet markets, ransomware, mixers) are automatically rejected.

### 6.2 Sanctions Hit Procedure

1. Automated block of transaction or account activation
2. Immediate alert to AMLCO (within 15 minutes via system notification)
3. AMLCO investigates within 4 business hours
4. True match: account frozen; funds blocked; SAR filed; FIC notified; legal counsel engaged
5. False positive: AMLCO documents rationale; account cleared; record retained 5 years
6. No circumvention of sanctions is permitted under any circumstances

---

## 7. Transaction Monitoring

### 7.1 ForgePay AML Engine

ForgePay operates a built-in 8-rule AML transaction monitoring engine, integrated into the Hyperswitch payment router and unified-router webhook service. Rules fire in real time during payment processing and post-processing via batch analysis.

**Rule Set (Version 1.0):**

| Rule ID | Rule Name | Logic | Action |
|---|---|---|---|
| AML-001 | Single Large Transaction | Single transaction > R 50,000 (or equivalent) | Flag for review; notify AMLCO |
| AML-002 | Cumulative Daily Threshold | Cumulative daily volume per customer > R 100,000 | Enhanced review; merchant notification |
| AML-003 | Velocity / Structuring Detection | ≥5 transactions within 60 minutes by same customer below R 49,999 each | SAR trigger; block pending review |
| AML-004 | Rapid In-Out (Layering) | Incoming funds settled and re-transmitted to new beneficiary within 24 hours >80% | Alert; AMLCO manual review |
| AML-005 | High-Risk Geography | Transaction origin or destination IP in FATF high-risk / monitored jurisdiction | EDD prompt; AMLCO alert |
| AML-006 | PEP Transaction | Customer flagged as PEP initiates transaction >R 20,000 | AMLCO review; log to compliance dashboard |
| AML-007 | Crypto Wallet Risk Score | Blockchain analytics risk score >70/100 for incoming wallet | Block transaction; AMLCO alert |
| AML-008 | Sanctions Positive Match | Any party in transaction matches a sanctions list | Immediate block; SAR; FIC notification |

### 7.2 Additional Monitoring Parameters

Beyond the 8-rule engine, ForgePay's analytics platform (PostgreSQL + OTEL) generates the following daily risk reports for AMLCO review:
- Top 20 merchants by volume spike (>2x 30-day rolling average)
- New merchant accounts with first transaction >R 20,000 within 48 hours of activation
- Merchants with chargeback rate >1% in rolling 30-day window
- Merchants receiving >50% of funds from crypto or stablecoin sources
- Cross-border settlement requests above R 500,000 in 24 hours
- x402 AI agent transactions: daily aggregate per initiating wallet address

### 7.3 Alert Triage Process

1. **L1 — Automated (system):** Rules AML-001 through AML-006 generate alerts in compliance dashboard; categorised by severity (High / Medium / Low).
2. **L2 — Analyst review:** Compliance analyst reviews L1 alerts within 1 business day (High severity: within 2 hours).
3. **L3 — AMLCO review:** Analyst escalates unresolved High alerts to AMLCO within 4 hours. AMLCO makes SAR/no-SAR determination.
4. **L4 — FIC reporting:** AMLCO submits STR/SAR to FIC within 15 business days of determination.

---

## 8. Suspicious Activity Reporting (SAR)

### 8.1 Obligation to Report

In terms of Section 29 of the FIC Act, ForgePay must submit a Suspicious Transaction Report (STR) to the Financial Intelligence Centre (FIC) when ForgePay knows or suspects that a transaction is connected to money laundering or financing of terrorism. This obligation applies regardless of the amount involved and cannot be overridden by management instruction.

### 8.2 SAR Triggers (Indicative List)

- Transaction structuring (splitting to avoid reporting thresholds)
- Layering: rapid cycling of funds through multiple accounts
- Placement of funds inconsistent with merchant's stated business
- Use of privacy coins (XMR) without satisfactory explanation of source
- AI agent payments (x402) to addresses with high blockchain risk scores
- Customer refuses to provide CDD documents or provides false information
- Media reports or law enforcement intelligence linking customer to criminal activity
- Customer requests to split settlement to avoid ZAR conversion (possible sanctions evasion)
- Unusual cross-border payment patterns (high-risk jurisdictions)
- Successful sanctions positive match

### 8.3 SAR Process

```
Suspicion arises (staff / automated rule)
           |
           v
Staff member reports to AMLCO via compliance platform (within 1 business day)
           |
           v
AMLCO investigates (reviews transactions, CDD file, external intelligence)
           |
     [Suspicion confirmed?]
    /                      \
  Yes                       No
   |                         |
AMLCO prepares STR form     Document rationale; retain record
   |                         |
Submit to FIC via FIC         File in compliance system
goAML system (within
15 business days of forming
suspicion)
   |
Continue monitoring;
do NOT tip off customer
(tipping off is a criminal
offence under FIC Act s.30)
```

### 8.4 SAR Record Keeping

All SARs and supporting investigation files are retained for minimum 5 years from the date of filing. Records are stored in ForgePay's secure compliance document management system with access restricted to AMLCO and CCO.

### 8.5 Tipping-Off Prohibition

No employee, director, or contractor may disclose to a customer, or any other person, that a SAR has been filed or that the customer is under investigation. Violation of the tipping-off prohibition is a criminal offence under Section 30 of the FIC Act.

---

## 9. Record Keeping

### 9.1 Mandatory Records and Retention Periods

In terms of Section 22 of the FIC Act, ForgePay retains all records relating to customer due diligence and transactions for a minimum of 5 years.

| Record Type | Retention Period | Storage System |
|---|---|---|
| Customer CDD documents (ID, address proof, business registration) | 5 years from end of business relationship | Encrypted document store (AWS S3 af-south-1, AES-256) |
| Transaction records (amount, date, parties, reference) | 5 years from transaction date | PostgreSQL audit tables; replicated to S3 |
| AML alert records and dispositions | 5 years from alert date | Compliance dashboard database |
| SAR / STR files and supporting investigation records | 5 years from filing date | Restricted compliance document system |
| OFAC / sanctions screening records | 5 years from screening date | Compliance audit log |
| Periodic review records | 5 years from review date | Compliance dashboard database |
| Employee AML training records | Duration of employment + 5 years | HR system |
| Board and committee meeting minutes (compliance agenda items) | 7 years | Company secretarial records |

### 9.2 Data Format and Integrity

All transaction records in ForgePay's PostgreSQL database include:
- Immutable audit columns (`created_at`, `updated_at`, `created_by`)
- OTEL trace IDs linking payment events across services
- Hash verification for tamper detection on critical audit records
- Logical delete only (no physical deletion within retention period)
- Encrypted backups to AWS S3 with cross-region replication (af-south-1 primary; backup retained)

---

## 10. FIC Reporting Procedures

### 10.1 Accountable Institution Registration

ForgePay is registered with the Financial Intelligence Centre as an Accountable Institution under Schedule 1, Item 22 of the FIC Act. ForgePay's FIC registration number is [FIC Registration Number].

### 10.2 Reportable Events to FIC

| Report Type | Trigger | Deadline | System |
|---|---|---|---|
| Suspicious Transaction Report (STR) | Known/suspected ML or TF | 15 business days from forming suspicion | FIC goAML portal |
| Cash Threshold Report (CTR) | Cash transaction ≥ R 50,000 | Next business day | FIC goAML portal |
| Terror Property Report (TPR) | Any property linked to terrorism | Immediately (then written report) | FIC goAML portal + SAPS |
| Property Associated with Terrorist/Related Activity (PATA) | Similar to TPR for scheduled persons | Immediately | FIC goAML portal + SAPS |

Note: ForgePay does not accept cash payments. The CTR obligation is noted for completeness; in practice ForgePay's cash CTR volume is zero. Digital equivalent thresholds apply as per FIC Act interpretations.

### 10.3 FIC goAML System

The AMLCO is the designated reporting officer on FIC's goAML system. Deputy access is granted to the CCO. Reports are submitted electronically via the goAML web portal using ForgePay's institutional credentials.

---

## 11. Cryptocurrency and Stablecoin AML Controls

### 11.1 Blockchain Analytics

ForgePay integrates with Chainalysis (or equivalent blockchain analytics provider) to:
- Screen all incoming crypto wallet addresses before accepting funds
- Assign risk scores (0-100) to addresses based on transaction history, cluster analysis, and known criminal associations
- Block transactions from wallets with risk score >70
- Generate risk reports for AMLCO review

**Risk score thresholds:**
- 0-30: Accept with standard logging
- 31-60: Accept with enhanced monitoring flag
- 61-70: AMLCO alert; continue transaction but flag for immediate review
- 71-100: Block transaction; notify AMLCO; decline with generic error to customer

### 11.2 Monero (XMR) Controls

Monero's privacy-preserving design makes traditional blockchain analytics impossible. ForgePay's XMR controls are correspondingly enhanced:
- XMR merchant accounts require AMLCO manual approval (no automated onboarding)
- EDD is mandatory for all XMR merchants regardless of volume
- Source of XMR funds declaration required (miner vs. exchange purchase vs. received from third party)
- XMR volume limits: maximum R 50,000 per merchant per month without enhanced review
- Monthly AMLCO review of all XMR merchant activity
- XMR merchants in high-risk jurisdictions: not accepted

### 11.3 x402 AI Agent Payments

x402 is a novel HTTP-native payment protocol enabling AI agents to pay for API services using USDC. ForgePay's controls for x402:
- All x402 payments go through the same OFAC + blockchain analytics screening as standard USDC
- Initiating wallet addresses must be pre-registered and KYC-linked to a human identity
- Daily aggregate volume cap per wallet: $1,000 USD equivalent
- Automated x402 transactions >$100 per call trigger AMLCO alert
- x402 payment flows are logged separately in the audit system with `payment_source = 'x402'` field

### 11.4 USDC and USDT (Stablecoin) Controls

- Circle (USDC) and Tether (USDT) are both screened by ForgePay for sanctions compliance
- Circle's blacklist API is integrated: addresses blacklisted by Circle are automatically rejected
- USD-denominated rails trigger OFAC screening as a matter of course (US dollar = US nexus)
- Cross-chain USDC movements are analysed for bridge-related risk (cross-chain bridges are a known ML vector)

---

## 12. Training and Awareness

### 12.1 Mandatory AML Training

All ForgePay employees complete AML/CFT training:

| Training Type | Audience | Frequency | Platform |
|---|---|---|---|
| AML/CFT Induction | All new employees | Within 30 days of joining | LMS (online) |
| Annual AML Refresher | All employees | Annual | LMS (online) |
| Role-specific AML (Compliance) | CCO, AMLCO, Compliance Analysts | Annual + on material regulatory change | External provider |
| Role-specific AML (Technology) | Engineering; system developers | Annual | LMS + AMLCO briefing |
| PEP and Sanctions Screening | Customer-facing teams; Compliance | Annual | LMS (online) |
| Crypto AML Typologies | AMLCO, Engineering (crypto-gateway, stablecoin-gateway) | Annual + on new typology guidance | External provider |

### 12.2 Training Records

Training completion is recorded in the HR system. AMLCO reviews training completion rates quarterly. Non-completion is escalated to the employee's line manager and CCO. Training records are retained for the duration of employment plus 5 years.

---

## 13. Governance and Oversight

### 13.1 AMLCO Responsibilities

The Anti-Money Laundering Compliance Officer (AMLCO) is responsible for:
- Day-to-day management of the AML/CFT programme
- Oversight of customer onboarding (EDD approvals)
- Review and disposition of AML alert queue
- SAR preparation and FIC reporting
- Annual AML/CFT risk assessment
- Staff training programme management
- Reporting to the CCO and Board Compliance Committee

The AMLCO reports directly to the CCO and has unfettered access to the CEO and Board on compliance matters.

### 13.2 Board Reporting

The AMLCO submits a quarterly report to the Board Compliance Committee covering:
- Number of customers onboarded (by risk tier)
- Number and value of transactions processed by rail
- Number of AML alerts generated, resolved, and escalated
- Number of SARs filed with FIC
- Status of FIC Accountable Institution registration and any FIC correspondence
- Training completion rates
- Material changes to risk profile or applicable regulations
- Recommended policy updates

### 13.3 Independent Review

An independent external AML audit is conducted annually by a qualified compliance professional (CISA-registered or legal firm with AML practice). The audit scope includes:
- Review of BWRA adequacy
- Sample-based testing of CDD files
- Alert triage process assessment
- SAR quality review
- Training records verification
- Systems controls testing

Audit findings are reported to the Board Compliance Committee and corrective actions are tracked to completion.

---

## 14. Policy Breach and Disciplinary Procedure

Any employee who:
- Fails to conduct required CDD
- Processes a transaction they know to be suspicious without reporting it
- Tips off a customer that a SAR has been filed
- Circumvents sanctions screening
- Falsifies AML records

...is subject to immediate suspension pending investigation, potential dismissal, and referral to the SAPS and/or FSCA as appropriate. AML policy breaches are treated as serious misconduct under ForgePay's employment policies.

---

## 15. Policy Updates

This policy is reviewed annually and updated immediately when:
- Relevant legislation or regulatory guidance changes
- The FATF updates its 40 Recommendations or mutual evaluation guidance
- ForgePay launches a new product or enters a new market
- A material ML/TF typology is identified that requires new controls
- The BWRA identifies a significant change in risk profile

All updates are approved by the Board of Directors before coming into effect.

---

## Appendices

- Appendix A: Customer Risk Scoring Matrix (full scoring worksheet)
- Appendix B: SAR Template (FIC goAML format)
- Appendix C: AML Alert Triage Flowchart
- Appendix D: FIC Accountable Institution Registration Certificate
- Appendix E: Blockchain Analytics Integration Specification
- Appendix F: x402 Payment AML Controls Technical Specification
- Appendix G: FATF High-Risk and Monitored Jurisdictions List (current)
- Appendix H: Annual AML Training Curriculum

---

**Sign-Off**

| Role | Name | Signature | Date |
|---|---|---|---|
| Anti-Money Laundering Compliance Officer | | | |
| Chief Compliance Officer | | | |
| Chief Executive Officer | | | |
| Board Chairperson | | | |
