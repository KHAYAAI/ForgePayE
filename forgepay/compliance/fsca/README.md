# ForgePay — FSCA Payment Service Provider License Application Package

## Overview

This directory contains the complete application package for ForgePay's Financial Sector Conduct Authority (FSCA) Money Transmitter / Payment Service Provider license in the Republic of South Africa.

ForgePay operates a payment orchestration platform built on a Hyperswitch (Apache 2.0) core, processing card payments, bank transfers, USDC/USDT stablecoins, and crypto (BTC/ETH/LTC/XMR) via a unified API. All infrastructure is hosted on AWS EKS in the `af-south-1` (Cape Town) region to satisfy POPIA data residency requirements.

---

## Regulatory Authority

| Field | Detail |
|---|---|
| **Regulator** | Financial Sector Conduct Authority (FSCA) |
| **Website** | [www.fsca.org.za](https://www.fsca.org.za) |
| **Application Portal** | [fsp.fsca.org.za](https://fsp.fsca.org.za) |
| **Postal Address** | Riverwalk Office Park, Block B, 41 Matroosberg Road, Ashlea Gardens, Pretoria, 0081 |
| **PO Box** | PO Box 35655, Menlo Park, 0102 |
| **General Enquiries** | +27 12 428 8000 |
| **Email** | info@fsca.org.za |
| **FSP Licensing** | licensing@fsca.org.za |
| **AML/CFT (FIC)** | +27 12 641 6000 / fic@fic.gov.za |

### Parallel Regulator — Financial Intelligence Centre (FIC)

Under the Financial Intelligence Centre Act 38 of 2001 (FIC Act), ForgePay must also register as an Accountable Institution with the FIC (Category 22 — persons who carry on the business of a money remitter). FIC registration and FSCA licensing run concurrently.

---

## Application Timeline

| Phase | Owner | Target Date | Status |
|---|---|---|---|
| Internal compliance readiness assessment | Compliance Team | Week 1-2 | Pending |
| External legal / compliance counsel engagement | CEO / CFO | Week 2 | Pending |
| Capital adequacy confirmation (R 1,000,000 minimum) | CFO | Week 3 | Pending |
| Directors' Fit and Proper declarations | All Directors | Week 3-4 | Pending |
| Board resolutions (see `08_board_resolutions_template.md`) | Board | Week 4 | Pending |
| FIC Accountable Institution registration | Compliance Officer | Week 4-6 | Pending |
| Document compilation and internal review | Compliance Team | Week 4-8 | Pending |
| External legal review of application package | Legal Counsel | Week 8-10 | Pending |
| FSCA online portal submission | Compliance Officer | Week 10 | Pending |
| FSCA intake review | FSCA | Month 3-4 | Awaiting submission |
| Fit and Proper assessment | FSCA | Month 4-6 | Awaiting submission |
| Policy review (AML/CFT, IT, Business Plan) | FSCA | Month 5-8 | Awaiting submission |
| On-site / virtual systems inspection | FSCA | Month 8-10 | Awaiting submission |
| License decision | FSCA | Month 10-12 | Awaiting submission |

**Total estimated time: 10–14 months from submission.**

---

## Package Contents

| File | Document | Status |
|---|---|---|
| `01_application_checklist.md` | FSCA PSP Application Checklist | Draft |
| `02_regulatory_business_plan.md` | Regulatory Business Plan | Draft |
| `03_aml_cft_policy.md` | AML/CFT Policy & Procedures | Draft |
| `04_fit_and_proper_declaration_template.md` | Fit and Proper Declaration Template | Draft |
| `05_systems_and_controls.md` | IT Systems and Operational Controls | Draft |
| `06_financial_requirements.md` | Capital Adequacy & Financial Requirements | Draft |
| `07_popia_compliance.md` | POPIA Compliance Documentation | Draft |
| `08_board_resolutions_template.md` | Board Resolutions Templates | Draft |
| `09_application_submission_guide.md` | Application Submission Guide | Draft |

---

## Key Compliance Contacts (ForgePay Internal)

| Role | Responsibility |
|---|---|
| Chief Compliance Officer | Primary FSCA liaison; signs all declarations |
| AML/CFT Officer | FIC registration; transaction monitoring oversight |
| Data Protection Officer (DPO) | POPIA compliance; privacy impact assessments |
| Chief Technology Officer | Systems and controls sign-off; PCI DSS |
| Chief Financial Officer | Capital adequacy; financial projections sign-off |
| External Legal Counsel | Application review; regulatory correspondence |

---

## Applicable Legislation

- Financial Sector Regulation Act 9 of 2017 (FSRA)
- Financial Advisory and Intermediary Services Act 37 of 2002 (FAIS) — as applicable
- Financial Intelligence Centre Act 38 of 2001 (FIC Act), as amended
- Protection of Personal Information Act 4 of 2013 (POPIA)
- Companies Act 71 of 2008
- Electronic Communications and Transactions Act 25 of 2002 (ECTA)
- South African Reserve Bank (SARB) Currency and Exchanges Act 9 of 1933 (for cross-border flows)
- National Payment System Act 78 of 1998 (NPS Act)
- Exchange Control Regulations (administered by SARB)

---

## Important Notes

1. **Legal Advice Required:** This package is a working draft. All documents must be reviewed by a South African attorney admitted to practice and a compliance professional registered with the Compliance Institute of Southern Africa (CISA) before submission.
2. **No Guarantees:** FSCA licensing decisions are at the discretion of the regulator. Submission does not guarantee approval.
3. **Operating Before Approval:** ForgePay must not conduct regulated payment activities in South Africa without the appropriate license unless operating under an exemption or in partnership with a licensed entity.
4. **Version Control:** All documents in this package are version-controlled in Git. The Git commit hash at time of submission must be recorded in the submission log.
5. **Crypto Regulatory Uncertainty:** Crypto-asset services may require separate registration as a Crypto Asset Service Provider (CASP) under the amended FAIS Act. Consult legal counsel on whether ForgePay's crypto gateway requires separate CASP registration.
