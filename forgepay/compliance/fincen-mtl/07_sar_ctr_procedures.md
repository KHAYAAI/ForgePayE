# SAR and CTR Filing Procedures
## Suspicious Activity Reports and Currency Transaction Reports

**Authority:**
- SAR: 31 CFR 1022.320 (MSB SAR filing requirement)
- CTR: 31 CFR 1010.311 and 31 CFR 1022.310 (MSB CTR filing requirement)
- Filing System: FinCEN BSA E-Filing System — https://bsaefiling.fincen.treas.gov

---

## Part I: Suspicious Activity Reports (SARs)

### What Is a SAR?

A Suspicious Activity Report (SAR) is a confidential report filed with FinCEN when ForgePay knows, suspects, or has reason to suspect that a transaction involves funds from illegal activity, is designed to evade BSA requirements, or lacks a lawful purpose. SARs are a critical law enforcement tool — they are analyzed by FinCEN, the FBI, DEA, and other agencies.

**FinCEN SAR Form:** FinCEN SAR (Form 111)
**Filing System:** BSA E-Filing System at https://bsaefiling.fincen.treas.gov

---

### SAR Filing Thresholds for MSBs (31 CFR 1022.320)

ForgePay must file a SAR when a transaction (or pattern of transactions) involves:

| Threshold | Condition |
|-----------|-----------|
| **$2,000 or more** | Transaction involves funds from illegal activity OR is designed to evade BSA reporting |
| **$5,000 or more** | Transaction involves potential money laundering, structuring, or other suspicious activity |
| **No minimum** | Transactions involving known or suspected terrorist financing |

**The $2,000 threshold applies to MSBs** — lower than the $5,000 threshold for banks. This is critical: ForgePay must apply the $2,000 threshold.

**Note on crypto:** FinCEN has confirmed that virtual currency transactions meeting the threshold triggers are subject to the same SAR requirements. A $2,000+ suspicious BTC transaction requires a SAR.

---

### SAR Filing Triggers — ForgePay AML Engine Rule Mapping

The following events in ForgePay's AML engine should trigger SAR evaluation:

| AML Rule | Trigger | SAR Evaluation Required |
|----------|---------|------------------------|
| AML-001 | Single transaction > $10,000 | Only if suspicious pattern; not automatically |
| AML-002 | Structuring/smurfing (multiple sub-$10K transactions totaling > $10K) | **Yes — structuring is SAR-mandatory** |
| AML-003 | High-risk country transaction | If combined with other red flags |
| AML-004 | OFAC match | No SAR needed; file OFAC blocked property report instead. If near-miss, consider SAR |
| AML-005 | Velocity anomaly | If no plausible business explanation |
| AML-006 | Crypto mixing | **Yes — strong SAR indicator** |
| AML-007 | Dark market indicators (Chainalysis risk > 75) | **Yes — file SAR** |
| AML-008 | Dormant account sudden activation | If combined with suspicious volume |

**Other SAR Triggers (Beyond Automated Rules):**
- Customer refuses to provide identity information or documentation
- Customer presents implausible explanations for transaction activity
- Business type does not match transaction activity
- Customer knowingly tries to circumvent BSA requirements
- Law enforcement requests information about a customer
- Transaction appears designed to avoid CTR filing (structuring)
- Customer provides false or altered identification documents
- Employee reports suspicious activity

---

### SAR Filing Timeline

| Scenario | Filing Deadline |
|----------|----------------|
| Suspicious activity identified, subject identified | **30 calendar days** from date of detection |
| Suspicious activity identified, no subject identified | **60 calendar days** from date of detection |
| Continuing suspicious activity (ongoing) | File initial SAR; file follow-up SAR every **90 days** while activity continues |
| Terrorist financing (any amount) | **Immediately** — contact FinCEN Financial Intelligence Unit and file SAR as soon as possible |

**Date of Detection:** The date on which the facts become apparent that warrant filing a SAR, after a reasonable review. This is not always the date of the transaction.

---

### SAR Filing Procedure — Step by Step

#### Step 1: Detection and Initial Review

1. AML engine generates an alert OR employee escalates suspicious activity to CCO
2. Compliance analyst performs initial review:
   - Gather all available transaction records
   - Review customer KYC/CDD file
   - Review transaction history
   - Determine if threshold is met ($2,000+ for MSBs)
3. Document the review in the compliance case management system

#### Step 2: CCO Decision

The CCO makes the final SAR filing decision:
- **File:** Suspicious activity meets the threshold and cannot be explained
- **Do Not File:** Reviewed and found not suspicious; document reasoning thoroughly
- **Pending:** Gather more information (set a deadline — do not let pending reviews age past the 30-day deadline)

**The CCO's decision to file a SAR must be documented. The decision NOT to file must be equally well-documented.**

#### Step 3: Prepare FinCEN SAR Form 111

Log into BSA E-Filing at https://bsaefiling.fincen.treas.gov and complete SAR Form 111:

**Part I — Filing Institution Information**
- ForgePay's legal name
- EIN
- FinCEN MSB Registration Number
- Address
- CCO contact information

**Part II — Subject Information** (if known)
- Full name of the subject
- Date of birth
- SSN or ITIN
- Address
- Phone number
- Identification documents (type, number, issuing country)
- Relationship to ForgePay (customer, counterparty, employee, etc.)
- Occupation or business type

**Part III — Suspicious Activity Information**
- Date(s) of suspicious activity
- Dollar amount(s)
- Type of suspicious activity (check all that apply):
  - Money laundering
  - Structuring / smurfing
  - Terrorist financing
  - Fraud
  - Cyber event
  - Identification / documentation
  - Other
- Virtual currency involvement (yes/no; if yes, specify type and wallet addresses)
- Product/service involved (money transmission, payment processing, etc.)

**Part IV — Suspicious Activity Description (Narrative)**
This is the most important part of the SAR. Write a clear, factual narrative:

- What happened? (Describe the suspicious activity in chronological order)
- Why is it suspicious? (Explain what made ForgePay suspect this activity)
- Who was involved? (Names, roles, account numbers)
- How much? (Transaction amounts, dates, accounts)
- What actions did ForgePay take? (Block transaction, close account, etc.)

**Tips for a strong SAR narrative:**
- Use the "5 Ws" (who, what, when, where, why)
- Be specific — include transaction dates, amounts, and account identifiers
- Avoid jargon; write plainly
- Do not draw legal conclusions (e.g., do not write "Customer committed fraud")
- Include account numbers and transaction IDs that law enforcement can trace
- Reference blockchain transaction hashes for crypto activity

#### Step 4: Submit and Retain

1. Review the completed SAR for accuracy
2. Submit via BSA E-Filing
3. Download and save the BSA E-Filing confirmation (Document Control Number / DCN)
4. Store the SAR in a secure, access-restricted location (separate from customer files)
5. Log the filing in the compliance case management system

---

### Safe Harbor Provision

31 U.S.C. § 5318(g)(3) provides that any MSB that files a SAR, and any officer, director, employee, or agent of an MSB involved in the SAR filing, **shall not be liable to any person under any law or regulation of the United States or any State** for the disclosure or the filing.

This safe harbor means ForgePay cannot be sued for filing a SAR in good faith — even if the subject of the SAR is ultimately found to have done nothing wrong.

---

### Tipping-Off Prohibition (31 U.S.C. § 5318(g)(2))

**CRITICAL: Never tell anyone that a SAR has been or may be filed.**

ForgePay employees may NOT:
- Tell the customer that their account is under SAR review
- Tell the customer that a SAR has been filed
- Share the SAR or its contents with any person not authorized to receive it
- Acknowledge whether a SAR exists when asked by a customer or their attorney

Violation of the tipping-off prohibition is a federal crime.

**Training point:** If a customer asks "Why was my account closed?" or "Why was my transaction blocked?" — provide a neutral, non-suspicious response ("We are unable to process this transaction" or "Your account has been closed per our terms of service"). Never reference AML review, SAR, or FinCEN.

---

### SAR Confidentiality

SARs are confidential government documents. Access within ForgePay is restricted to:
- The CCO and Deputy CCO
- Compliance analysts directly working the case
- Legal counsel (under privilege)
- Law enforcement with proper legal process

SAR data must never be included in:
- Customer account files accessible to customer service
- Marketing databases
- Any system that could expose the data to unauthorized personnel

---

## Part II: Currency Transaction Reports (CTRs)

### What Is a CTR?

A Currency Transaction Report (CTR) is a report filed with FinCEN for each transaction in **currency** (cash) exceeding $10,000 in a single business day. Unlike SARs (which are filed when something is suspicious), CTRs are filed for ALL qualifying cash transactions — even completely legitimate ones.

**FinCEN CTR Form:** FinCEN CTR (Form 112)

**Important Note for ForgePay:** ForgePay is primarily a digital payment processor and does not accept cash (currency). However, if any ForgePay service involves physical currency transactions (e.g., a future product or partnership with cash-acceptance locations), CTR obligations apply. Additionally, some regulators may consider certain cryptocurrency transactions as equivalent to currency for CTR purposes — consult legal counsel.

---

### CTR Threshold and Triggers (31 CFR 1010.311)

| Trigger | Threshold | Notes |
|---------|-----------|-------|
| Single cash transaction | > $10,000 | File one CTR |
| Multiple cash transactions in one business day, same customer | Total > $10,000 | File one CTR covering all transactions (aggregation rule) |
| Multiple cash transactions, same conductor (different customers) | Total > $10,000 | Aggregate if staff has knowledge of relationship |

**Definition of Currency:** Physical paper money and coin — NOT checks, ACH, wire transfers, or cryptocurrency. However, monitor FinCEN guidance on whether stablecoin or cryptocurrency will be reclassified.

---

### Aggregation Rule

ForgePay must aggregate multiple cash transactions by the **same customer** or same **conductor** on the same business day:

- Customer deposits $6,000 cash at 10 AM and $5,500 cash at 2 PM at the same location → Total = $11,500 → File CTR
- If ForgePay knows these are the same person, aggregate even if names differ slightly

**Structuring (intentional splitting):** If a customer splits transactions to avoid the $10,000 threshold (e.g., two $4,999 transactions), this is illegal structuring under 31 U.S.C. § 5324 — file a SAR, not a CTR.

---

### CTR Filing Timeline

**Deadline:** CTRs must be filed with FinCEN within **15 calendar days** after the transaction date. (31 CFR 1010.306(a))

---

### CTR Filing Procedure

#### Step 1: Identify the Reportable Transaction

Compliance team or operations staff identifies a cash transaction exceeding $10,000 (or aggregated transactions exceeding $10,000).

#### Step 2: Collect Required Information

Before filing, collect:
- Full name of customer conducting the transaction
- Date of birth
- Address
- SSN or ITIN (required for CTR)
- Government-issued ID (type, number, issuing state/country)
- Date of transaction
- Amount
- Account number(s) involved
- Transaction type
- If on behalf of another person (third party): same information for the actual beneficiary

#### Step 3: Complete FinCEN CTR Form 112

Log into BSA E-Filing and complete Form 112:

**Part I — Person(s) Involved in Transaction**
- For each person conducting or benefiting from the transaction: name, DOB, address, SSN, ID
- Select appropriate "role" (conductor, beneficiary, both)

**Part II — Amount and Type of Transaction**
- Total cash in
- Total cash out
- Type of transaction (cash in/out, exchange, etc.)
- Account numbers

**Part III — Filing Institution Information**
- ForgePay's legal name, address, contact, EIN, FinCEN MSB ID

#### Step 4: Submit and Retain

1. Submit via BSA E-Filing
2. Save confirmation (DCN)
3. Retain copy of CTR for 5 years
4. Log in compliance records

---

### CTR Exemptions

The following transactions are exempt from CTR filing requirements and do not need to be reported:

**31 CFR 1020.315 provides exemptions for banks filing CTRs. For MSBs, exemptions are more limited:**

For MSBs, only the following are specifically exempt:
- Transactions with other MSBs (when the MSB is itself a registered MSB and the transaction is in the ordinary course of business)
- Certain transactions with government agencies

**Note:** There is no broad customer exemption for MSBs like there is for banks. Do not assume transactions with regular business customers are exempt without specific legal analysis.

---

### FinCEN 314(a) Requests

Separate from CTRs and SARs, FinCEN's 314(a) program allows law enforcement to request that ForgePay search its records for accounts or transactions matching a specific individual or entity.

**When ForgePay receives a 314(a) request:**
1. Search all customer records and transaction records within **14 business days**
2. If a match is found: respond through the secure 314(a) portal with account/transaction information
3. If no match: no response needed
4. Do NOT tell the subject of the search that ForgePay received a 314(a) request

**Access to 314(a) requests:** Only available through the FinCEN secure 314(a) portal. Register the CCO as ForgePay's 314(a) point of contact at https://314aregistration.fincen.gov.

---

## Summary Table: SAR vs. CTR

| Feature | SAR | CTR |
|---------|-----|-----|
| Purpose | Report suspicious activity | Report large cash transactions |
| Threshold | $2,000+ (suspicious, MSB) | $10,000+ in currency (all) |
| Trigger | Suspicion | Transaction amount |
| Filing deadline | 30 days (60 if no subject) | 15 days |
| Filed even if not suspicious | No | Yes |
| Confidential from customer | Yes — tipping-off prohibited | Yes — do not disclose |
| FinCEN form | SAR Form 111 | CTR Form 112 |
| Retention | 5 years | 5 years |
| Safe harbor | Yes (31 U.S.C. § 5318(g)(3)) | N/A |

---

## Training Requirements

All compliance team members must be trained annually on:
- SAR and CTR filing procedures
- The tipping-off prohibition
- How to complete Forms 111 and 112 in BSA E-Filing
- Current FinCEN guidance on virtual currency SAR/CTR treatment
- Common errors in SAR narratives and how to avoid them

Training completion is documented and retained for 5 years.

---

*These procedures should be reviewed annually and updated when FinCEN issues new guidance. All SAR/CTR filings are confidential and must be handled in accordance with ForgePay's data security policies.*
