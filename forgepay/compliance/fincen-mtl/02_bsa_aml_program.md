# ForgePay Written BSA/AML Compliance Program
## Bank Secrecy Act Anti-Money Laundering Program

**Authority:** 31 CFR 1022.210 (MSB AML Program Requirements)
**Effective Date:** [Insert Date]
**Program Owner:** Chief Compliance Officer
**Version:** 1.0

---

## Program Purpose and Legal Basis

This document constitutes ForgePay's written Bank Secrecy Act (BSA) / Anti-Money Laundering (AML) compliance program, as required by 31 CFR 1022.210 for all Money Services Businesses (MSBs).

The program is designed to prevent ForgePay from being used to facilitate money laundering, terrorist financing, and other financial crimes. It establishes risk-based policies, procedures, and controls consistent with:

- Bank Secrecy Act (31 U.S.C. §§ 5311–5336)
- 31 CFR Part 1010 (General BSA provisions)
- 31 CFR Part 1022 (MSB-specific BSA provisions)
- USA PATRIOT Act (31 U.S.C. § 5318(h))
- OFAC regulations (31 CFR Parts 500–599)
- FinCEN guidance on virtual currency (FIN-2013-G001; FIN-2019-G001)

---

## The Four Pillars of ForgePay's AML Program

As required by 31 CFR 1022.210(d), every MSB AML program must incorporate four minimum elements ("four pillars"):

### Pillar 1: Internal Policies, Procedures, and Controls
### Pillar 2: Designated Compliance Officer
### Pillar 3: Ongoing Employee Training Program
### Pillar 4: Independent Testing and Audit

Each pillar is detailed in the sections below.

---

## Pillar 1: Internal Policies, Procedures, and Controls

### 1.1 Customer Identification and Verification (CIP/KYC)

ForgePay implements a risk-based Know Your Customer (KYC) program for all merchant onboarding and consumer-facing products.

**Merchant Onboarding (Business Customers):**
- Collection of EIN, legal business name, registered address, state of formation
- Verification of beneficial owners (25%+ ownership threshold per FinCEN's 2016 Customer Due Diligence Rule, 31 CFR 1010.230)
- Government-issued ID for each beneficial owner and control person
- Verification of business legitimacy (state registration, website, business description)
- Risk tier assignment (low / medium / high) based on business type, volume, and geography

**Consumer KYC (applicable to x402 wallet and direct consumer products):**
- Full legal name, date of birth, residential address, SSN (last 4 or full, risk-based)
- Government-issued ID verification (driver's license, passport)
- OFAC SDN screening at account creation and on periodic refresh
- Enhanced Due Diligence (EDD) for high-risk consumers

**Crypto-Specific KYC:**
- Blockchain address collection and linkage to customer identity
- Chainalysis/TRM Labs integration for transaction risk scoring (to be implemented)
- Source-of-funds inquiry for transactions above $10,000

### 1.2 Risk-Based Approach

ForgePay's AML program is risk-based, consistent with FinCEN's expectation that MSBs calibrate controls to their specific risk profile. The AML engine embedded in ForgePay's compliance-monitor service implements eight core risk rules:

| Rule ID | Rule Name | Threshold | Action |
|---------|-----------|-----------|--------|
| AML-001 | Large Transaction | Single transaction > $10,000 | Alert + CTR evaluation |
| AML-002 | Structuring / Smurfing | Multiple transactions < $10,000 within 24 hours totaling > $10,000 | Alert + SAR evaluation |
| AML-003 | High-Risk Country | Transaction involving FATF high-risk jurisdiction | Enhanced review |
| AML-004 | OFAC Match | Customer or counterparty on SDN list | Block + OFAC report |
| AML-005 | Velocity Anomaly | Transaction frequency 3x historical average | Alert |
| AML-006 | Crypto Mixing | Funds traced to known mixing service | Block + SAR evaluation |
| AML-007 | Dark Market Indicators | Chainalysis/TRM risk score > 75 | Alert + EDD required |
| AML-008 | Dormant Account Activation | Account inactive > 180 days with sudden large activity | Alert + SAR evaluation |

**Risk Categories:**

| Risk Level | Criteria | Controls |
|------------|----------|---------|
| Low | US-based, regulated counterparties, small volume | Standard KYC, automated monitoring |
| Medium | Moderate volume, occasional crypto activity, some international exposure | Periodic EDD, enhanced monitoring |
| High | High volume, crypto mixing indicators, high-risk jurisdictions, PEPs | Full EDD, manual review, SAR consideration |

### 1.3 Prohibited Activities

ForgePay will not knowingly process transactions for:
- Persons or entities on the OFAC SDN List or other sanctions lists
- Businesses operating in OFAC-sanctioned countries (Cuba, Iran, North Korea, Syria, Russia [certain sectors], Crimea/DNR/LNR)
- Unlicensed money services businesses acting as intermediaries
- Illegal gambling operations
- Online pharmacies without proper DEA/FDA authorization
- Child sexual abuse material or any illegal content platforms
- Entities identified as terrorist organizations (OFAC, FATF, UN lists)

### 1.4 Transaction Monitoring

ForgePay's compliance-monitor service performs real-time transaction monitoring against the eight AML rules described in Section 1.2. Additionally:

- **Daily batch review:** AML alerts from the previous 24 hours are reviewed by the Compliance team
- **Weekly trend analysis:** Transaction patterns reviewed for structuring, velocity anomalies, and geographic clustering
- **Monthly risk assessment update:** Risk profiles for high-volume merchants reviewed and updated
- **Automated blocking:** OFAC matches and Rule AML-006 (crypto mixing) result in automatic transaction blocking pending manual review

### 1.5 Recordkeeping

ForgePay maintains the following records per 31 CFR 1010.410 and 1010.430:

| Record Type | Retention Period | Format |
|-------------|-----------------|--------|
| Transaction records ($3,000+) | 5 years | Database / encrypted archive |
| KYC/identity documents | 5 years from account closure | Encrypted document storage |
| AML alerts and disposition | 5 years | Compliance case management system |
| SARs filed | 5 years | Secure SAR archive (separate from customer files) |
| CTRs filed | 5 years | FinCEN BSA E-Filing records |
| OFAC screening records | 5 years | Compliance database |
| Training records | 5 years | HR/LMS system |
| Risk assessments | 5 years (last version + all prior versions) | Version-controlled document storage |

**Critical:** SAR records may not be disclosed to the subject of the SAR (tipping-off prohibition, 31 U.S.C. § 5318(g)(2)).

---

## Pillar 2: Designated Compliance Officer

### 2.1 Role and Responsibilities

As required by 31 CFR 1022.210(d)(2), ForgePay designates a **Chief Compliance Officer (CCO)** with day-to-day responsibility for the BSA/AML program.

**CCO Responsibilities:**
- Maintaining and updating this AML Program
- Supervising the daily review of AML alerts
- Making SAR and CTR filing decisions
- Overseeing OFAC compliance
- Reporting to the Board/Executive team on compliance status (quarterly)
- Ensuring timely FinCEN MSB re-registration
- Managing state MTL filings and renewals
- Serving as primary point of contact for regulatory examinations

**Deputy Compliance Officer:**
A designated backup must be available to perform CCO functions during CCO absence. The Deputy has all permissions and access required to review alerts, file SARs/CTRs, and manage OFAC blocks.

### 2.2 CCO Qualifications

The CCO must have:
- Minimum 3 years experience in BSA/AML compliance for a financial institution or MSB
- Working knowledge of FinCEN regulations, OFAC requirements, and state MTL obligations
- CAMS (Certified Anti-Money Laundering Specialist) certification preferred
- Familiarity with cryptocurrency and blockchain transaction analysis preferred

### 2.3 CCO Authority

The CCO has authority to:
- Terminate merchant or consumer accounts for compliance reasons
- Block transactions pending investigation
- Decline to onboard high-risk merchants
- File SARs without business approval (compliance function is independent)
- Engage external legal counsel and compliance consultants
- Report compliance concerns directly to the Board of Directors

---

## Pillar 3: Ongoing Employee Training Program

### 3.1 Training Requirements

All employees who interact with customers, process transactions, or have access to customer financial data must complete BSA/AML training. This is required by 31 CFR 1022.210(d)(3).

**Initial Training:** Within 30 days of hire
**Annual Refresher:** Every 12 months
**Role-Specific Training:** For compliance team members, operations, and engineers who build AML tooling

### 3.2 Training Curriculum

**Core Training (All Employees):**
- What is money laundering? The three stages (placement, layering, integration)
- ForgePay's AML obligations as an MSB
- Red flags: what suspicious activity looks like in payments and crypto
- How to report suspicious activity internally (escalate to CCO)
- Tipping-off prohibition — never tell a customer you filed a SAR
- OFAC sanctions — who we cannot do business with

**Compliance Team Training (Annual):**
- SAR filing procedures and Form 111 walkthrough
- CTR filing procedures and Form 112 walkthrough
- OFAC SDN list updates and screening procedures
- Cryptocurrency transaction analysis basics
- Travel Rule obligations
- Regulatory examination preparation
- Recent FinCEN guidance and enforcement actions

**Engineering/Technical Team Training:**
- How the AML engine works and its eight rules
- OFAC screening API integration and failure modes
- Data retention requirements for compliance records
- Secure handling of SAR-related data (access restrictions)

### 3.3 Training Records

- Training completion records maintained in HR/LMS for 5 years
- Annual training completion audited by CCO
- Non-completion reported to employee's manager and escalated after 30-day grace period

---

## Pillar 4: Independent Testing and Audit

### 4.1 Annual Independent AML Audit

As required by 31 CFR 1022.210(d)(4), ForgePay's AML program must be independently tested. This testing must be conducted by:
- A qualified external auditor (preferred), OR
- An internal audit function that is independent from the compliance function

**Annual audit scope:**
- Review of written AML program for completeness and regulatory currency
- Testing of KYC/CIP procedures (sample of new accounts)
- Testing of transaction monitoring (sample of alerts and dispositions)
- Review of SAR filing decisions (completeness, timeliness)
- Review of CTR filings
- OFAC screening effectiveness test (using synthetic test data)
- Training completion records review
- Recordkeeping compliance test
- Assessment against current FinCEN guidance and exam procedures

### 4.2 Audit Frequency

| Audit Type | Frequency | Performer |
|------------|-----------|-----------|
| Full AML program audit | Annual | External auditor |
| SAR/CTR filing review | Quarterly | CCO or Deputy |
| OFAC screening test | Semi-annual | CCO + Engineering |
| Transaction monitoring rule test | Quarterly | Compliance team |
| Training completion review | Annual | CCO |

### 4.3 Audit Findings and Remediation

- Audit findings reported to CCO and Board within 30 days of audit completion
- Material findings remediated within 90 days
- Remediation tracked in compliance issue management system
- Repeat findings escalated to Board as a compliance risk

---

## AML Risk Assessment

### Annual BSA Risk Assessment

ForgePay conducts an annual BSA risk assessment to evaluate and document:

1. **Products and Services Risk:** Card payments (lower risk), stablecoin transactions (medium risk), crypto (higher risk), x402 AI agent payments (novel/elevated risk)
2. **Customer Risk:** Consumer vs. merchant, geographic distribution, industry type
3. **Geographic Risk:** US operations only (low baseline); customer locations including high-risk jurisdictions (elevated)
4. **Channel Risk:** Online/digital only; no cash acceptance (lower risk for some factors, higher for structuring risk)
5. **Residual Risk:** After controls, what is ForgePay's net risk exposure?

The risk assessment informs:
- AML rule thresholds in the compliance-monitor service
- EDD trigger criteria
- Audit scope and focus areas
- Training curriculum updates

---

## Cryptocurrency-Specific Controls

Given ForgePay's significant virtual currency activity (BTC/ETH/LTC/XMR/USDC/USDT), additional controls apply:

### Blockchain Analytics Integration
- All cryptocurrency transactions screened using blockchain analytics (Chainalysis or TRM Labs)
- Transactions flagged with high risk scores (>75/100) require manual compliance review
- Known illicit wallet clusters trigger automatic blocks

### XMR (Monero) Specific Risk
Monero is a privacy coin with enhanced transaction obfuscation. ForgePay must:
- Apply enhanced due diligence to all XMR transactions
- Document business justification for supporting XMR
- Consider whether XMR support is consistent with state MTL obligations (some states prohibit)
- Ensure blockchain analytics providers cover XMR (coverage is limited; document limitations)

### Stablecoin (USDC/USDT) Risk
- USDC and USDT classified as convertible virtual currency under FinCEN guidance
- Circle (USDC) and Tether (USDT) issuers are themselves regulated; ForgePay's obligation is at the transmission level
- On-chain screening required for USDC/USDT transactions originating from external wallets

---

## OFAC Compliance Integration

This AML program incorporates OFAC compliance as a distinct but related obligation. See `06_ofac_compliance_program.md` for full OFAC program details.

Summary integration points:
- OFAC SDN screening at onboarding (all customers and beneficial owners)
- Real-time transaction screening against OFAC lists
- Automatic blocking of matches; manual review for potential false positives
- Blocked transactions reported to OFAC within 10 business days per 31 CFR 501.604

---

## Program Review and Updates

This BSA/AML Program must be reviewed and updated:
- Annually (as part of the BSA risk assessment cycle)
- Within 60 days of material changes to ForgePay's products or business model
- Within 30 days of new FinCEN guidance materially affecting MSB obligations
- After any regulatory examination with findings affecting the program

**Approval:** BSA/AML Program must be approved by the CCO and acknowledged by the Board of Directors.

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | June 2026 | Compliance Team | Initial program |

---

*This BSA/AML Program is a living document. All employees with compliance obligations must acknowledge receipt and understanding annually. Questions should be directed to the CCO.*

*This document is attorney-client privileged to the extent it reflects legal advice. Do not share externally without CCO approval.*
