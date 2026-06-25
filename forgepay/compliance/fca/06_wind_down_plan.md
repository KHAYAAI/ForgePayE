# ForgePay — Wind-Down Plan

**Document type:** FCA PI Application — Section I (Wind-Down Arrangements)  
**Applicant:** ForgePay Ltd  
**PSR 2017 reference:** Regulation 22(5)(e); FCA Approach Document Chapter 13  
**Prepared:** 25 June 2026  
**Version:** 1.0  
**Policy owner:** CEO / Board of Directors  
**Review frequency:** Annual; tested every 2 years  

---

## 1. Purpose

This Wind-Down Plan ("WDP") describes how ForgePay Ltd ("ForgePay") would cease payment services in an orderly manner, protect customers' funds, and minimise harm to merchants and their end-customers in the event of a wind-down.

The FCA requires all authorised payment institutions to maintain a credible wind-down plan that demonstrates the firm can exit the market without causing material harm to customers or financial instability. The plan must be reviewed annually and tested periodically.

---

## 2. Trigger Events

A wind-down may be initiated by one of the following trigger events:

### 2.1 Voluntary Wind-Down Triggers (Board decision required)

| Trigger | Description |
|---|---|
| Commercial failure | ForgePay determines it cannot achieve a sustainable business model |
| Strategic exit | Acquisition, merger, or shareholder decision to cease operations |
| Capital shortfall | Own funds fall below regulatory minimum and cannot be remediated |
| Loss of key contracts | Termination of critical acquirer or banking relationships that cannot be replaced within 90 days |
| Regulatory action | FCA indicates intent to cancel or vary authorisation; board elects not to contest |

### 2.2 Involuntary Wind-Down Triggers (External)

| Trigger | Description |
|---|---|
| FCA cancels authorisation | FCA exercises power under PSR 2017 reg 12 to cancel ForgePay's authorisation |
| FCA Variation of Permission (VoP) | FCA restricts permissions to the point of effective cessation |
| Insolvency | Company enters administration, liquidation, or creditors' voluntary liquidation |
| Regulatory direction | FCA or court directs cessation of payment services |
| Loss of banking / acquiring | All acquirer and banking partners withdraw simultaneously without adequate notice |

### 2.3 Early Warning Indicators (EWIs)

ForgePay monitors the following EWIs monthly. Breach of an EWI triggers Wind-Down Plan review:

| EWI | Threshold | Current Monitor | Frequency |
|---|---|---|---|
| Own funds vs regulatory minimum | < 110% of minimum | CFO | Monthly |
| Cash runway | < 4 months at current burn | CFO | Monthly |
| Acquirer concentration | Single acquirer > 80% of volume | COO | Monthly |
| Revenue vs forecast | > 40% below base-case forecast | CEO | Monthly |
| Key person loss | Loss of MLRO or Compliance Officer | CEO | Immediate |
| FCA enforcement risk | Receipt of Section 165 information request or Warning Notice | Compliance | Immediate |

---

## 3. Governance During Wind-Down

### 3.1 Decision to Wind Down

A decision to initiate voluntary wind-down requires:
- Resolution of the Board of Directors (simple majority)
- Immediate notification to the MLRO and Compliance Officer
- Appointment of a Wind-Down Manager (senior executive, typically CEO or CFO)
- Notification to FCA within 1 business day of Board decision (see Section 8)

### 3.2 Wind-Down Manager

The **Wind-Down Manager** is responsible for:
- Coordinating all wind-down activities across teams
- Maintaining the wind-down timeline and task log
- Communicating with the FCA and other regulators
- Authorising payments from ForgePay's operational account during wind-down
- Ensuring safeguarded funds are returned to merchants/payers before any other distributions

The Wind-Down Manager has authority to act without ordinary Board approval for operational wind-down activities, subject to weekly Board updates.

### 3.3 Skeleton Staff Retention

ForgePay will retain a minimum skeleton team during wind-down:
- Wind-Down Manager (1 person)
- Finance / Treasury (1 person, for safeguarding reconciliation and fund returns)
- MLRO (1 person, for ongoing AML obligations and SAR filing)
- Technical (1 person, for system access and data preservation)

These roles will be retained for the duration of wind-down (estimated 30–90 days). Retention bonuses may be offered to incentivise key personnel to stay through completion.

---

## 4. Customer Notification

### 4.1 Notice Period

ForgePay will provide a minimum of **20 business days' written notice** to all active merchant customers before ceasing payment services. This exceeds the statutory minimum and aligns with FCA guidance on orderly exit.

Notification will include:
- The planned cessation date for new payment processing
- The planned cessation date for merchant payouts / settlement
- Instructions for merchants to redirect payment traffic to an alternative provider
- Contact details for Wind-Down Manager and support team during wind-down

### 4.2 Notification Channels

| Channel | Target Audience | Timing |
|---|---|---|
| Email to merchant primary contact | All active merchants | Day 1 of wind-down period |
| Dashboard notification (persistent banner) | All logged-in merchant users | Day 1 |
| Webhook event (wind-down notice type) | Merchant integration teams | Day 1 |
| API deprecation notice | Developer documentation | Day 1 |
| Written letter (for enterprise/high-value merchants) | Top 20 merchants by volume | Day 1 |

### 4.3 Merchant Support During Wind-Down

ForgePay will operate a **dedicated wind-down support email and phone line** during the notice period to assist merchants with:
- Migration to alternative payment providers
- Accessing historical transaction data and reports
- Understanding settlement timing for outstanding funds
- Resolving any outstanding disputes or chargebacks

---

## 5. Cessation of New Payments

On the cessation date for new payment processing:
- ForgePay's payment API will return error code `503 Service Unavailable` with a `Retry-After` header directing merchants to their alternative provider
- ForgePay's merchant dashboard will display a "Service Closed" message with data export links
- New merchant onboarding is suspended immediately upon Board wind-down resolution (before customer notification)
- Scheduled/recurring payments initiated before cessation date will be honoured if technically feasible

---

## 6. Fund Return Procedure

### 6.1 Principle

All relevant funds held in ForgePay's safeguarding account must be returned to the rightful beneficiaries (merchants or their end-customers) before any distribution to ForgePay's own creditors.

### 6.2 Settlement of Outstanding Merchant Payouts

ForgePay will accelerate merchant settlement during wind-down:
- Outstanding settlement balances will be paid to merchants within **5 business days** of cessation date (rather than standard T+2 cycle)
- Merchants will receive a final settlement statement showing all transactions processed, fees deducted, and net amount remitted
- No new fees will be charged after the cessation date for new payments

### 6.3 Handling Disputed / Held Funds

Funds held in dispute or chargeback processes at the point of cessation:
1. ForgePay will attempt to resolve all disputes before cessation date
2. Where disputes cannot be resolved, funds are held in the safeguarding account
3. An independent fund administrator (if appointed) or insolvency practitioner will manage distribution
4. Merchants retain their right to dispute resolution outcomes

### 6.4 Chargeback Liability

ForgePay retains liability for chargebacks on transactions processed before cessation. ForgePay will:
- Maintain a chargeback reserve (from operational funds, not safeguarding account) for 180 days post-cessation
- Process any chargebacks arising from the acquiring bank during this period
- Notify merchants of any chargeback deductions to their final settlement

### 6.5 Unclaimed Funds

If merchant settlement funds cannot be remitted (e.g., merchant bank account closed, merchant dissolved):
- ForgePay will make 3 documented attempts to contact the merchant
- If unsuccessful after 30 days: funds held in trust in the safeguarding account
- If unsuccessful after 6 years: funds treated as unclaimed under applicable law (legal advice to be obtained)

### 6.6 Stablecoin and Crypto Funds

Outstanding stablecoin (USDC/USDT) or cryptocurrency merchant balances at cessation:
- Converted to GBP/USD via exchange partner and paid out via bank transfer, OR
- Remitted to merchant's designated on-chain wallet if requested
- Conversion rates are fixed at the rate prevailing on the conversion date

---

## 7. Data Portability and Access

### 7.1 Merchant Data Export

ForgePay will provide merchants with a full data export within **10 business days** of cessation including:
- Transaction history (all processed payments, refunds, disputes — full history)
- Settlement records (payouts, fees, reconciliation)
- Customer/payer data held by ForgePay (where legally permissible under UK GDPR)
- API configuration and webhook logs
- PCI tokenisation references (so merchants can migrate tokens to a compatible vault)

Data will be provided in machine-readable format (CSV and JSON) via secure download link (valid 30 days).

### 7.2 PCI Token Migration

ForgePay will work with successor payment providers to facilitate migration of PCI-tokenised card data where technically feasible and card scheme rules permit. This may require coordination with Hyperswitch's vault network partners.

### 7.3 Data Retention Post-Wind-Down

ForgePay will retain the following data post-wind-down (held in encrypted cold storage or with a data retention agent):
- AML/KYB records: 5 years post-cessation (MLR 2017 reg 40)
- Transaction records: 5 years post-cessation
- GDPR data subject rights requests: Honoured for 2 years post-cessation (DPA 2018)
- Safeguarding reconciliation records: 5 years

A nominated **data controller post-wind-down** will be appointed (may be a director or retained agent) to handle data subject requests.

---

## 8. Regulatory Notification Timeline

| Event | Notification Target | Timing | Method |
|---|---|---|---|
| Board decision to wind down | FCA | Within 1 business day | FCA Connect message |
| Customer notification sent | FCA | Same day as merchant emails | FCA Connect |
| Cessation of new payment processing | FCA | Same day | FCA Connect |
| Completion of merchant fund return | FCA | Within 5 business days | FCA Connect |
| Completion of data export to merchants | FCA | Within 10 business days | FCA Connect |
| Application to cancel FCA authorisation | FCA | Before wind-down completion | FCA Connect (Variation of Permission / Cancellation form) |
| Final wind-down report | FCA | Within 30 days of completion | FCA Connect |

### 8.1 FCA Notification Requirements

PSR 2017 reg 44 requires ForgePay to notify the FCA if it:
- Ceases to provide payment services (voluntary)
- Becomes insolvent or subject to formal insolvency proceedings

Failure to notify the FCA is a criminal offence under PSR 2017 reg 105.

### 8.2 Companies House and Other Regulators

- **Companies House:** Filing for voluntary strike-off or liquidation (as appropriate)
- **HMRC:** Final corporation tax return, PAYE closure, VAT deregistration
- **ICO (Information Commissioner's Office):** Data protection registration cancellation
- **Payment card schemes:** Notification of intent to cease participation (90-day notice typical)

---

## 9. Wind-Down Costs

ForgePay estimates the following costs for an orderly wind-down:

| Cost Item | Estimated Amount | Notes |
|---|---|---|
| Skeleton staff retention (3 months) | [£X] | 4 FTEs at blended cost |
| Legal costs (wind-down advice, fund distribution) | [£X] | External counsel |
| Data retention agent / cold storage | [£X] | 5-year contract |
| IT decommissioning (EKS, RDS, KMS) | [£X] | AWS termination, data export |
| Insolvency practitioner (if required) | [£X] | Hourly — contingency |
| Chargeback reserve (held 180 days) | [£X] | Based on 3 months' volume at [X]% chargeback rate |
| Merchant support helpline | [£X] | 3-month operational cost |
| **Total estimated wind-down cost** | **[£X]** | |

ForgePay maintains capital in excess of the wind-down cost estimate at all times as part of its capital buffer. The CFO reviews the wind-down cost estimate annually.

---

## 10. Testing and Review

### 10.1 Annual Review

The Wind-Down Plan is reviewed annually by the Board and updated for:
- Changes to the merchant base (number, volume, concentration)
- Changes to the acquirer and banking relationships
- Changes to regulatory requirements
- Lessons from any wind-down events at peer firms

### 10.2 Biennial Test

Every 2 years, ForgePay will conduct a **wind-down tabletop exercise**:
- Senior management simulate a wind-down scenario
- Test: Can ForgePay notify all merchants within 1 business day?
- Test: Can ForgePay calculate outstanding safeguarded funds within 4 hours?
- Test: Can ForgePay initiate fund return within 2 business days?
- Test: Is the data export mechanism functional?
- Findings documented and plan updated

Results of each exercise are reported to the Board and retained for FCA review.

---

*Document version: 1.0 — 25 June 2026*  
*Owner: CEO / Board of Directors*  
*Review: Annual*
