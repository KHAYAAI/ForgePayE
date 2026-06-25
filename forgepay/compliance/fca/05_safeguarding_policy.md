# ForgePay — Safeguarding Policy

**Document type:** FCA PI Application — Section H (Safeguarding Arrangements)  
**Applicant:** ForgePay Ltd  
**PSR 2017 reference:** Regulations 23–26; FCA Approach Document Chapter 10  
**Prepared:** 25 June 2026  
**Version:** 1.0  
**Policy owner:** CFO / Finance Director  
**Review frequency:** Annual, or upon material change  

---

## 1. Purpose and Regulatory Basis

This Safeguarding Policy sets out how ForgePay Ltd ("ForgePay") protects funds received from or for the benefit of payment service users ("relevant funds") in accordance with the **Payment Services Regulations 2017 (PSR 2017), regulations 23–26**.

PSR 2017 reg 23 requires that a payment institution safeguard any relevant funds it holds. "Relevant funds" means:
- Funds received from or for the benefit of a payment service user which have been received for the execution of a payment transaction; and
- Funds received from another payment service provider for the benefit of a payment service user.

ForgePay is required to safeguard relevant funds at all times from receipt until execution of the payment (or, if execution is not completed, until the funds are returned to the payer).

The FCA has published detailed expectations in its **Payment Services and Electronic Money — Our Approach** document (Chapter 10), which ForgePay has reviewed and to which this policy conforms.

---

## 2. Safeguarding Method Selected

ForgePay has selected **Method A — Segregation** as its safeguarding method under PSR 2017 reg 23(2).

Under Method A, relevant funds are **segregated** in one or more dedicated accounts held at an FCA-authorised / PRA-regulated UK credit institution, separate from ForgePay's own funds. These accounts are designated as safeguarding accounts and cannot be used for ForgePay's operational purposes.

**Reason for selecting Method A over Method B (insurance/guarantee):**
- Method A is operationally simpler and does not require ongoing insurance premium expenditure
- ForgePay's nominated safeguarding bank has confirmed availability of a segregated account
- Method A is preferred by the FCA and reduces regulatory risk at authorisation stage

ForgePay has not elected to use Method B (insurance or guarantee) and will notify the FCA before making any change to the safeguarding method.

---

## 3. Nominated Safeguarding Bank

ForgePay has designated the following credit institution as its safeguarding bank:

| Field | Detail |
|---|---|
| Bank name | [Nominated UK bank — to be confirmed, e.g. Barclays Bank plc / ClearBank Ltd] |
| FCA/PRA authorisation | FCA Firm Reference Number: [XXXXX] |
| Account name | ForgePay Ltd — Client Safeguarding Account |
| Account number | [To be provided upon account opening] |
| Sort code | [To be provided] |
| Account type | Current account — ring-fenced, designated safeguarding |
| Currency | GBP (primary); USD sub-account if required |

ForgePay will provide the FCA with:
1. A letter from the nominated bank confirming the account is held in trust / designated for safeguarding purposes
2. Evidence that the account is separate from ForgePay's operational (own funds) accounts
3. Confirmation that no lien, set-off, or charge exists over the safeguarding account in favour of the bank

Before any change of nominated safeguarding bank, ForgePay will notify the FCA and ensure seamless transfer of safeguarded funds.

---

## 4. What Funds Are Safeguarded

ForgePay must safeguard funds at the point of receipt, before the payment transaction is completed.

### 4.1 In-Scope Relevant Funds

The following funds are subject to safeguarding:

| Fund Type | When Safeguarded | When Released |
|---|---|---|
| Card payment receipts (from acquirer settlement) | Upon receipt from acquirer | Upon merchant payout |
| USDC/USDT received (fiat equivalent) | Upon conversion to fiat / upon receipt | Upon merchant payout |
| Bank transfer receipts (SEPA/FPS) | Upon receipt into ForgePay's collection account | Upon merchant payout |
| Funds held pending dispute resolution | From receipt until chargeback/dispute resolved | Upon resolution |
| Funds in transit (T+1 / T+2 settlement cycle) | During settlement processing | Upon merchant payout |

### 4.2 Out-of-Scope Funds

The following are **not** relevant funds for safeguarding purposes:
- ForgePay's own revenue (fees, SaaS subscriptions) — held in operational accounts
- ForgePay's regulatory capital — held in a separate capital account
- Native cryptocurrency holdings (BTC/ETH/LTC/XMR) prior to fiat conversion — managed under crypto-specific controls (not subject to PSR 2017 safeguarding in digital form)

> **Note on stablecoins:** The regulatory treatment of USDC/USDT as "relevant funds" under PSR 2017 is subject to ongoing FCA guidance development. ForgePay's position is that, upon conversion of stablecoins to fiat (GBP/USD), those fiat proceeds are relevant funds subject to safeguarding. This position will be confirmed with the FCA at the pre-application meeting.

---

## 5. Safeguarding Account Structure

### 5.1 Account Designation

The safeguarding account(s) will be:
- Held in the name of **ForgePay Ltd** with a clear designation (e.g., account name includes "Client" or "Safeguarding")
- Identified in ForgePay's books as a trust / designated account
- Excluded from ForgePay's operating cash management — no sweeping to operational accounts
- Free from any bank charge, lien, set-off, or encumbrance in favour of the bank

### 5.2 Account Separation

ForgePay operates the following separate accounts:

| Account | Purpose | Commingling with Safeguarding? |
|---|---|---|
| Safeguarding account | Relevant funds (PSR 2017 reg 23) | No — strictly ring-fenced |
| Operational account | ForgePay's own revenue, salaries, expenses | No |
| Capital account | Regulatory capital (€125,000+) | No |
| Merchant collection account | Short-term receipt of payments before daily sweep to safeguarding | Minimised — swept same day |

All receipts from acquiring banks and payment networks are received into the **merchant collection account**. A **same-day sweep** (executed by 18:00 UK time on each business day) transfers the full balance of relevant funds to the safeguarding account.

---

## 6. Daily Reconciliation Process

ForgePay conducts a **daily reconciliation** of safeguarded funds in accordance with FCA expectations. The reconciliation is performed by the Finance team and reviewed by the CFO.

### 6.1 Reconciliation Steps

**Step 1 — Calculate required safeguarding amount:**
At end of each business day, calculate the total relevant funds outstanding:
- Sum of all received payments not yet settled to merchants
- Plus: disputed/held funds
- Plus: any funds received after 18:00 carry-over

**Step 2 — Check safeguarding account balance:**
Obtain bank statement / real-time balance from nominated safeguarding bank.

**Step 3 — Compare and reconcile:**
- If safeguarding account balance ≥ required amount: Reconciliation passes
- If safeguarding account balance < required amount (shortfall): Immediate escalation (see Section 6.2)
- If safeguarding account balance > required amount (excess): Investigate — may indicate double-counting of own funds; transfer excess to operational account

**Step 4 — Document:**
Record reconciliation result in the Safeguarding Reconciliation Log (electronic, access-controlled).

**Step 5 — Sign-off:**
Finance team member signs off daily log. CFO reviews weekly summary and signs monthly.

### 6.2 Shortfall Response Procedure

If a reconciliation shortfall is identified:

1. **Immediate notification** to CFO and MLRO (within 1 hour of detection)
2. **Root cause analysis** commenced immediately
3. **Top-up transfer** initiated from ForgePay operational funds to safeguarding account (same business day if before 16:00; next morning if after)
4. If shortfall cannot be explained within 24 hours: **Notify FCA** (FCA operational resilience notification requirements)
5. If shortfall suggests fraud or system error: Invoke incident response procedures and consider SAR to NCA

---

## 7. Interest on Safeguarded Funds

Interest earned on the safeguarding account accrues in accordance with ForgePay's agreement with the nominated bank.

**ForgePay's policy:** Interest earned on safeguarded funds belongs to ForgePay (not to the merchants/payers whose funds are safeguarded), unless merchant contracts specify otherwise. Interest income is credited to ForgePay's operational account and recognised as revenue.

The safeguarding account balance (relevant funds) and any interest credited are tracked separately in ForgePay's books to ensure interest does not inflate the apparent safeguarding balance.

---

## 8. What Happens in Insolvency

In the event of ForgePay's insolvency, PSR 2017 reg 26 provides that relevant funds held in the safeguarding account are protected for the benefit of payment service users. ForgePay has implemented the following arrangements to facilitate this:

### 8.1 Trust Structure

ForgePay holds funds in the safeguarding account as **trustee** for the relevant payment service users (merchants and their customers). The trust relationship is established by:
- ForgePay's designation of the account as a safeguarding account
- ForgePay's internal accounting treatment (funds not recognised as ForgePay's own assets)
- Merchant Terms of Service acknowledging the safeguarding arrangement

### 8.2 Insolvency Practitioner Cooperation

In insolvency, ForgePay will (or its directors will, pending appointment of an IP):
1. Notify the FCA immediately (PSR 2017 reg 44)
2. Suspend new payment processing to prevent further funds entering the estate
3. Provide the insolvency practitioner (IP) with the reconciliation records and safeguarding account details
4. Cooperate fully with the IP's distribution of safeguarded funds to payment service users

### 8.3 Priority of Claims

Under PSR 2017 reg 26, payment service users have a priority claim over safeguarded funds ahead of ForgePay's general creditors. ForgePay's nominated safeguarding bank must not exercise any right of set-off against the safeguarding account in respect of ForgePay's own debts.

### 8.4 Shortfall in Insolvency

If, in insolvency, the safeguarding account balance is less than the total relevant funds owed to payment service users (e.g., due to an unidentified shortfall), the payment service users rank as preferential creditors for the shortfall under the PSR 2017.

---

## 9. Crypto and Stablecoin Safeguarding Considerations

### 9.1 Pre-Conversion Holdings

Where ForgePay receives cryptocurrency (BTC, ETH, LTC, XMR) on behalf of merchants and has not yet converted to fiat, those digital assets are held in ForgePay-controlled custodial wallets. ForgePay's policy:
- Custodial wallets are segregated per-transaction (unique address per payment — no address reuse)
- Private keys are managed via hardware security modules (HSM) or a regulated crypto custodian
- Conversion to fiat is initiated within 24 hours of receipt (or sooner per merchant preference)
- Upon conversion, fiat proceeds are swept to the safeguarding account same day

### 9.2 Stablecoin (USDC/USDT) Treatment

USDC and USDT received from payers are converted to GBP/USD via ForgePay's exchange partner within 24 hours. Upon conversion:
- Fiat proceeds are relevant funds subject to PSR 2017 safeguarding
- The converted amount is swept to the safeguarding account same day

---

## 10. Safeguarding Monitoring and Audit

### 10.1 Internal Monitoring

| Activity | Frequency | Owner |
|---|---|---|
| Daily reconciliation | Every business day | Finance team |
| Safeguarding account bank statement reconciliation | Monthly | CFO |
| Review of reconciliation logs | Weekly | CFO |
| Safeguarding account interest reconciliation | Monthly | Finance team |
| Board report on safeguarding | Monthly MI pack | CFO |
| Internal audit of safeguarding controls | Annual | Internal/External Audit |

### 10.2 FCA Reporting

ForgePay will report safeguarding matters to the FCA:
- In the annual FCA RegData return (payment statistics including safeguarding)
- Immediately upon any material safeguarding failure (shortfall, bank account issue)
- Upon change of nominated safeguarding bank
- Upon change of safeguarding method

### 10.3 External Audit

ForgePay's annual statutory accounts (prepared under FRS 102) will include appropriate disclosures regarding safeguarded funds. The external auditor will review the safeguarding reconciliation process as part of the annual audit.

---

## 11. Policy Governance

| Field | Detail |
|---|---|
| Policy owner | CFO / Finance Director |
| Approved by | Board of Directors |
| Review frequency | Annual |
| Last reviewed | [Date of Board approval] |
| Next review | [12 months from approval] |
| FCA notification required if changed? | Yes — material changes require FCA notification |

---

*Document version: 1.0 — 25 June 2026*  
*Submitted as part of FCA PI application, Section H*
