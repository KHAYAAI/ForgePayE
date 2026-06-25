# ForgePay — UK Anti-Money Laundering and Counter-Terrorism Financing Policy

**Document type:** FCA PI Application — Section G1 (AML/CFT Controls)  
**Applicant:** ForgePay Ltd  
**Legal basis:** MLR 2017 (SI 2017/692); Proceeds of Crime Act 2002 (POCA); Terrorism Act 2000 (TACT); JMLSG Guidance Parts I–III (January 2024 revision)  
**FATF Recommendations:** R.10–21, R.15 (VASPs), R.16 (Travel Rule)  
**Prepared:** 25 June 2026  
**Version:** 1.0  
**Policy owner:** Money Laundering Reporting Officer (MLRO)  
**Review frequency:** Annual (minimum); more frequently upon regulatory change  

---

## 1. Introduction and Regulatory Basis

ForgePay Ltd ("ForgePay") is a payment institution providing card, stablecoin, and cryptocurrency payment services to business merchants. As a payment service provider, ForgePay is a "relevant person" under the **Money Laundering, Terrorist Financing and Transfer of Funds (Information on the Payer) Regulations 2017** ("MLR 2017") and is subject to its full obligations.

This policy establishes ForgePay's Anti-Money Laundering ("AML") and Counter-Terrorism Financing ("CTF") framework, including:
- Customer Due Diligence (CDD) and Enhanced Due Diligence (EDD)
- Politically Exposed Person (PEP) and sanctions screening
- Transaction monitoring (including ForgePay's 8-rule AML engine)
- Suspicious Activity Reporting (SAR) to the National Crime Agency (NCA)
- Record keeping
- MLRO function and governance

All ForgePay staff receive AML training appropriate to their role. Failure to comply with this policy is a disciplinary matter and may constitute a criminal offence.

---

## 2. Money Laundering Reporting Officer (MLRO)

### 2.1 Appointment

ForgePay has appointed a **Money Laundering Reporting Officer (MLRO)** who holds the FCA Senior Manager Function **SMF17**. The MLRO is a member of senior management with the authority, resources, and independence to discharge their function.

| Field | Detail |
|---|---|
| MLRO name | [To be confirmed on appointment] |
| FCA SMF17 approved | [Pending FCA approval] |
| Reports to | CEO and Board of Directors |
| Deputy MLRO | [Name — covers MLRO absence] |
| MLRO email | mlro@forgepay.io (internal, restricted access) |

### 2.2 MLRO Responsibilities

The MLRO is responsible for:
- Receiving and reviewing internal suspicious activity disclosures from staff
- Making Suspicious Activity Reports (SARs) to the **National Crime Agency (NCA)** where appropriate
- Submitting **Defence Against Money Laundering (DAML)** applications where required (POCA 2002 s.338)
- Approving the annual AML Policy and Compliance Monitoring Programme
- Producing the **Annual MLRO Report** to the Board
- Maintaining the AML register and SAR log
- Overseeing AML training
- Acting as the FCA's primary contact for AML matters

### 2.3 Annual MLRO Report

The MLRO submits an annual report to the Board covering:
- Transaction monitoring statistics (alerts raised, investigated, SAR'd)
- SARs submitted to NCA (volume, typologies, outcomes)
- KYB/CDD completion rates and overdue reviews
- AML training completion rates
- AML-related incidents and near-misses
- Regulatory developments and policy updates required
- Resource adequacy assessment

---

## 3. Risk-Based Approach

ForgePay adopts a **risk-based approach (RBA)** to AML/CFT as required by MLR 2017 reg 18A and the JMLSG Guidance Part I Chapter 4. The RBA ensures that AML resources are proportionate to the actual ML/TF risk ForgePay faces.

### 3.1 Business-Wide Risk Assessment

ForgePay conducts a **Business-Wide Risk Assessment (BWRA)** annually covering:
- Customer risk (merchant business types, geographies, ownership structures)
- Product/service risk (card payments, crypto, stablecoin, x402, XMR)
- Delivery channel risk (online-only, API-first, no face-to-face)
- Geographic risk (UK, EEA, international merchants; cross-border payment flows)
- Emerging risks (AI agent payments, DeFi interactions, Privacy-Enhanced Currencies)

The BWRA is approved by the Board and available for FCA review on request.

### 3.2 Customer Risk Scoring

Each merchant customer is assigned a **risk score** at onboarding and reviewed at least annually:

| Risk Score | Description | CDD Level | Review Frequency |
|---|---|---|---|
| Low (1–3) | Standard UK SME, low-risk sector, transparent ownership | Standard CDD | 3 years |
| Medium (4–6) | Complex structure, higher-risk sector, or EEA non-UK | Enhanced monitoring | 1 year |
| High (7–9) | High-risk sector, complex ownership, non-EEA, or crypto-primary | EDD + approval | 6 months |
| Very High (10) | PEP-connected, adverse media, sanctions proximity, XMR-only | EDD + MLRO approval + Board | 3 months |

### 3.3 High-Risk Sectors

The following merchant business sectors attract a **minimum Medium risk score**:
- Gambling and gaming (licensed and unlicensed)
- Adult content and services
- Pharmaceuticals and dietary supplements
- Money services businesses (MSBs) and currency exchangers
- Virtual asset service providers (VASPs)
- Arms and defence (non-government)
- Precious metals and stones dealers
- Charities (cross-border)
- Politically active organisations
- Marketplaces (particularly peer-to-peer)

XMR-only merchants attract a **minimum High risk score** due to Monero's privacy-enhancing characteristics.

---

## 4. Customer Due Diligence (CDD)

ForgePay provides services only to **business customers (B2B merchants)**. Accordingly, CDD is applied to the merchant entity and its beneficial owners.

### 4.1 Standard CDD (MLR 2017 reg 28)

Standard CDD is applied to all merchants regardless of risk score, unless simplified CDD is justified (see Section 4.3).

**CDD elements for a business merchant:**

| CDD Element | Verification Method | Acceptable Evidence |
|---|---|---|
| Business name and legal form | Registry check | Companies House API (UK); Dun & Bradstreet (international) |
| Registered address | Registry check | Companies House; official registry |
| Business registration number | Registry check | Companies House number / equivalent |
| Nature of business | Self-declaration + screening | Merchant questionnaire; SIC code; website review |
| Directors/Officers | Registry check + ID verification | Companies House filing; passport/driving licence + biometric check |
| Beneficial Owners (UBOs > 25%) | Registry check + ID verification | PSC register; passport + proof of address |
| Source of funds | Self-declaration + plausibility | Business bank statements; audited accounts; investor records |
| Source of wealth (high-risk) | Documentary evidence | EDD — see Section 4.4 |

### 4.2 KYB Onboarding Process

ForgePay's automated KYB onboarding flow:

```
Merchant signs up → Business verification (Companies House API)
                         ↓
            UBO identification (PSC register)
                         ↓
            ID & liveness check (director/UBO — e.g. Onfido / Jumio)
                         ↓
            PEP + Sanctions screening (see Section 5)
                         ↓
            Adverse media screening
                         ↓
            Risk scoring (automated + manual review for Medium+)
                         ↓
            MLRO approval (High and Very High risk)
                         ↓
            Merchant agreement execution
                         ↓
            Live payment processing enabled
```

### 4.3 Simplified CDD (MLR 2017 reg 37)

Simplified CDD may be applied where the customer, product, or transaction presents a demonstrably low risk of ML/TF. ForgePay may apply simplified CDD where:
- The merchant is a listed company (UK/EEA regulated exchange) with public ownership disclosure
- The merchant is a UK government entity or public body

Simplified CDD does not mean no CDD — ForgePay still collects and verifies business identity.

### 4.4 Ongoing Monitoring (MLR 2017 reg 28(11))

CDD is not a one-time exercise. ForgePay monitors existing merchant relationships on an ongoing basis:
- **Automatic re-screening:** All merchants screened against updated sanctions lists daily (automated)
- **Periodic CDD refresh:** CDD documents reviewed per risk-tiered schedule
- **Event-triggered review:** CDD review triggered by: change of UBO; adverse media alert; transaction monitoring alert; material change in payment patterns

---

## 5. Enhanced Due Diligence (EDD)

EDD is applied where MLR 2017 requires it (reg 33) and where ForgePay's risk assessment determines it is necessary.

### 5.1 Mandatory EDD Scenarios (MLR 2017 reg 33)

| Scenario | EDD Requirement |
|---|---|
| High-risk third countries | Customer, UBO, or transaction counterparty is based in FATF high-risk / grey list country |
| PEP (see Section 5.2) | Any UBO or director is a PEP or PEP associate |
| Complex / unusual ownership structure | Layered ownership, nominee shareholders, offshore holding companies |
| High-risk payment patterns | Unusual transaction volumes or values inconsistent with stated business purpose |
| Non-face-to-face establishment | All ForgePay customers (API-only) — mitigated by identity verification technology |

### 5.2 Politically Exposed Persons (PEPs)

A PEP is a natural person who is, or has been within the last 12 months, entrusted with a **prominent public function** (MLR 2017 reg 35). PEP status extends to immediate family members and close associates.

**ForgePay's PEP procedure:**
1. All directors and UBOs screened against PEP databases at onboarding (automated)
2. Ongoing daily re-screening (automated — OFAC, HMT, World-Check / Dow Jones)
3. Any PEP or PEP-associated merchant triggers EDD
4. EDD for PEPs includes: source of wealth verification, purpose of business relationship, senior management approval (MLRO or CEO)
5. UK domestic PEPs: lower inherent risk; EDD requirements proportionate per FCA guidance
6. Foreign PEPs: higher inherent risk; full EDD required including documented approval

ForgePay does not accept business from individuals on the OFAC SDN list or UK HMT asset freeze list under any circumstances.

---

## 6. Sanctions Screening

### 6.1 Screening Scope

ForgePay screens all merchants, UBOs, directors, and (on a sampled basis) significant transaction counterparties against:

| List | Authority | Frequency |
|---|---|---|
| UK HMT Financial Sanctions (UK Sanctions List) | HM Treasury | Daily (automated) + at onboarding |
| OFAC SDN list | US Office of Foreign Assets Control | Daily (automated) + at onboarding |
| EU Consolidated Sanctions List | European Union | Daily (automated) + at onboarding |
| UN Security Council Sanctions | United Nations | Daily (automated) + at onboarding |
| FCA Warning Notices / Unauthorised firms list | FCA | Weekly |

### 6.2 OFAC Engine

ForgePay operates an **OFAC screening engine** integrated into the payment processing pipeline. The engine:
- Screens the merchant and payer name/address against OFAC SDN list on every transaction
- Blocks transactions where a match score exceeds the configured threshold (configurable, default 85% fuzzy match)
- Escalates potential matches to the MLRO team for manual review within 4 hours
- Maintains an audit log of all screening results (matched and non-matched)

The OFAC engine is integrated at the Hyperswitch router layer (`crates/router`) and is invoked before payment authorisation.

### 6.3 Sanctions Match Response

Where a confirmed sanctions match is identified:
1. Transaction is **blocked immediately** (no value transferred)
2. MLRO is notified within 1 hour
3. If a UK HMT asset freeze target is identified: MLRO files an immediate report with the **Office of Financial Sanctions Implementation (OFSI)** (mandatory reporting under the Sanctions and Anti-Money Laundering Act 2018)
4. ForgePay does not release blocked funds without OFSI licence
5. Merchant relationship is suspended pending MLRO investigation

---

## 7. Transaction Monitoring

### 7.1 ForgePay AML Engine

ForgePay operates a proprietary transaction monitoring system embedded in the payment processing pipeline. The system implements **8 core AML detection rules** designed for payment institution risk typologies. These rules are reviewed quarterly by the MLRO and updated to reflect emerging typologies.

### 7.2 Core AML Detection Rules

| Rule ID | Rule Name | Description | Alert Threshold |
|---|---|---|---|
| AML-001 | High-value single transaction | Individual transaction above threshold | > £10,000 (or equivalent) |
| AML-002 | Velocity — high volume short period | Abnormal number of transactions in short period | > 50 txns in 1 hour per merchant |
| AML-003 | Structuring / smurfing | Multiple transactions just below reporting threshold | > 3 txns in 24h each £8,000–£9,999 |
| AML-004 | Geographic mismatch | Payer IP/device location inconsistent with card/wallet billing address | Country mismatch + > £500 |
| AML-005 | Jurisdiction risk | Transaction involves payer in FATF grey/blacklist jurisdiction | Any transaction amount |
| AML-006 | Unusual crypto pattern | Crypto payment to/from wallet with known mixer/darknet association | Wallet screening positive |
| AML-007 | Rapid fund cycle | Funds received and immediately withdrawn to different account/wallet | < 4 hours between receipt and withdrawal |
| AML-008 | Merchant pattern deviation | Merchant's transaction pattern deviates significantly from baseline | > 3 standard deviations from 30-day average |

### 7.3 OTEL-Based Anomaly Detection

ForgePay's OpenTelemetry (OTEL) observability layer exports real-time payment metrics to **Grafana / AWS CloudWatch**. The MLRO team has access to dashboards showing:
- Real-time transaction velocity per merchant
- Geographic distribution of payment origins
- Crypto wallet clustering alerts (chain analysis integration)
- Rule trigger frequency and false-positive rates

OTEL traces provide the MLRO with full transaction path visibility for investigation purposes.

### 7.4 Alert Management

| Step | Action | Owner | SLA |
|---|---|---|---|
| Alert generated | System creates alert in AML case management system | Automated | Immediate |
| Initial triage | Analyst reviews alert against transaction context | AML Analyst | 4 hours |
| Investigation | Full transaction and customer review | AML Analyst / MLRO | 2 business days |
| Decision: No further action (NFA) | Alert closed, documented | MLRO | 2 business days |
| Decision: SAR required | MLRO files SAR to NCA | MLRO | Before 7 calendar days from suspicion arising |
| Decision: DAML required | MLRO files DAML consent request | MLRO | Before processing the transaction |

### 7.5 Calibration and Tuning

Transaction monitoring rules are reviewed and calibrated quarterly:
- False-positive rate monitored (target: < 20% of alerts are SARs)
- New typologies from NCA, FCA, and JMLSG guidance incorporated
- Rules updated for new payment methods (x402, new crypto assets)
- Rule change log maintained for audit trail

---

## 8. Suspicious Activity Reports (SARs) to NCA

### 8.1 Internal Disclosure

All ForgePay staff are required to make an **internal suspicious activity disclosure** to the MLRO if they know or suspect that a person is engaged in money laundering or terrorist financing. Failure to disclose is a criminal offence under POCA 2002 s.330.

Internal disclosures are made via ForgePay's internal SAR system. The MLRO reviews all internal disclosures within 2 business days.

### 8.2 External SAR (to NCA)

The MLRO submits SARs to the **National Crime Agency (NCA)** via the **SAR Online** portal (https://sars.nationalcrimeagency.gov.uk/) where:
- There is knowledge or suspicion of money laundering (POCA 2002 s.330)
- There is knowledge or suspicion of terrorist financing (TACT 2000 s.21A)
- The information came to ForgePay in the course of regulated business

### 8.3 Defence Against Money Laundering (DAML)

Where a transaction has not yet been executed and the MLRO suspects ML/TF, a **DAML consent request** is submitted to the NCA before the transaction proceeds. ForgePay will not process the transaction until:
- NCA grants consent (expressly, or by deemed consent after 7 working days); or
- The prohibited period (31 days) expires without an order

### 8.4 Tipping Off

ForgePay strictly prohibits **tipping off** — disclosing to a merchant or other person that a SAR has been made, or that an investigation is underway. Breach is a criminal offence under POCA 2002 s.333A.

Staff are trained on tipping-off risk annually.

### 8.5 SAR Log

The MLRO maintains a confidential SAR log recording:
- Date of internal disclosure
- Nature of suspicion
- MLRO decision (SAR filed / NFA)
- NCA reference number (if SAR filed)
- Transaction/customer involved
- Outcome (known)

The SAR log is a confidential document accessible only to the MLRO, Deputy MLRO, and Board Chair.

---

## 9. Monero (XMR) — Enhanced Controls

Monero is a **privacy-enhanced cryptocurrency** using ring signatures, stealth addresses, and RingCT to make transaction history opaque. ForgePay recognises the elevated ML/TF risk associated with XMR.

ForgePay's enhanced XMR controls:
- **All XMR merchants** require MLRO approval (regardless of volume)
- **EDD mandatory** for all XMR merchants: documented legitimate business purpose required
- **Merchant volume cap:** XMR transaction volume capped at [£X] per merchant per month pending MLRO review
- **Enhanced transaction monitoring:** All XMR transactions reviewed by MLRO team (not just sampled)
- **No anonymous XMR acceptance:** Payer identification required for XMR transactions > £500 equivalent
- **No mixing/tumbler wallets:** ForgePay screens XMR source addresses against known mixer patterns (Chainalysis / TRM Labs API where available for XMR)
- **Quarterly review:** MLRO reviews XMR merchant portfolio quarterly with option to withdraw service

ForgePay reserves the right to withdraw XMR payment acceptance if the ML/TF risk cannot be adequately mitigated.

---

## 10. Crypto Travel Rule Compliance

### 10.1 Obligation

The **Transfer of Funds (Information on the Payer) Regulations 2017** (UK TFR, as amended by the Money Laundering and Terrorist Financing (Amendment) (No.2) Regulations 2022) requires ForgePay to collect and transmit **beneficiary and originator information** for crypto asset transfers (Travel Rule).

The UK Travel Rule applies to crypto asset transfers ≥ £1,000 (or equivalent) from 1 January 2024.

### 10.2 Travel Rule Implementation

For qualifying crypto asset transfers, ForgePay will:
- **As originating VASP:** Transmit to the beneficiary VASP: payer name, payer account reference, payer address; beneficiary name, beneficiary account reference
- **As beneficiary VASP:** Receive and process Travel Rule data from originating VASPs; reject transfers where required data is absent and the threshold is met

ForgePay will use a **Travel Rule compliance protocol** compatible with TRISA or OpenVASP for inter-VASP data exchange.

### 10.3 Unhosted Wallets

For transfers to/from unhosted (self-custodied) wallets ≥ £1,000:
- Collect payer/payee name and wallet address
- Apply risk-based additional CDD where warranted (MLR 2017 reg 15A, as amended)
- Enhanced scrutiny for unhosted wallet transfers > £3,000

---

## 11. Record Keeping

### 11.1 Retention Requirements (MLR 2017 reg 40)

| Record Type | Retention Period | Format |
|---|---|---|
| CDD documents (identity verification) | 5 years from end of business relationship | Encrypted electronic |
| Transaction records | 5 years from date of transaction | Database / encrypted backup |
| SAR log and internal disclosures | 5 years | Encrypted, access-controlled |
| AML training records | 5 years | Electronic |
| Risk assessments (BWRA, customer) | 5 years from supersession | Electronic |
| Correspondence with NCA, FCA | Indefinite (regulatory) | Electronic |

All records are stored in ForgePay's AWS infrastructure (eu-west-2, London) with AES-256 encryption at rest (AWS KMS managed keys) and access limited to authorised personnel.

### 11.2 Data Subjects' Rights

AML/CDD records are exempt from certain UK GDPR rights (including the right to erasure) under the DPA 2018 Schedule 2 para 4 (crime prevention and detection exemption) where retention is required by MLR 2017.

---

## 12. AML Training

### 12.1 Training Programme

All ForgePay staff and contractors with access to payment or customer data complete AML training:

| Audience | Training Content | Frequency |
|---|---|---|
| All staff (induction) | Introduction to ML/TF; ForgePay's AML obligations; how to make internal disclosure | At onboarding |
| All staff (annual refresh) | Updated typologies; ForgePay's ML/TF risk profile; Conduct Rules | Annual |
| AML team / MLRO | Advanced AML (transaction monitoring, SAR writing, DAML, Travel Rule, crypto) | Annual + on regulatory change |
| Technology/engineering | AML controls embedded in Hyperswitch router; testing AML rules | At onboarding + bi-annual |
| Senior management | ML/TF risk governance; regulatory obligations; MLRO Annual Report | Annual |

Training completion is tracked in ForgePay's HR system. Non-completion results in access suspension.

### 12.2 Training Record

Training records include: staff name, role, training module, date completed, assessment result (where applicable). Records retained for 5 years.

---

## 13. Policy Governance

| Field | Detail |
|---|---|
| Policy owner | MLRO |
| Approved by | Board of Directors |
| Review frequency | Annual (minimum) |
| Distribution | All staff (relevant sections); full policy to MLRO team |
| FCA notification upon change | Material changes to AML controls notified to FCA |

---

*Document version: 1.0 — 25 June 2026*  
*Owner: MLRO*  
*Legal basis: MLR 2017, POCA 2002, TACT 2000, JMLSG Guidance (2024), FATF Recommendations*
