# ForgePay South Africa: Compliance Playbook

## Day-to-Day Compliance Operations

### Daily (Automated)

#### Transaction Monitoring

**Process:**
1. **compliance-monitor service** runs every 6 hours
2. Queries all transactions from past 6 hours
3. Applies risk rules (see below)
4. Flags suspicious transactions in Slack + dashboard
5. Compliance officer reviews within 2 hours

**Rules (AML/CFT):**

```yaml
# Transaction monitoring rules
rules:
  - name: "large_transfer"
    condition: "amount > R50000"
    action: "flag"
    risk_level: "medium"
    review_required: true
    
  - name: "rapid_cycling"
    condition: "merchant receives 3+ transfers within 1 hour from different accounts"
    action: "flag"
    risk_level: "high"
    sars_if_confirmed: true
    
  - name: "structuring"
    condition: "5+ transfers from same sender to different merchant accounts, each R40-48k"
    action: "flag"
    risk_level: "critical"
    sars_if_confirmed: true
    
  - name: "new_merchant_large_txn"
    condition: "merchant created <7 days ago AND receives transfer >R100k"
    action: "flag"
    risk_level: "high"
    
  - name: "cross_border_high_value"
    condition: "transfer to international recipient >R500k"
    action: "flag"
    risk_level: "high"
    
  - name: "high_risk_country"
    condition: "recipient country IN [Iran, North Korea, Syria, Belarus, Russia_secondary]"
    action: "block"
    risk_level: "critical"
    sars_automatic: true
```

**Daily Alert Example:**

```
🚨 COMPLIANCE ALERT — June 25, 2026 2:45 PM

MERCHANT: TechCorp ZA (ID: merchant_abc123)
TRANSACTION: R 75,000 transfer to FNB account

RISK FACTORS:
- Amount: > R 50k threshold ✓
- Merchant history: 3 large transfers in past 2 hours
- Merchant age: 12 days old ⚠️
- Customer ID: Known logistics company (low-risk profile)

RECOMMENDATION: Allow (monitor further)
MANUAL REVIEW: No
---
ACTION: No action needed, transaction allowed.
```

#### Daily Compliance Checklist

**8:00 AM — Open Compliance Dashboard**

- [ ] Check Slack alerts from overnight (compliance channel)
- [ ] Review flagged transactions (count, risk levels)
- [ ] Any SARs filed? Check FIC status
- [ ] Any FSCA notices overnight? (Check email + FSCA portal)

**10:00 AM — Transaction Review**

- [ ] Review each flagged transaction (20-30 min)
- [ ] Document: Allow, Investigate, or Recommend SAR
- [ ] Update compliance-monitor dashboard with decision
- [ ] Notify merchant if account suspended

**2:00 PM — Merchant KYC Verification**

- [ ] New merchant onboarding (if any): Approve or reject
- [ ] Re-verify merchant info (spot checks, 5 merchants/day)
- [ ] Update merchant risk profile (low/medium/high)

**4:00 PM — End-of-Day Summary**

- [ ] Email to CEO: Transactions processed, flags, actions taken
- [ ] Update compliance log (for audits)
- [ ] Set alerts for next day (if patterns detected)

---

### Weekly (Manual Review)

**Every Monday:**

#### 1. Weekly Compliance Meeting (1 hour)

**Attendees:** Compliance officer, CEO, DevOps engineer

**Agenda:**
1. **Metrics:** Transactions flagged, SARs filed, time to resolution
2. **Patterns:** Any emerging suspicious patterns?
3. **Incidents:** Any security incidents, data breaches?
4. **Regulatory:** FSCA updates, FIC guidance, law changes?
5. **Action items:** What to implement next week?

#### 2. Merchant Risk Assessment (2 hours)

**Process:**
- Review 10 merchants (oldest to newest, focus on high-volume)
- Check: Transaction patterns, customer profiles, geographic spread
- Update risk score (low/medium/high/critical)
- If critical: Escalate to CEO for possible suspension

**Risk Assessment Template:**

```
MERCHANT RISK ASSESSMENT
========================
Name: [Merchant]
ID: merchant_[ID]
Account age: [Days/months]
Total GMV: R [Amount]
Last 30-day GMV: R [Amount]
Transaction count: [X]

PROFILE ANALYSIS:
- Business type: [E-commerce, Crypto, SaaS, Other]
- Primary customers: [Geographic: ZA/International, Type: B2B/B2C]
- Payment methods: [Cards, EFT, Crypto]
- Settlement speed: [Next day, Weekly, On-demand]
- Average transaction: R [Amount]

RISK FACTORS:
☐ New merchant (<30 days)
☐ Rapid growth (GMV doubled week-over-week)
☐ Unusual geographic pattern (mostly international)
☐ Structuring (multiple small transfers)
☐ Rapid cycling (funds in/out within hours)
☐ High-risk business (crypto, remittance, gambling)

RISK SCORE:
LOW: 0-20 points
MEDIUM: 21-50 points
HIGH: 51-80 points
CRITICAL: 81-100 points

MITIGATION (if HIGH/CRITICAL):
- [ ] Enhanced due diligence (call merchant, verify business)
- [ ] Reduce transaction limits (e.g., max R 100k/day)
- [ ] Increase monitoring frequency (every 6 hours vs 24 hours)
- [ ] Escalate to FSCA (if money laundering suspected)

APPROVAL: ☐ Low risk ☐ Medium (monitor) ☐ High (restrict) ☐ Suspend
```

#### 3. SAR Review (30 min)

- Check all SARs filed in past week
- Verify FIC received (check FIC portal)
- Document outcome (FIC acknowledged, under investigation, etc.)

---

### Monthly (Compliance Reporting)

**Due:** Last business day of month

#### 1. Monthly Compliance Report (for board)

**Template:**

```
MONTHLY COMPLIANCE REPORT
=========================
Month: [June 2026]
Report Date: [June 28, 2026]
Prepared by: [Compliance Officer]

EXECUTIVE SUMMARY
-----------------
Total transactions: 5,000
Total GMV: R 10,000,000
Flagged transactions: 45 (0.9%)
SARs filed: 2
FSCA violations: 0
Security incidents: 0

TRANSACTION METRICS
-------------------
Transactions by type:
- Card payments: 2,000 (40%, R 4M)
- EFT transfers: 2,500 (50%, R 5M)
- Crypto/stablecoin: 500 (10%, R 1M)

Flagged by reason:
- Large transfer (>R 50k): 30 (67%)
- Rapid cycling: 10 (22%)
- New merchant + large txn: 5 (11%)

Average resolution time: 2 hours 15 min (target: <4 hours)

AML/CFT METRICS
---------------
Merchants added: 25
Merchants suspended: 0
KYC approval rate: 95% (24/25)
KYC re-verification: 10 merchants reviewed, all passed

SAR FILING
----------
SARs filed: 2
Reason 1: Rapid cycling (crypto merchant)
Reason 2: Cross-border transfer to high-risk country (flagged, not filed)

FIC communication: All SARs acknowledged by FIC within 5 days

FSCA COMPLIANCE
---------------
License status: Active (no issues)
Violations: 0
Requests/clarifications: 0
Last FSCA communication: [Date]

SECURITY & DATA
---------------
Data access incidents: 0
Unauthorized access attempts: 0 (blocked by WAF)
Backup integrity: ✓ Verified
Data retention: 100% compliant (5-year archive)
POPIA audits: Quarterly review on schedule

STAFF TRAINING
--------------
AML/CFT training hours: 4 hours (mandatory quarterly)
New staff trained: [Names + training date]
Compliance certifications: [Who is ACAMS certified]

RECOMMENDATIONS
---------------
1. [Action item 1]
2. [Action item 2]

SIGN-OFF
--------
Approved by: [CEO Name]
Date: [June 28, 2026]
```

#### 2. Financial Summary

**Report to CFO:**

```
MONTHLY FINANCIAL SUMMARY
==========================
Month: June 2026
GMV: R 10,000,000
Fee revenue (2.5% avg): R 250,000
Settlement cost: R 12,500 (0.125% avg)
Gross profit: R 237,500
Operating costs (% of revenue):
- Salaries: 60%
- AWS: 15%
- Compliance: 10%
- Other: 15%

Net margin: -60% (Year 1, expected)

Key metrics:
- Merchants: 50
- Avg merchant GMV: R 200,000
- Repeat merchant rate: 95% (good retention)
- New merchant CAC (Customer Acquisition Cost): R 5,000
- Merchant LTV (Lifetime Value): R 250,000 (50 months payback)
```

#### 3. Regulatory Status Report

**Report to board/investors:**

```
REGULATORY STATUS
=================
FSCA License: Active ✓
FIC Registration: Active ✓
POPIA DPO: Appointed ✓
VAT Registration: [If applicable, status]
Insurance: Current ✓

AUDITS SCHEDULED:
- Annual FSCA compliance audit: [Month/Year]
- Annual PCI-DSS audit: [Month/Year]
- Annual POPIA audit: [Month/Year]
- Security penetration test: [Month/Year]

NEXT REGULATORY MILESTONES:
- [Date]: FSCA annual report due
- [Date]: SAR reporting to FIC (if needed)
- [Date]: POPIA Commissioner check-in
```

---

### Quarterly (Formal Audits)

**Due:** Last day of quarter (Mar 31, Jun 30, Sep 30, Dec 31)

#### 1. Quarterly Compliance Audit

**Scope:**
- All transactions (sample audit, 10% of transactions)
- All merchants (risk assessment review)
- All SARs (verify proper filing)
- Staff training (verify completion)
- Data retention (spot checks)

**Audit Checklist:**

```
QUARTERLY COMPLIANCE AUDIT
===========================
Quarter: Q2 2026 (Apr-Jun)
Audit Date: June 30, 2026
Auditor: [Internal compliance officer + external firm annually]

TRANSACTION AUDIT (10% sample)
------------------------------
- Total transactions: 5,000
- Sampled: 500 (10%)
- Flagged in sample: 45 (9%)
- Properly documented: 43/45 (95%)
- Issues found: 2 (insufficient documentation)
- Action: Add documentation to compliance file

MERCHANT AUDIT
--------------
- Total merchants: 50
- Merchants reviewed: 50 (100%)
- KYC complete: 50/50 (100%)
- Risk score current: 48/50 (96%)
- Issues: 2 merchants need KYC refresh (>1 year old)
- Action: Re-verify by next quarter

SAR REVIEW
----------
- SARs filed: 2
- FIC notification: 2/2 (100%)
- SAR template complete: 2/2 (100%)
- Supporting docs attached: 2/2 (100%)
- Issues: 0

STAFF COMPLIANCE
----------------
- Compliance officer: ✓ ACAMS certified, training current
- All staff: ✓ Quarterly AML/CFT training completed
- New hires: ✓ Trained within 7 days of start

DATA RETENTION & SECURITY
--------------------------
- Audit logs: 100% retained (CloudWatch logs)
- Merchant data: 100% encrypted at rest and in transit
- Backups: ✓ Daily, versioned, tested
- Breach incidents: 0

FINDINGS
--------
Severity: Low
- [Finding 1]: Improve KYC documentation templates
- [Finding 2]: Standardize SAR filing process
Recommendations:
- [Recommendation 1]

SIGN-OFF
--------
Auditor: [Name], [Title]
Date: June 30, 2026
Approved: [CEO]
```

#### 2. Quarterly Board Compliance Report

**Template:**

```
QUARTERLY BOARD REPORT
======================
Period: Q2 2026 (Apr-Jun 30)
Presented by: Compliance Officer

OVERVIEW
--------
- GMV: R 10M (Month 4), R 10M (Month 5), R 15M (Month 6) = R 35M quarterly
- Merchants: 50 active
- Transactions: 15,000
- Compliance incidents: 0
- Regulatory violations: 0

KEY METRICS
-----------
- KYC approval rate: 95%
- SAR filing timeliness: 100%
- Uptime SLA: 99.96%
- Security incidents: 0

REGULATORY UPDATES
------------------
- FSCA: No communication (good sign)
- FIC: Acknowledged 2 SARs, investigation ongoing (typical)
- POPIA: On track for annual audit
- Insurance: Renewed without issues

RISKS & MITIGATIONS
-------------------
Risk 1: Crypto merchants increasing (2% → 8% of GMV)
- Mitigation: Enhanced KYC for all crypto merchants, SAR monitoring

Risk 2: Cross-border transfers trending up (5% → 15% of volume)
- Mitigation: Implement geographic due diligence, block high-risk countries

LOOKING AHEAD
-------------
- Expand to 100 merchants by Month 6
- Launch automated SAR filing (Month 5)
- Conduct security audit (Month 6)
```

---

### Annually (Full Compliance Audit)

**Due:** January 30 (for previous year)

#### 1. Annual FSCA Compliance Report

**Template:**

```
ANNUAL COMPLIANCE REPORT TO FSCA
=================================
Reporting Period: January 1 - December 31, 2026
Submitted by: ForgePay SA (Pty) Ltd
Date: January 30, 2027

1. BUSINESS OVERVIEW
--------------------
Total GMV: R 100-200 million
Total transactions: 50,000+
Number of merchants: 200+
Number of employees: 15+

2. AML/CFT PROGRAM
------------------
Customer Due Diligence:
- KYC procedures documented: ✓
- All new customers verified: 100%
- Re-verification of existing customers: 100%
- Customer profile risk assessment: Documented for each

Ongoing Transaction Monitoring:
- System implemented: Yes (compliance-monitor service)
- Transaction threshold: R 50,000
- Monitoring frequency: Continuous (automated 6-hourly reviews)
- Manual review: Daily by trained staff
- Suspicious transactions identified: 120+
- SARs filed: 12+

Suspicious Activity Reporting:
- SARs filed with FIC: 12
- SARs timely filed (within 30 days): 100%
- Average filing time: 8 days
- FIC acknowledgment: Received for all
- Outcomes: [X under investigation, Y referred to law enforcement, Z closed]

Record Retention:
- Customer records: All retained for 5+ years
- Transaction records: All retained for 5+ years
- Audit trail: 100% maintained
- Data deletion: Secure procedures in place

3. STAFF TRAINING & COMPLIANCE
-------------------------------
AML/CFT Training:
- Compliance officer: ACAMS certified, training current
- All staff: Quarterly mandatory training (4 hours/year minimum)
- New hires: Trained within 7 days of employment
- Training materials: Reviewed annually

Compliance:
- No violations of FAIS Act, POCA, FICA
- No regulatory incidents
- Zero data breaches
- Staff turnover: Low

4. TECHNOLOGY & SECURITY
------------------------
Systems:
- Payment processing: Secure, PCI-DSS compliant
- Data storage: Encrypted AES-256
- Backups: Daily, geographically redundant
- Disaster recovery: Tested quarterly, RTO 4 hours, RPO 1 hour
- Monitoring: 24/7 alerts via CloudWatch + Prometheus

Security:
- Penetration testing: Annual, [Date of last test]
- Vulnerability scanning: Continuous (automated)
- Incident response: Plan in place, tested annually
- Insurance: Professional indemnity (R 5M) + cyber (R 10M)

5. BUSINESS INTEGRITY
---------------------
Conflicts of Interest:
- Documented: ✓
- No violations: ✓

Reporting Quality:
- Financial statements: Audited ✓
- Tax compliance: Filed ✓
- VAT: Compliant ✓

6. RECOMMENDATIONS & IMPROVEMENTS
---------------------------------
Implemented in 2026:
1. Automated SAR filing (reduced manual errors)
2. Enhanced crypto merchant KYC
3. Geographic due diligence system

Planned for 2027:
1. Real-time transaction monitoring (migrate from 6-hourly)
2. Blockchain analysis for crypto transactions
3. Expanded staff training on emerging risks

SIGN-OFF
--------
Prepared by: [Compliance Officer]
Reviewed by: [CEO]
Authorized by: [Board]
Date: January 30, 2027
```

#### 2. Annual PCI-DSS Compliance Report

**Timeline:** October (after 12 months of operation)

**Scope:**
- Payment card handling procedures
- Data storage and encryption
- Access controls
- Network security
- Incident response

**Third-party auditor:** Annual assessment (R 30,000-50,000)

**Report includes:**
- PCI compliance checklist (12 major requirements)
- Findings and remediation status
- Security test results (penetration test, vulnerability scan)
- Staff training on PCI procedures

#### 3. Annual POPIA Data Protection Report

**Timeline:** December 31 (for January 31 submission)

**Scope:**
- Personal data inventory
- Legal basis assessment
- Data subject rights
- Retention and deletion procedures
- Data breach log
- DPO activities

**Report includes:**
- POPIA compliance checklist
- Findings and improvement actions
- Data access violations (if any)
- Staff training completion

---

## SAR (Suspicious Activity Report) Filing Process

### How to File a SAR with FIC

**Timeline:** Within 30 days of detection

**Step 1: Identify Suspicious Activity** (Daily)

Triggers for SAR:
- ✅ Single transaction >R 50,000 (automatic review)
- ✅ Structuring (splitting R 100k into 3× R 35k transfers)
- ✅ Rapid cycling (money in/out within 1 hour)
- ✅ Unusual geographic pattern (sender in high-risk country)
- ✅ Inconsistent with merchant profile
- ✅ Multiple merchants, single funding source

**Step 2: Investigate** (Days 1-5)

- [ ] Pull transaction details
- [ ] Pull merchant KYC docs (ID, business registration, proof of address)
- [ ] Review customer communication (if available)
- [ ] Check transaction history (past 90 days for merchant)
- [ ] Document all findings (screenshots, notes)

**Step 3: Document SAR** (Days 5-7)

Use official FIC SAR template (available at www.fic.gov.za/sars/):

```
SUSPICIOUS ACTIVITY REPORT (SAR)
=================================
Reference Number: (auto-generated by FIC when filed)
Your Reference: ForgePay-[MERCHANT_ID]-[DATE]

REPORTING ENTITY
----------------
Name: ForgePay SA (Pty) Ltd
Tax Registration Number (TRN): [Your TRN]
Contact: [Compliance Officer], [Email], [Phone]

ACTIVITY DETAILS
----------------
Date of Activity: June 25, 2026, 2:35 PM
Type: Electronic Funds Transfer (EFT)
Amount: R 250,000
Currency: ZAR

SENDING PARTY
-------------
Name/Account: TechCorp ZA
Merchant ID: merchant_xyz789
Account number: (last 4 digits) 1234
Bank: Nedbank

RECEIVING PARTY
----------------
Name: Unknown Individual
Recipient account: (provided by TechCorp)
Recipient bank: FNB

NARRATIVE
---------
On June 25, 2026, we detected a suspicious transfer of R 250,000 from merchant 
TechCorp ZA to an unknown beneficiary at FNB. The merchant, a software development 
company claiming R 5M annual revenue, received this exact amount from 5 different 
individuals on June 25 between 1:00-3:00 PM, then immediately transferred it out 
to a single beneficiary not previously seen in their transaction history.

This pattern is consistent with money mule activity or layering in a money laundering 
scheme (funds received from multiple sources, consolidated, then transferred to single 
beneficiary). The rapid cycling (money in/out within 2 hours) and new recipient account 
raise AML/CFT concerns.

RISK ASSESSMENT
---------------
Risk Level: HIGH
- Multiple source accounts (high-risk indicator)
- Rapid cycling (low dwell time)
- Beneficiary unknown (KYC incomplete)
- Inconsistent with business profile
- Amount (R 250k) meets threshold

PREVIOUS SARs
-----------
Any previous SARs on this merchant? No
Any previous SARs on this customer? No

SUPPORTING DOCUMENTS
--------------------
Attached:
- Merchant onboarding KYC (ID, business registration, proof of address)
- Transaction logs (June 25, transactions 1-5 incoming)
- Merchant communication (email regarding transfer, if available)
- Source customer transaction history (sample)

RECOMMENDED ACTION
------------------
☐ Monitor (continue watching, no immediate action)
☐ Restrict (limit transaction size, require manual approval)
☐ Suspend (freeze account pending investigation)
☐ Escalate (possible referral to law enforcement)

Our recommendation: SUSPEND merchant account pending manual review by FIC.
Transaction amount: R 250,000 (above SARS threshold for investigation initiation)

DECLARATION
-----------
I declare that the information provided above is true and correct to the best of 
my knowledge and belief.

Signed: [Compliance Officer Name]
Position: Chief Compliance Officer
ForgePay SA (Pty) Ltd
Date: June 27, 2026
```

**Step 4: Submit to FIC** (Days 7-8)

1. **Upload to FIC portal:** www.fic.gov.za/sars/
2. **Login:** Use FSCA-provided credentials
3. **Submit SAR form** + all supporting documents (PDF)
4. **System confirms receipt** (within 5 minutes)
5. **FIC sends acknowledgment email** (within 5 days)

**Step 5: Track Follow-up** (Days 8+)

- **Enter FIC SAR number** in compliance tracking system
- **Check FIC portal monthly** for investigation status
- **Maintain documentation** (may be requested for court proceedings)
- **No statute of limitations** — keep records indefinitely

### Sample SAR Response Email to Merchant

**If you suspend merchant account due to SAR:**

```
SUBJECT: Account Review — Action Required

Dear [Merchant Name],

We have detected unusual activity on your ForgePay account and have temporarily 
suspended your account pending further review.

DETAILS:
- Account: [Merchant ID]
- Activity date: [Date]
- Reason: Multiple large transfers received and immediately transferred out 
  (pattern inconsistent with typical [business type] operations)

NEXT STEPS:
1. We will contact you within 24 hours to discuss this activity
2. Please prepare documentation: Invoices, customer receipts, business justification
3. We may retain funds temporarily (up to 10 days) while we investigate

IMPORTANT: DO NOT discuss this account restriction with anyone except your 
accountant or lawyer (we are required by law to file a Suspicious Activity Report 
with the Financial Intelligence Centre).

If you believe this is an error, please reply to this email immediately.

Best regards,
[Compliance Officer]
ForgePay South Africa
compliance@forgepay.africa
```

---

## Common AML/CFT Typologies for South Africa

### 1. Structuring (Below-the-Radar Transfers)

**Pattern:** Deliberate splitting of large amounts into sub-R 50k transfers

**Red flags:**
- 4-5 transfers of R 45-49k from different individuals to one merchant
- All on same day, within 2-hour window
- Funds immediately transferred out to single beneficiary

**How to detect:** Compliance-monitor scans for this pattern

**SAR action:** ESCALATE — File SAR immediately

---

### 2. Rapid Cycling (Money Laundering Layer)

**Pattern:** Funds received, held <1 hour, then transferred out

**Red flags:**
- Money in at 10:00 AM, money out at 10:45 AM
- Multiple incoming sources (5-10 different accounts)
- Single outgoing destination
- Amount doubles at each step (consolidation)

**How to detect:** Monitor settlement time for each merchant

**SAR action:** ESCALATE — Possible layering scheme

---

### 3. Trade-Based Money Laundering (Over/Under-Invoicing)

**Pattern:** Merchant invoices for inflated goods/services, customer pays, funds transferred to offshore account

**Red flags:**
- E-commerce merchant with unusually high "refund rate" (30-50%)
- Refunds to international bank accounts
- Large invoices but low-value goods shipped

**How to detect:** Review merchant business profile vs transaction patterns

**SAR action:** INVESTIGATE — Request merchant documentation

---

### 4. Cryptocurrency Layering

**Pattern:** Crypto exchange deposits cash, converts to crypto, moves to DeFi for yield, then cashes out

**Red flags:**
- Merchant claims to be SaaS, but accepts crypto payments only
- All crypto immediately converted to stablecoins (USDC/USDT)
- Stablecoins immediately sent to yield protocols (Aave, Curve)
- Yields then withdrawn to Tornado.cash or other mixer

**How to detect:** Block known mixing services (Tornado.cash), flag high-yield claims

**SAR action:** BLOCK — Likely money laundering via DeFi

---

### 5. Remittance Fraud

**Pattern:** Scammer bilks victim, then uses ForgePay to send money to offshore accomplice

**Red flags:**
- Large single transfer (>R 100k) from first-time customer
- Recipient country is high-risk (Nigeria, China, Middle East)
- Customer creates account, sends funds, never logs in again
- Amount matches "romance scam" or "advance fee" fraud typical amounts

**How to detect:** Check "account age vs transaction size" ratio

**SAR action:** BLOCK — Likely fraud victim's account being abused

---

## Merchant Suspension Protocol

**When to suspend a merchant account:**

1. **Critical AML/CFT violations** (SAR filed, FIC investigation)
2. **Security breach** (customer data compromised)
3. **Regulatory violation** (repeated violations)
4. **Fraud** (merchant itself engaged in fraudulent activity)

### Suspension Steps

**Step 1: Immediate Action** (Same day)

- [ ] Freeze all merchant transactions (no payments allowed)
- [ ] Freeze all settlement pulls (no fund withdrawals)
- [ ] Log all suspended transactions in compliance system
- [ ] Send notification email to merchant

**Step 2: Investigation** (Days 1-5)

- [ ] Document reason for suspension
- [ ] Gather evidence (transactions, customer complaints, regulatory concerns)
- [ ] Contact merchant for explanation
- [ ] Review decision with CEO

**Step 3: Decision** (Day 5)

- [ ] **Reinstate:** If merchant provides satisfactory explanation
- [ ] **Continue suspension:** If issues unresolved
- [ ] **Terminate:** If merchant engaged in fraud/illegal activity
- [ ] Notify merchant of decision

**Step 4: Reinstatement** (If approved)

- [ ] Unfreeze account
- [ ] Re-enable settlement
- [ ] Send reinstatement email
- [ ] Increase monitoring (daily checks vs weekly)

**Step 5: Termination** (If no resolution)

- [ ] Close merchant account
- [ ] Calculate final settlement amount (less any merchant liability)
- [ ] File SAR (if criminal activity suspected)
- [ ] Report to FSCA (if regulatory violation)
- [ ] Retain records for 5+ years

---

## Training Schedule

### Quarterly AML/CFT Training (Mandatory for all staff)

**Duration:** 2 hours  
**Frequency:** Every quarter (4 hours/year minimum)

**Topics:**
1. AML/CFT overview (30 min) — POCA, FICA, FSCA requirements
2. Merchant due diligence (30 min) — How to verify merchant legitimacy
3. Transaction monitoring (30 min) — Red flags, suspicious patterns
4. SAR filing (30 min) — How to file, documentation requirements

**Documentation:**
- Training attendance sign-in sheet (kept for audit)
- Training materials (provided to all staff)
- Quiz (pass/fail, 70% required to pass)

**Trainer:** Compliance officer (internal) or external consultant (annual refresher)

### Annual Refresher Training

**For compliance officer:**
- [ ] ACAMS certification renewal (if expired)
- [ ] FSCA regulatory updates
- [ ] FIC guidance (new typologies, enforcement actions)
- [ ] International best practices (IMF, World Bank AML/CFT standards)

**Cost:** R 5,000-10,000/year (online courses + annual ACAMS renewal fee)

---

## Monthly Compliance Checklist Template

```
MONTHLY COMPLIANCE CHECKLIST
=============================
Month: [MONTH/YEAR]
Completed by: [Compliance Officer]
Date: [DATE]

DAILY OPERATIONS
┌─────────────────────────┬──────────┬────────┐
│ Activity                │ Expected │ Actual │
├─────────────────────────┼──────────┼────────┤
│ Transaction monitoring  │ 20       │ [20]   │
│ Flagged transactions    │ <2%      │ [1.8%] │
│ Average review time     │ <4 hrs   │ [2h]   │
└─────────────────────────┴──────────┴────────┘

WEEKLY OPERATIONS
┌─────────────────────────┬──────────┬────────┐
│ Activity                │ Expected │ Actual │
├─────────────────────────┼──────────┼────────┤
│ Compliance meetings     │ 1        │ [1]    │
│ Merchant reviews        │ 10       │ [10]   │
│ SAR updates from FIC    │ Variable │ [1]    │
└─────────────────────────┴──────────┴────────┘

MONTHLY OPERATIONS
┌─────────────────────────┬──────────┬────────┐
│ Activity                │ Expected │ Actual │
├─────────────────────────┼──────────┼────────┤
│ Monthly board report    │ 1        │ [1]    │
│ Financial summary       │ 1        │ [1]    │
│ Regulatory status       │ 1        │ [1]    │
│ Staff training          │ 100%     │ [100%] │
└─────────────────────────┴──────────┴────────┘

ISSUES IDENTIFIED
☐ [Issue 1] — Resolution: [Action]
☐ [Issue 2] — Resolution: [Action]

SIGN-OFF
--------
Compliance Officer: _________________ Date: _______
CEO: ______________________________ Date: _______
```

---

**Last Updated:** June 2026  
**Status:** Ready for Operations  
**Next: Train team on playbook before Month 1 launch**
