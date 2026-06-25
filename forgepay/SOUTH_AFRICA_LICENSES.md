# ForgePay South Africa: Regulatory Licenses & Compliance Framework

## Executive Summary

ForgePay operating as a Merchant of Record (MoR) in South Africa requires licenses from **4 regulators** and crypto compliance from **2 bodies**. Total time to full regulatory approval: **6-12 months**. Total first-year compliance cost: **R 350,000-500,000**.

---

## 1. FSCA (Financial Sector Conduct Authority) — Money Transmitter License

**Regulatory Body:** Financial Sector Conduct Authority (FSCA)  
**Website:** www.fsca.org.za  
**License Type:** Money Transmitter License (Payment Service Provider)

### What It Covers

- Authorization to transmit money on behalf of customers
- Collecting and holding merchant funds
- Processing payments across all channels (card, bank, crypto, stablecoin)
- Operating webhook normalizer and unified-router services
- Providing settlement to merchants

### Application Requirements

**Form:** MIL001 (Money Transmitter License Application)

**Documentation Checklist:**

- [ ] Business plan (3-5 years, including revenue projections)
- [ ] Proof of capital (minimum R 500,000 in bank account)
- [ ] Organizational structure chart (directors, key staff)
- [ ] Director/shareholder identification documents
- [ ] Director/shareholder financial status declarations
- [ ] AML/CFT Compliance Program (detailed policy document)
- [ ] Customer Due Diligence (CDD) procedures
- [ ] Know Your Customer (KYC) forms (sample versions)
- [ ] Suspicious Activity Reporting (SAR) procedures
- [ ] Record retention policy (minimum 5 years)
- [ ] IT security policy and disaster recovery plan
- [ ] Insurance certificate (professional indemnity, R 5M+ cover)
- [ ] Auditor's report on financial statements (last 2 years)
- [ ] Compliance officer appointment letter + CV
- [ ] AML/CFT officer appointment letter + CV

### AML/CFT Compliance Program (FSCA Requirements)

**Customer Identification Program (CIP):**

| Customer Type | KYC Level | Documents Required | Risk Score Threshold |
|---------------|-----------|-------------------|----------------------|
| Individual consumer | Basic | ID scan + proof of residence | No limit if <R 50k/day |
| Merchant (sole trader) | Enhanced | ID + business registration + bank statement | Enhanced if >R 100k/month |
| Merchant (company) | Full | Company registration + director IDs + beneficial ownership + bank statement | Full if >R 500k/month |
| High-risk merchant (crypto, remittance) | Full | All of above + source of funds + regular review | Full regardless |

**Transaction Monitoring Thresholds:**

| Threshold | Action |
|-----------|--------|
| Single transaction >R 50,000 | Flag immediately, begin review |
| Cumulative daily >R 100,000 | Review merchant pattern |
| Rapid transfers (3+ transfers in 1 hour) | Flag for structuring analysis |
| Cross-border >R 500,000 | Enhanced due diligence + SAR if suspicious |
| Unusual recipients (new accounts, high-risk countries) | Flag for manual review |

**Suspicious Activity Report (SAR) Triggers:**

- Customer asking merchant to split transactions (structuring)
- Transactions inconsistent with merchant profile (software company doing large cash deposits)
- Funds rapidly transferred out after incoming transfer
- Multiple accounts for same merchant (rapid-fire account creation)
- Cross-border transfers to high-risk jurisdictions (Iran, North Korea, Syria)
- Transaction patterns matching known money laundering typologies

### Timeline & Cost

| Phase | Duration | Cost (ZAR) |
|-------|----------|-----------|
| Application preparation | 4-6 weeks | R 30,000-50,000 |
| Application submission | 1 day | Free |
| FSCA review & clarifications | 8-12 weeks | R 0 (include budget for compliance audit) |
| Final approval | 2-4 weeks | Free |
| **Total** | **6-12 months** | **R 50,000-100,000** |

### Annual Compliance Cost

- Annual license fee: R 30,000-50,000 (based on GMV)
- Compliance audits (external): R 30,000-50,000/year
- AML/CFT officer salary: R 80,000-120,000/month
- Total annual: **R 450,000-800,000**

### Post-Approval Obligations

**Quarterly Reporting:**
- Transaction volumes by payment type
- Merchant count and demographics
- SAR count and outcomes
- Compliance incidents

**Annual Reporting:**
- Auditor's report on AML/CFT effectiveness
- Policy updates (any changes to CDD, KYC, monitoring)
- Staff training completion rates
- Technology/security updates

**Ongoing Compliance:**
- Update CDD for all merchants annually
- Enhanced due diligence for high-risk merchants (6-monthly)
- Transaction monitoring (daily automated + weekly manual review)
- Suspicious activity reporting to FIC (within 30 days of discovery)
- Audit trail maintenance (5-year retention minimum)

---

## 2. SARB (South African Reserve Bank) — Payment System Operator License

**Regulatory Body:** South African Reserve Bank (SARB)  
**Website:** www.resbank.co.za  
**License Type:** Payment System Operator (PSO) License (conditional)

### Do You Need This License?

**You DO NOT need PSO if:**
- ✅ You use Plaid + bank APIs (Nedbank, FNB, Absa, Standard Bank)
- ✅ You route payments through existing payment systems (existing PSO)
- ✅ You're only a PSP (ForgePay's current model)

**You DO need PSO if:**
- ❌ You build your own payment rail (connecting to SAPO, clearing house)
- ❌ You operate your own settlement system
- ❌ You hold customer deposits >R 100M

### Recommendation: Start as PSP, Upgrade to PSO in Year 2

For launch, use existing bank APIs and Plaid. This avoids 12-month PSO application. In Year 2, if GMV >R 100M/month, apply for PSO to:
- Own the payment rail (lower settlement costs)
- Reduce dependency on banks
- Improve latency (direct connection to clearing houses)

### PSO Application (If Needed in Year 2)

| Requirement | Detail |
|------------|--------|
| **Capital requirement** | R 5,000,000 minimum (if you're a PSO) |
| **Operational resilience** | Uptime SLA 99.95% (24/7/365) |
| **Technology requirements** | Redundant data centers, disaster recovery |
| **Risk management** | Liquidity management, operational risk |
| **Security** | ISO 27001 certification required |

**Timeline:** 3-6 months (shorter than FSCA because SARB pre-reviews PSO operators)  
**Cost:** R 100,000+ (assessment + audit)

---

## 3. FIC (Financial Intelligence Centre) — AML/CFT Reporting

**Regulatory Body:** Financial Intelligence Centre (FIC)  
**Website:** www.fic.gov.za  
**Requirement:** Reporting entity status for AML/CFT compliance

### Registration (Free)

**Step 1:** Register online at FIC portal
- Business name: ForgePay SA (Pty) Ltd
- Business type: Payment Service Provider (PSP)
- Tax registration number (TRN)
- Contact details

**Step 2:** Appoint AML/CFT Officer
- Submit name, email, phone
- Officer must complete FIC online training (free, 2 hours)

**Step 3:** Implement AML/CFT program
- Customer Due Diligence (CDD) procedures
- Know Your Customer (KYC) processes
- Ongoing Transaction Monitoring (OTM)
- Suspicious Activity Reporting (SAR)
- Record retention (5 years minimum)

### Suspicious Activity Report (SAR) Process

**When to File:**

- Any transaction or pattern suspected of relating to money laundering
- Structuring (deliberate splitting of transactions to avoid R 50k threshold)
- Transactions inconsistent with customer profile
- Rapid cycling of funds
- Unusual geographic patterns

**How to File:**

1. **Detect:** compliance-monitor flags transaction >R 50k or suspicious pattern
2. **Investigate:** Compliance team reviews for 5 business days
3. **Document:** Complete SAR form with narrative and evidence
4. **Submit:** Upload to FIC portal (fic.gov.za/sars)
5. **Timeline:** Must submit within 30 days of detection

**SAR Template (South Africa):**

```
SUSPICIOUS ACTIVITY REPORT (SAR)
=================================
Reporting Entity: ForgePay SA (Pty) Ltd
Your Reference: ForgePay-[MERCHANT-ID]-[DATE]
Tax Registration Number: [TRN]
Report Date: [TODAY]
FIC Receipt Number: [AUTO-GENERATED ON SUBMISSION]

TRANSACTION DETAILS
-------------------
Transaction ID: [ID]
Amount: R [AMOUNT]
Currency: ZAR
Transaction Date: [DATE]
Merchant: [NAME] (Merchant ID: [ID])
Customer: [ANONYMIZED if consumer unknown]
Payment Method: [Card / EFT / Crypto / Stablecoin]
Recipient Account: [LAST 4 DIGITS]
Recipient Bank: [BANK NAME]

PATTERN ANALYSIS
----------------
Transaction History:
- Normal daily transactions: R [X]
- This transaction: R [Y] (multiple of normal)
- Frequency: [Daily / Weekly / Unusual spike]

Risk Factors Present:
[ ] Structuring (multiple small transfers to avoid threshold)
[ ] Rapid cycling (funds in then out within hours)
[ ] Geographic anomaly (unusual country)
[ ] Customer profile mismatch (individual acting like business)
[ ] New account (created <30 days ago)
[ ] Velocity (unusually high transaction rate)
[ ] Round amounts (suspicious round numbers)

NARRATIVE
---------
[2-3 sentence summary of why suspicious]

Example:
"Merchant [NAME] created account 7 days ago, claimed to be e-commerce. Received R 800k 
from 15 different individuals within 48 hours, all transferred out to same beneficiary 
in Kenya within 4 hours of receipt. Pattern consistent with money mule activity or 
remittance fraud."

PREVIOUS ACTIVITY
-----------------
SAR filed before? [Yes/No]
If yes: FIC Ref #: [PREVIOUS SAR ID]

ACTION TAKEN
------------
Transaction Status: [Blocked / Allowed / Under Review]
Merchant Status: [Active / Suspended / Terminated]
Reason: [BRIEF EXPLANATION]

SUPPORTING DOCUMENTS (attach anonymized copies)
------------------------------------------------
- Transaction logs (anonymized)
- Customer KYC documentation
- Merchant onboarding questionnaire
- Customer email/communication (if applicable)
- Previous transaction history (30-day sample)

DECLARATION
-----------
I declare that the information above is true and correct to the best of my knowledge.

Signed: [Compliance Officer Name]
Position: [Compliance Officer]
Date: [TODAY]
```

**FIC Response Timeline:**
- FIC acknowledges receipt within 5 days
- Investigation by FIC: 30-90 days
- Possible outcomes:
  - "No action required" (funds OK, no further investigation)
  - "Referred to law enforcement" (possible criminal activity)
  - "Information noted" (pattern tracked but not immediate threat)

### Ongoing FIC Obligations

**Quarterly (if filed SARs):**
- Update on SARs filed: outcomes, actions taken
- New merchants with enhanced due diligence required
- Updates to AML/CFT program

**Annually:**
- Annual report to FIC (transactions, SARs, incidents)
- AML/CFT officer certification (training current)
- Confirmation of record retention compliance

**Cost:**
- Registration: Free
- AML/CFT officer training: Free (online)
- SAR filing: Free
- Compliance audit (external firm): R 30,000-50,000/year

---

## 4. POPIA (Protection of Personal Information Act) — Data Protection Compliance

**Regulatory Body:** POPIA Commissioner (Office of the Regulator of Privacy, part of Justice Ministry)  
**Requirement:** Data Protection Officer (DPO) appointment

### POPIA Registration

**Step 1:** Appoint Data Protection Officer
- Internal: Compliance officer can double as DPO
- External: Hire DPO firm (R 3,000-5,000/month)

**Step 2:** Notify POPIA Commissioner
- Register with POPIA Commissioner's office (online form)
- Submit DPO contact details
- Registration is declarative (no approval needed, just notification)

**Step 3:** Implement Data Protection Policy
- Privacy policy (published on website)
- Data processing agreement (for merchant data)
- Data retention policy (define how long you keep data)
- Data breach notification plan (how to notify if data leaked)

### POPIA vs GDPR (Key Differences)

| Aspect | POPIA (South Africa) | GDPR (Europe) |
|--------|---------------------|--------------|
| **Scope** | All SA personal data | EU residents' data |
| **Legal basis** | Consent or contract | 6 legal bases (consent, contract, legal, vital interests, public task, legitimate interests) |
| **Data subject rights** | Access, correction, erasure (limited) | Access, erasure, data portability, object, restrict, automated decision |
| **Data minimization** | Yes (collect only what needed) | Yes (strict) |
| **Purpose limitation** | Yes (use only as stated) | Yes (strict) |
| **Retention** | 7 years for merchants (after account closure) | Varies, usually shorter |
| **Fines** | Up to R 10M or 10% revenue (whichever is higher) | Up to €20M or 4% revenue |
| **Applicability to ForgePay** | YES (merchant/customer data stored in ZA) | YES (if you process any EU customer data) |

### POPIA Compliance Checklist for ForgePay

**Personal Data Collected:**

From Merchants:
- Name, email, phone, address (identity verification)
- Company details, tax ID
- Bank account details
- Transaction history
- Proof of residence documents (identity scan)

From Consumers:
- Transaction history (anonymized at point of collect, linked by token)
- Device identifiers (IP, user-agent)
- Payment method metadata (card BIN, expiry — PCI-tokenized)

**Processing Purposes (Legal Basis):**

| Data | Purpose | Legal Basis | Retention |
|------|---------|------------|-----------|
| **Merchant identity** | KYC/AML compliance | Legal obligation (FSCA) | 7 years after account closure |
| **Merchant bank account** | Settlement | Contract | During relationship + 5 years (tax records) |
| **Transaction history** | Payment processing + reporting | Contract + Legal obligation | Transaction life + 7 years |
| **Consumer ID (tokenized)** | Fraud prevention | Legitimate interest | 3 years after last transaction |
| **Email/SMS** | Marketing (if opted-in) | Consent | Until opt-out |

**Data Protection Measures Required:**

- ✅ Encryption: AES-256 at rest, TLS 1.3 in transit
- ✅ Access control: Role-based access (only staff who need it)
- ✅ Audit logging: All data access logged for 2 years
- ✅ Backup encryption: Backups encrypted with KMS (regional key)
- ✅ Data deletion: Secure deletion (3-pass overwrite or crypto-erasure)
- ✅ Incident response: Breach notification within 30 days of discovery

**Data Breach Notification:**

If you discover a data breach (merchant IDs leaked, etc.):

1. **Assess risk:** Does breach expose sensitive info? (ID numbers vs. transaction amounts)
2. **Notify FIC:** If financial data leaked (transaction amounts, bank details)
3. **Notify affected parties:** Send email/SMS to merchants/consumers within 30 days
4. **Document:** Keep evidence of breach, notification, remediation
5. **Notify POPIA Commissioner:** If high-risk breach

**Notification Template:**

```
NOTIFICATION OF PERSONAL DATA BREACH
=====================================
To: [Merchant/Consumer Name]
From: ForgePay SA (Pty) Ltd
Date: [TODAY]

We are writing to inform you of a personal data breach that occurred on [DATE] 
that may have affected your information held by ForgePay.

WHAT HAPPENED:
[Brief description of incident, e.g., "Unauthorized access to our database due to 
SQL injection vulnerability"]

WHAT DATA WAS AFFECTED:
[Description of data: name, email, last 4 of card, transaction history, etc.]

WHAT WE'VE DONE:
- Immediately secured the vulnerability
- Notified law enforcement (SAPS, or relevant authority)
- Engaged cybersecurity firm for forensic investigation
- Resetted all access credentials

WHAT YOU SHOULD DO:
- Monitor your account for suspicious activity
- Change your ForgePay password immediately
- Consider placing fraud alerts with credit bureaus

NEXT STEPS:
- Investigation results: [DATE]
- Follow-up communication: [DATE]

For questions: compliance@forgepay.africa | +27-X-XXXX-XXXX

We apologize for this incident.
```

### Annual POPIA Compliance Audit

**External audit scope (R 40,000-80,000):**
- [ ] Data inventory: What personal data do you process?
- [ ] Legal basis review: Is processing lawful for each data type?
- [ ] Consent records: Do you have proof of consent for marketing?
- [ ] Data access logs: Can you prove who accessed what data?
- [ ] Retention compliance: Are you deleting data as promised?
- [ ] Breach register: Any data leaks reported to POPIA?
- [ ] Third-party contracts: Do your vendors have DPAs (Data Processing Agreements)?
- [ ] Privacy policy review: Is it accurate and up-to-date?

### POPIA Cost

- DPO appointment (external): R 3,000-5,000/month (R 36,000-60,000/year)
- DPO training (online): R 2,000 (one-time)
- Privacy policy creation (legal firm): R 10,000-15,000 (one-time)
- Annual compliance audit: R 40,000-80,000/year
- Data protection tools (data loss prevention, encryption): R 5,000-10,000/month
- **Total Year 1:** R 150,000-250,000

---

## 5. Crypto Regulations (South Africa)

**Status:** Crypto is NOT regulated as currency in South Africa (as of June 2026). However, crypto payment processing falls under PSP regulations.

### Regulatory Framework

**FSCA Guidance (2023):**

> Crypto assets are treated as stored-value products (like gift cards), not currency. Exchanges and payment processors (like ForgePay) must register as Payment Service Providers under FAIS Act Section 1(1)(p).

**Key Points:**

- ✅ Bitcoin, Ethereum: NOT currency, treated as "crypto assets"
- ✅ Stablecoins (USDC, USDT): Treated as "stored value" (similar to e-money)
- ✅ Your stablecoin-gateway and crypto-gateway: Regulated as PSP activities
- ⚠️ No crypto trading without separate license (you're payment processor — OK)
- ⚠️ Cannot guarantee USDC price (price feeds are third-party)

### Crypto-Specific AML/CFT Requirements

**For transactions >R 50,000 equivalent:**

1. **Wallet verification:** Merchant must prove ownership of crypto wallet
2. **Transaction monitoring:** Flag unusual patterns (rapid transfers, mixing)
3. **SAR reporting:** Report to FIC if suspicious

**Enhanced Due Diligence for Crypto Merchants:**

- Verify legitimate business purpose (e-commerce store accepting crypto vs. money launderer)
- Monitor wallet receiving addresses (does it match declared use?)
- Check for mixing services (funds in then out to different wallet)
- Review transaction velocity (is volume consistent with business?)

**Crypto Transaction AML Template:**

```
CRYPTO TRANSACTION MONITORING ALERT
====================================
Merchant: [CRYPTO PAYMENT PROCESSOR MERCHANT]
Transaction Type: Crypto Payment Settlement
Amount: [BTC/ETH/USDC] equivalent to R [ZAR]
Date: [TIMESTAMP]
Wallet From: [MERCHANT WALLET] (verified: yes/no)
Wallet To: [CUSTOMER WALLET OR EXCHANGE]
Blockchain: [Bitcoin / Ethereum / Polygon]
Status: [Confirmed / Pending / Failed]

AML/CFT SCORING
---------------
Risk Factors:
[ ] Rapid transfer to exchange (immediately converted to fiat)
[ ] Mixing detected (funds through Tornado.cash, Chainsaw or similar)
[ ] High-risk wallet (previously flagged by Chainalysis)
[ ] Inconsistent with merchant profile
[ ] Cross-border to high-risk jurisdiction

Risk Score: [LOW / MEDIUM / HIGH / CRITICAL]
Recommendation: [Monitor / Investigate / Block]

ACTION
------
Automated: [ALLOW / HOLD / BLOCK]
Manual review by compliance: [DATE/TIME]
```

### Stablecoin vs Crypto (Tax Treatment)

**For merchants using stablecoins (USDC, USDT):**

| Scenario | Tax Treatment | Compliance |
|----------|---------------|-----------|
| Merchant receives USDC, holds overnight, converts to ZAR next day | No capital gains (business activity) | Treat as normal business revenue (SAR 100 income) |
| Merchant receives USDC, holds for 1 year, price rises 10% | 40% of CGT applies (long-term holding exemption) | Calculate USDC/ZAR price at receipt date and disposal date |
| Merchant deposits USDC to crypto exchange, earns 10% APY | Interest income (taxable, 100% assessable) | Treated as business income for tax purposes |

**Your responsibility (compliance-monitor):**
- Record USDC/ETH/BTC price in ZAR at transaction time (for tax reporting)
- Generate annual tax reports for merchants (transaction-by-transaction)
- Flag yields from rwa-registry as interest income

### Polygon Africa Nodes (Crypto Infrastructure)

For stablecoin-gateway and crypto-gateway, use Polygon Africa nodes:

| Node Location | Coverage |
|---------------|----------|
| South Africa (Johannesburg) | ZA, Botswana, Namibia |
| Senegal (Dakar) | West Africa |
| Kenya (Nairobi) | East Africa |
| Egypt (Cairo) | North Africa |

**Benefits:**
- ✅ Lower latency (<50ms within region)
- ✅ Local compliance (data stays in Africa)
- ✅ Regional payment stablecoin support
- ✅ Future: Kenyan Shilling (KES) and Nigerian Naira (NGN) stablecoins

---

## 6. Tax Compliance (South Africa)

**Tax Authority:** South African Revenue Service (SARS)  
**Website:** www.sars.gov.za

### Corporate Structure Recommendation

```
ForgePay SA (Pty) Ltd
├── Incorporated in South Africa
├── Tax Registration Number (TRN): [UNIQUE ID]
├── VAT Registration: (once >R 1M annual revenue)
└── Monthly/Annual tax filings to SARS

Plus (for international expansion):
├── ForgePay Africa Limited (BVI or Mauritius)
│   └── Holding company (for tax efficiency)
└── ForgePay EU Ltd (UK)
    └── For EU operations (separate from ZA entity)
```

### Tax Obligations (ForgePay SA)

| Obligation | Rate | Frequency | Deadline | Payer |
|-----------|------|-----------|----------|-------|
| **Income Tax (CIT)** | 28% on net profit | Annual | 28 Feb | ForgePay |
| **VAT** | 15% on service fees | Monthly | 7th of following month | ForgePay (collect from merchants) |
| **Provisional Tax** | Estimated quarterly CIT | Quarterly | 30 Sept, 31 Dec, 31 Mar, 30 Jun | ForgePay |
| **Employees Tax** | 18-45% (progressive) | Monthly | 7th of following month | ForgePay (payroll deduction) |
| **SDL (Skills Development Levy)** | 0.5% of payroll | Annual | 31 Jan | ForgePay |
| **UIF (Unemployment Insurance Fund)** | 1% of payroll | Monthly | 7th of following month | ForgePay |

### Tax Calculation Example (Year 1)

**Assumptions:**
- Annual GMV: R 20,000,000
- Transaction fee: 2.5% (average)
- Gross revenue: R 500,000
- Operating costs: R 300,000 (salaries, AWS, compliance)
- Net profit: R 200,000

**Tax Due:**

| Tax Type | Calculation | Amount |
|----------|-------------|--------|
| Income Tax (28%) | R 200,000 × 28% | R 56,000 |
| VAT (on service fees) | R 500,000 × 15% | R 75,000* |
| Provisional Tax (quarterly) | R 56,000 ÷ 4 | R 14,000 |
| Employees Tax (sample, 2 staff @ avg R 100k) | R 200,000 × 25% avg | R 50,000 |
| SDL (0.5% payroll) | R 200,000 × 0.5% | R 1,000 |
| UIF (1% payroll) | R 200,000 × 1% | R 2,000 |
| **TOTAL TAX DUE** | | **R 184,000** |

*VAT: ForgePay collects from merchants (output tax), pays suppliers (input tax), remits net difference to SARS.

### Tax Deductions (ForgePay)

**Allowable deductions (reduce taxable income):**

- Salaries and benefits (100%)
- AWS costs (100%)
- Compliance audit fees (100%)
- Legal and accounting fees (100%)
- Depreciation on capital equipment (5-year straight-line)
- Bad debts written off (with conditions)
- Professional development (conferences, training)

**NOT deductible:**

- VAT (unless you're not VAT-registered)
- Payments to owners/shareholders (dividends — subject to separate tax)
- Fines and penalties
- Illegal activities

### VAT Registration & Collection

**When to register:**
- Mandatory: Once annual taxable supplies >R 1,000,000
- Voluntary: Earlier if desired (improves cash flow with input VAT recovery)

**How to charge VAT:**

```
ForgePay Service Fee Invoice:
===========================
Service: Payment processing for R 100,000 transaction
Base fee (2.5%): R 2,500
Plus VAT (15%): R 375
TOTAL FEE: R 2,875

Merchant pays: R 2,875
ForgePay remits to SARS: R 375
```

**VAT Refunds (if you have input tax >output tax):**

- Cloud providers: R 1,500/month VAT (recoverable)
- If you spend more on inputs than you charge to merchants, SARS refunds the difference
- Quarterly VAT reconciliation: Output tax - Input tax = Tax due to SARS (or refund to you)

### Tax Record Retention

**Keep for 5 years:**

- Transaction records (by date, amount, merchant, payment method)
- Income statement (monthly)
- Expense receipts and invoices
- Payroll records
- VAT reconciliation sheets
- Customer communications
- Bank statements and reconciliation

**Digital records acceptable:**

- Cloud storage (AWS S3, with encryption)
- Email archives (backups in S3)
- Accounting software exports (QuickBooks, Sage, etc.)

### Annual Tax Filing Timeline

**Timeline:**
- 28 February: CIT annual return due to SARS
- Monthly: VAT returns (if registered)
- Quarterly: Provisional tax payments
- 31 January: SDL and UIF returns

**Process:**
1. **Internal accounting:** Compile financial statements (P&L, balance sheet)
2. **External audit:** If >R 10M revenue, external audit required
3. **Tax return preparation:** Accountant prepares ITR12 (company) + IRP5 (payroll summaries)
4. **SARS e-filing:** Submit online via SARS eFiling portal
5. **Payment:** Tax due within 30 days of submission

### Helpful Tax Resources

- **SARS Tax Estimator:** www.sars.gov.za (interactive tax calculator)
- **Voluntary Disclosure Programme:** If you've underpaid taxes before, possible penalty waiver
- **SARS Rulings:** Request advance ruling on crypto tax treatment (formal opinion)

### Recommended Finance Team (Year 1)

- **Bookkeeper:** R 5,000-10,000/month (monthly reconciliation, invoice processing)
- **Tax accountant:** R 3,000-5,000/month (quarterly reviews, tax planning)
- **External auditor:** R 30,000-50,000/year (annual audit, if >R 1M revenue)

**Total finance cost:** R 150,000-250,000/year

---

## 7. Other South African Licenses & Registrations

### Quick Reference Table

| License | Authority | Purpose | Timeline | Cost | Annual |
|---------|-----------|---------|----------|------|--------|
| **Company Registration** | CIPC | Legal entity | 1 week | R 500 | N/A |
| **Tax Registration (TRN)** | SARS | Tax ID | 1 week | Free | Free |
| **VAT Registration** | SARS | Tax compliance | 2 weeks | Free | Free (>R 1M revenue) |
| **BEE Certificate** | BBBEE Commission | Broad-based Black Economic Empowerment | 2-4 weeks | R 1,000-2,000 | Annual |
| **FICA Compliance** | FIC/SARS | AML/CFT | Ongoing | ~R 50k/year | R 50k/year |
| **DPO Registration** | POPIA Commissioner | Data protection | 30 days | Free | DPO salary: R 36k-60k/year |
| **Professional Indemnity Insurance** | Private insurer | Liability coverage | 1-2 weeks | R 15,000-30,000 | R 15,000-30,000 |
| **Cyber Insurance** | Private insurer | Data breach coverage | 1-2 weeks | R 10,000-20,000 | R 10,000-20,000 |

### BEE Certificate (Black Economic Empowerment)

**Who needs it?**

Required if:
- Government is a customer (deals with all ZA Government entities)
- Large corporate customers (score-card approach)
- Tender bids >R 1M

**What it measures:**

- Ownership (% black ownership)
- Management (% black directors/managers)
- Employment equity (% black employees)
- Skills development (training budget)
- Supplier development (spend with BEE suppliers)

**Score Impact:**
- Level 1 (best): R 30-50M annual revenue, 100% black-owned
- Level 4 (mid): R 10-50M annual revenue, 50%+ black-owned
- Level 8 (entry): <R 10M annual revenue, 10%+ black-owned
- Non-compliant: No BEE rating (limits government contracts)

**Cost:** R 1,000-2,000 assessment + R 500-1,000/year to maintain

### Insurance Requirements

**Professional Indemnity Insurance (mandatory for PSPs):**

- Coverage: R 5,000,000 minimum
- Covers: Professional negligence, data breaches, security failures
- Annual cost: R 15,000-30,000
- Insurer: FSCA-approved (check with FSCA for approved insurers)

**Cyber Insurance (recommended):**

- Coverage: Data breaches, ransomware, business interruption
- Limit: R 10,000,000 recommended
- Annual cost: R 10,000-20,000
- Insurer: Zurich, Old Mutual, Santam (leaders in ZA market)

---

## 8. Regulatory Compliance Calendar (Year 1)

### Month 1 (June 2026)

- [ ] Week 1-2: Register ForgePay SA (Pty) Ltd with CIPC
- [ ] Week 2-3: Get Tax Registration Number (TRN) from SARS
- [ ] Week 3-4: Hire external DPO firm + register with POPIA Commissioner
- [ ] Week 4: Register with FIC as reporting entity (online, 10 min)
- [ ] **Cost:** R 100,000 (legal setup + compliance setup)

### Month 2 (July 2026)

- [ ] Week 1: Complete FSCA Money Transmitter application form (MIL001)
- [ ] Week 2-3: Prepare compliance documentation (see Document 1, section 4.2)
- [ ] Week 3: Compliance audit (external firm) for FSCA readiness
- [ ] Week 4: Submit FSCA application
- [ ] **Cost:** R 150,000 (audit + application fees)

### Month 3 (August 2026)

- [ ] FSCA review begins (allow 8-12 weeks)
- [ ] Weekly check-ins with FSCA for clarifications
- [ ] Prepare SAR templates + AML/CFT procedures
- [ ] Train compliance team on FIC SAR submission process
- [ ] **Cost:** R 50,000 (training + consulting)

### Month 4 (September 2026)

- [ ] Register for VAT (if revenue >R 1M projected)
- [ ] Set up tax accounting (QuickBooks or Sage)
- [ ] File first provisional tax estimate with SARS
- [ ] First monthly VAT return (if VAT-registered)
- [ ] **Cost:** R 20,000 (VAT + accounting software)

### Month 5-6 (October-November 2026)

- [ ] Prepare for FSCA approval (expected by end of Month 6)
- [ ] UAT testing on compliance-monitor (SAR automation)
- [ ] Internal compliance audits (monthly)
- [ ] **Cost:** R 30,000 (testing + QA)

### Month 7 (December 2026)

- [ ] FSCA approval (likely, may have follow-up questions)
- [ ] Year-end accounting (P&L, balance sheet)
- [ ] Annual compliance report to POPIA Commissioner
- [ ] **Cost:** R 50,000 (year-end audit, compliance report)

### Months 8-12 (January-June 2027)

- [ ] Operating under FSCA license
- [ ] Monthly VAT returns
- [ ] Quarterly provisional tax payments (if estimated <R 200k/year CIT)
- [ ] Monthly SAR monitoring (if any suspicious transactions)
- [ ] Annual compliance audits (POPIA, AML/CFT)
- [ ] February: File CIT annual return with SARS
- [ ] **Monthly cost:** R 30,000-50,000 (compliance, tax accounting)

---

## 9. Regulatory Contacts & Resources

### South African Regulators

| Authority | Website | Phone | Email |
|-----------|---------|-------|-------|
| **FSCA** | www.fsca.org.za | 086 110 2927 | fpinfo@fsca.org.za |
| **SARB** | www.resbank.co.za | 012 313 3911 | info@resbank.co.za |
| **FIC** | www.fic.gov.za | 012 315 1234 | enquiries@fic.gov.za |
| **SARS** | www.sars.gov.za | 0800 00 7277 (toll-free) | contactcentre@sars.gov.za |
| **POPIA Commissioner** | www.inforegulator.org.za | 012 406 0540 | popia@justice.gov.za |
| **CIPC** | www.cipc.co.za | 0861 161 630 | info@cipc.co.za |

### Recommended Legal/Compliance Partners

| Firm | Specialty | Website |
|------|-----------|---------|
| **Bowmans** | Payment regulation, fintech | bowmanslaw.com |
| **Clifford Chance** | International, crypto | cliffordchance.com |
| **Deloitte SA** | Compliance audits, AML/CFT | deloitte.co.za |
| **EY SA** | Tax, regulatory advisory | ey.com/en_za |
| **Dunkels Pasricha Inc.** | Data protection (POPIA) | dp-law.co.za |

### Useful Government Portals

- **SARS eFiling:** https://www.sars.gov.za/individuals/filing/
- **CIPC e-Services:** https://www.cipc.co.za/
- **FIC SAR Portal:** https://www.fic.gov.za/sars/
- **POPIA Commissioner:** https://www.inforegulator.org.za/

---

## 10. Summary: Regulatory Approval Timeline

```
MONTH 1    MONTH 2    MONTH 3    MONTH 4    MONTH 5-6  MONTH 7
│          │          │          │          │          │
Company    FSCA       FSCA       VAT        FSCA       FSCA
Setup      Submitted  Review     Register   Decision   Approved
           Audit      (8-12wks)  (if needed) Expected
FIC        Tax        SAR        Training   Internal
Register   Setup      Training   & Testing  Audits
DPO        BEE        Compliance
Appointed  Cert       Team Prep
           
├─── SIMULTANEOUS ACTIVITIES ───────────────────────────┤
   AWS Architecture (af-south-1)
   EKS Deployment (staging → production)
   Compliance Monitoring Tool Development
   Merchant Onboarding Flow (KYC/AML)
   Bank API Integration (Nedbank, FNB)
   
├─ MONTHS 4+ OPERATIONS ─┤
   Monthly VAT returns
   Quarterly tax payments
   Monthly SAR monitoring
   Annual compliance audits
   Continuous merchant KYC reviews
```

---

## 11. Approval Checklist (Go/No-Go for Launch)

### Pre-Launch Approvals Required

- [ ] FSCA Money Transmitter License: **APPROVED**
- [ ] FIC Reporting Entity: **REGISTERED**
- [ ] POPIA DPO: **APPOINTED**
- [ ] Tax Registration Number: **ACTIVE**
- [ ] VAT Registration (if >R 1M GMV): **ACTIVE**
- [ ] Professional Indemnity Insurance: **ACTIVE**
- [ ] Cyber Insurance: **ACTIVE**
- [ ] AWS Infrastructure (af-south-1): **TESTED & VERIFIED**
- [ ] Compliance-Monitor Service: **DEPLOYED & TESTED**
- [ ] Bank API Integration (Plaid + Nedbank): **TESTED WITH LIVE SANDBOX**
- [ ] AML/CFT Procedures: **DOCUMENTED & TRAINED**
- [ ] SAR Process: **DOCUMENTED & TESTED**
- [ ] Incident Response Plan: **DOCUMENTED**
- [ ] Data Retention Policy: **IMPLEMENTED**

### Post-Launch Compliance (Months 1-6)

- [ ] Monthly compliance reports to board
- [ ] Quarterly SAR reports to FIC (if filed any)
- [ ] Monthly KYC reviews for high-risk merchants
- [ ] Monthly VAT returns to SARS
- [ ] Quarterly provisional tax payments
- [ ] Annual AML/CFT effectiveness audit (FSCA)
- [ ] Annual POPIA compliance audit
- [ ] Annual insurance renewal
- [ ] February 2027: CIT annual return to SARS

---

**Last Updated:** June 2026  
**Status:** Ready for Regulatory Submission  
**Next Review:** October 2026 (after FSCA approval)
