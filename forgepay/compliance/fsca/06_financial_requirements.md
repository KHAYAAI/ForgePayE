# ForgePay — Capital Adequacy and Financial Requirements

**Document Classification:** Confidential — Regulatory Submission
**Version:** 1.0
**Date:** 2026-06-25
**Prepared By:** Chief Financial Officer
**Reviewed By:** Chief Compliance Officer
**Approved By:** Board of Directors

---

## 1. Purpose

This document demonstrates ForgePay (Pty) Ltd's compliance with the financial requirements applicable to Payment Service Providers (PSPs) under South African law, including minimum capital adequacy, client fund safeguarding, insurance requirements, and working capital sufficiency.

The financial requirements for PSPs in South Africa derive from:
- Financial Sector Regulation Act 9 of 2017 (FSRA)
- National Payment System Act 78 of 1998 (NPS Act)
- FSCA Conduct Standard (to be confirmed with FSCA at time of application)
- Prudential Authority guidance on payment institution minimum capital
- Industry practice for PSPs of comparable scale

---

## 2. Minimum Capital Requirement

### 2.1 Regulatory Minimum

The FSCA requires Payment Service Providers to maintain a minimum capital position. Based on consultation with the FSCA licensing unit and guidance applicable at the time of this application:

| Requirement | Amount (ZAR) | ForgePay Position |
|---|---|---|
| Minimum capital (unencumbered, liquid) | R 1,000,000 | R [ACTUAL AMOUNT] |
| Net capital requirement (assets less liabilities) | ≥ R 1,000,000 | R [ACTUAL AMOUNT] |

**Important:** The minimum capital figure must be confirmed with the FSCA at the time of application, as it may vary based on the specific license category, transaction volume tier, and whether ForgePay operates as a Merchant of Record. The R 1,000,000 figure is the working assumption based on the SOUTH_AFRICA_LICENSES.md internal assessment; legal counsel should verify this against the current FSCA Conduct Standard.

### 2.2 Capital Confirmation

The required capital is confirmed by:
- **Bank statement:** [Attach certified bank statement not older than 3 months showing minimum R 1,000,000 in ForgePay's South African business bank account]
- **Auditor / accountant confirmation letter:** [Attach letter from registered accountant or IRBA auditor confirming capital adequacy]

### 2.3 Capital Maintenance

ForgePay commits to:
- Maintaining the regulatory minimum capital at all times
- Notifying the FSCA immediately if capital falls below the minimum (as required by license conditions)
- Reporting capital position in quarterly and annual regulatory submissions
- Conducting a quarterly internal capital review (CFO to board)

---

## 3. Working Capital Projections

### 3.1 12-Month Cash Flow Summary

_Note: The projections below are illustrative placeholders. The actual detailed month-by-month cash flow model is provided in Appendix C1 (spreadsheet) signed by the CFO._

| Month | Opening Cash (ZAR) | Revenue In | Expenditure Out | Closing Cash |
|---|---|---|---|---|
| Month 1 | [Starting capital] | [Revenue] | [Opex] | [Closing] |
| Month 2 | — | — | — | — |
| Month 3 | — | — | — | — |
| Month 6 | — | — | — | — |
| Month 12 | — | — | — | — |

**Funding runway:** Based on committed funding (investor equity / credit facilities), ForgePay has a working capital runway of [N] months at projected burn rate, before reaching cash-flow break-even.

### 3.2 Stress Testing

ForgePay has modelled the following stress scenarios:

| Scenario | Assumption | Impact on Capital | Mitigation |
|---|---|---|---|
| Revenue 50% below forecast (Year 1) | Slower merchant onboarding | Capital drawdown of R [X]; minimum maintained | Cost reduction; slower hiring |
| Major chargeback event (0.5% of GMV) | Fraud spike on a single large merchant | Maximum loss R [X] | Chargeback reserve fund; fraud scoring |
| Regulatory enforcement action (fine) | FSCA or FIC fine (estimated R 100,000) | Absorbed within working capital | Insurance; legal defence fund |
| Key acquirer failure | Single acquirer ceases service | Revenue disruption 30 days | Multi-acquirer routing; 60-day notice provision |

### 3.3 Additional Capital Sources

| Source | Availability | Amount |
|---|---|---|
| Committed venture capital / equity | [Confirm if applicable] | R [Amount] |
| Director loans | [Confirm if applicable] | R [Amount] |
| Bank credit facility | [Confirm if applicable] | R [Amount] |
| **Total additional capital available** | | **R [Total]** |

---

## 4. Safeguarding of Client Funds (Merchant Float)

### 4.1 The Safeguarding Requirement

As a Payment Service Provider that receives funds on behalf of merchants (in ForgePay's MoR model), ForgePay holds merchant funds between the time of payment collection and settlement to the merchant. These funds ("merchant float") must be safeguarded separately from ForgePay's own operating funds.

Safeguarding ensures that in the event of ForgePay's insolvency, merchant funds are protected and not available to ForgePay's general creditors.

### 4.2 Safeguarding Mechanism

ForgePay implements safeguarding via a **dedicated client funds trust account** held with a South African bank (Tier 1 or Tier 2 bank, SARB regulated):

| Feature | Detail |
|---|---|
| Account type | Trust account in the name of "ForgePay (Pty) Ltd — Client Funds Trust" |
| Bank | [Bank name — e.g., Standard Bank, FNB, ABSA, Nedbank] |
| Account number | [Account number — to be inserted at submission] |
| Signatory controls | Dual-signatory for withdrawals (CEO + CFO minimum) |
| Purpose restriction | Used exclusively for merchant funds; no ForgePay operating expenses drawn from this account |
| Daily reconciliation | Automated reconciliation of ForgePay platform ledger vs. bank account balance; exception alerts to CFO |
| Legal documentation | Trust account agreement between ForgePay and bank confirming safeguarding purpose |

### 4.3 Segregation Controls

**Accounting segregation:**
- ForgePay maintains separate general ledger accounts for: (a) own operating funds, (b) merchant float (client funds)
- The ForgePay platform ledger (`mor-layer` / billing-engine) tracks each merchant's settled and unsettled balance in real time
- Daily automated reconciliation between platform ledger balances and bank account balance
- Any discrepancy of >R 1,000 triggers an automatic alert to CFO and CCO within 30 minutes

**System segregation:**
- Merchant payout transactions are processed from the client funds trust account only
- Operating expenses are processed from ForgePay's separate operating account only
- API-level controls in the `mor-layer` service prevent cross-account fund movement without dual authorisation

### 4.4 Safeguarding Coverage

ForgePay commits to maintaining safeguarding coverage at 100% of the aggregate merchant float balance at all times. The daily reconciliation process verifies this coverage.

**Exception procedure:** If, due to timing differences (e.g., bank processing lag), safeguarding coverage falls below 100%, the CFO must be notified immediately and the shortfall must be remedied within 24 hours by transferring own funds into the trust account as a bridge.

### 4.5 Transparency to Merchants

Merchants are informed in ForgePay's merchant agreement that:
- Their funds are held in a segregated trust account
- Settlement occurs on T+1 or T+3 as per their service tier
- In the event of ForgePay insolvency, their funds are protected as trust assets
- Merchants may request a confirmation of their current balance at any time via the dashboard

---

## 5. Professional Indemnity Insurance

### 5.1 Requirement

Professional Indemnity (PI) insurance covers ForgePay against claims arising from errors, omissions, or negligent acts in the provision of payment services.

| Requirement | FSCA Minimum | ForgePay Target Coverage |
|---|---|---|
| Professional Indemnity | R 5,000,000 per claim | R 10,000,000 per claim |
| Annual aggregate | R 10,000,000 | R 20,000,000 |
| Retroactive date | Inception of ForgePay | Inception |
| Insurer | South African registered insurer (FSB/FSCA approved) | [Insurer name] |

**Certificate:** Attach PI insurance certificate confirming above details, with ForgePay as named insured and FSCA as an interested party where required.

### 5.2 Fidelity / Crime Insurance

Fidelity insurance covers ForgePay against losses arising from employee dishonesty, theft, or fraud.

| Coverage Type | Amount |
|---|---|
| Employee dishonesty | R 5,000,000 per event |
| Computer fraud / electronic funds transfer fraud | R 5,000,000 per event |
| Third-party on-premises loss | R 2,000,000 per event |

**Certificate:** Attach crime insurance certificate.

### 5.3 Cyber Insurance (Recommended)

While not mandatory, ForgePay targets cyber insurance coverage given the nature of the business:

| Coverage Type | Target Amount |
|---|---|
| Data breach response costs (forensics, notification, credit monitoring) | R 10,000,000 |
| Business interruption (cyber event) | R 5,000,000 |
| Regulatory defence and fines | R 5,000,000 |
| Third-party liability (data breach affecting customers) | R 10,000,000 |

---

## 6. Surety / Bond Requirements

### 6.1 FSCA Surety

The FSCA may require a financial bond or guarantee as an additional safeguard. Based on preliminary guidance:

| Requirement | Estimated Amount | Mechanism |
|---|---|---|
| FSCA performance bond | R 500,000–R 2,000,000 (to be confirmed) | Bank guarantee or insurance-backed bond |
| Provider | South African commercial bank or insurer | [Provider to be confirmed] |

ForgePay will arrange the required bond through its principal banker upon confirmation of the FSCA's specific requirement. The bond will be in favour of the FSCA and will remain in place for the duration of the PSP license.

### 6.2 Acquirer / Card Scheme Security Deposit

Card acquirers and card schemes (Visa, Mastercard) may require a security deposit (rolling reserve or cash collateral) as protection against chargebacks:

| Party | Typical Requirement | ForgePay Arrangement |
|---|---|---|
| Card acquirer | 5%–10% of monthly card processing volume held as rolling reserve | [To be negotiated; typically withheld from settlement proceeds] |
| Visa / Mastercard | Variable; negotiated at scheme membership level | [To be negotiated with acquirer sponsor] |

Rolling reserves are held by the acquirer from ForgePay's settlement proceeds and released on a rolling basis (typically 180 days). This is a normal industry requirement and not a regulatory capital requirement — but it must be factored into ForgePay's liquidity planning.

---

## 7. Annual Compliance Costs

This section provides transparency on the ongoing cost of regulatory compliance, demonstrating ForgePay's commitment and financial capacity to sustain compliance.

| Compliance Cost Item | Year 1 (ZAR) | Year 2 (ZAR) | Year 3 (ZAR) |
|---|---|---|---|
| FSCA annual license fee (estimated) | 50,000 | 50,000 | 75,000 |
| FIC Accountable Institution registration | 0 | 0 | 0 |
| External compliance audit | 80,000 | 80,000 | 100,000 |
| External legal counsel (ongoing) | 120,000 | 100,000 | 100,000 |
| AML/CFT software and blockchain analytics | 200,000 | 200,000 | 250,000 |
| KYC/eKYC vendor | 150,000 | 200,000 | 300,000 |
| PCI DSS assessment (QSA / SAQ) | 150,000 | 150,000 | 200,000 |
| External penetration testing | 120,000 | 120,000 | 120,000 |
| Professional Indemnity insurance | 80,000 | 90,000 | 100,000 |
| Crime / fidelity insurance | 40,000 | 45,000 | 50,000 |
| Cyber insurance | 60,000 | 70,000 | 80,000 |
| FSCA returns / reporting (staff time) | 100,000 | 100,000 | 120,000 |
| POPIA compliance (DPO, privacy tool) | 80,000 | 80,000 | 100,000 |
| Compliance training | 30,000 | 35,000 | 40,000 |
| **Total Compliance Cost** | **1,260,000** | **1,320,000** | **1,635,000** |

---

## 8. Financial Statements and Auditor Details

### 8.1 Audited Financial Statements

[Attach most recent audited financial statements. If ForgePay is less than 2 years old, attach management accounts and founding capital confirmation.]

**Auditor (if applicable):**

| Field | Detail |
|---|---|
| Audit Firm | [Firm name] |
| IRBA Registration Number | [Number] |
| Engagement Partner | [Name] |
| Contact | [Email, phone] |
| Period of Audit | [Financial year covered] |

### 8.2 Accountant / CFO Confirmation

The CFO confirms that:
1. The financial information in this document and attached financial statements is accurate and complete.
2. ForgePay maintains the required minimum capital as of the date of this submission.
3. The client funds trust account is separate from operating accounts and adequately funded.
4. ForgePay has the financial capacity to sustain operations and compliance obligations for a minimum of 12 months from the date of submission.

**CFO Signature:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

**Name:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

**Date:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

---

## Appendices

- Appendix C1: Detailed 3-year financial model (month-by-month; income statement, balance sheet, cash flow)
- Appendix C2: Capital confirmation bank statement (certified; not older than 3 months)
- Appendix C3: Capital confirmation letter from accountant / auditor
- Appendix C4: Professional Indemnity insurance certificate
- Appendix C5: Crime / fidelity insurance certificate
- Appendix C6: Client funds trust account agreement
- Appendix C7: Audited financial statements (or management accounts)
- Appendix C8: Tax clearance certificate
