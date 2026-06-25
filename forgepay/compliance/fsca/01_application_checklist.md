# FSCA PSP License Application — Complete Checklist

**Application Type:** Money Transmitter / Payment Service Provider (Category II / III FSP as applicable)
**Applicant:** ForgePay (Pty) Ltd
**Prepared By:** Chief Compliance Officer
**Last Updated:** 2026-06-25
**Version:** 1.0

> Legend: `[ ]` Pending | `[~]` In Progress | `[x]` Complete | `[!]` Blocked / Needs Attention

---

## Section A: Applicant Entity Documents

| # | Document | Status | Owner | Notes |
|---|---|---|---|---|
| A1 | Certificate of Incorporation (CoR14.3 or equivalent) | `[ ]` | CFO | Must be certified copy |
| A2 | Memorandum of Incorporation (MOI) | `[ ]` | CFO | Must include objects clause covering payment services |
| A3 | Company Registration Number (CIPC) | `[ ]` | CFO | Confirm entity is registered in South Africa |
| A4 | Register of Directors (current, signed by company secretary) | `[ ]` | Company Secretary | All directors listed with ID numbers |
| A5 | Register of Shareholders / Members (beneficial ownership to 25%+) | `[ ]` | Company Secretary | Ultimate Beneficial Owner (UBO) declaration required |
| A6 | Organogram / Organisational structure | `[ ]` | CEO | Include all subsidiaries and group entities |
| A7 | Group structure diagram (if applicable) | `[ ]` | CFO | Show parent entities, offshore holding structures |
| A8 | Tax Clearance Certificate (SARS) | `[ ]` | CFO | Valid certificate; must be current at submission date |
| A9 | Good Standing Certificate from CIPC | `[ ]` | CFO | Issued within 3 months of submission |
| A10 | Registered office address proof | `[ ]` | CEO | Municipal rates account or lease agreement |

---

## Section B: Directors, Key Persons, and Shareholders

For **each** director, prescribed officer, key individual, and shareholder holding 10% or more:

| # | Document | Status | Owner | Notes |
|---|---|---|---|---|
| B1 | Certified copy of South African ID / Passport | `[ ]` | Each Individual | Foreign nationals: certified passport + work permit |
| B2 | Curriculum Vitae (CV) | `[ ]` | Each Individual | 10-year employment history; no gaps |
| B3 | Certified academic qualifications | `[ ]` | Each Individual | Degrees, professional certifications |
| B4 | Fit and Proper Declaration (use `04_fit_and_proper_declaration_template.md`) | `[ ]` | Each Individual | Signed and commissioned |
| B5 | Police clearance certificate | `[ ]` | Each Individual | South African; foreign directors: equivalent from home country |
| B6 | Credit bureau report | `[ ]` | Each Individual | TransUnion or Experian; within 3 months of submission |
| B7 | Declaration of solvency | `[ ]` | Each Individual | Sworn affidavit before commissioner of oaths |
| B8 | Proof of residential address | `[ ]` | Each Individual | Not older than 3 months |
| B9 | Written consent to FSCA background check | `[ ]` | Each Individual | FSCA Form FP001 or equivalent |
| B10 | Regulatory history declaration (sanctions, bans, debarments) | `[ ]` | Each Individual | Worldwide, 10-year lookback |

---

## Section C: Business Plan and Financial Documents

| # | Document | Status | Owner | Notes |
|---|---|---|---|---|
| C1 | Regulatory Business Plan (use `02_regulatory_business_plan.md`) | `[ ]` | CEO / CCO | 3-5 year projection; FSCA format |
| C2 | 3-year financial projections (income statement, balance sheet, cash flow) | `[ ]` | CFO | Auditor or accountant sign-off recommended |
| C3 | Current year management accounts (not older than 3 months) | `[ ]` | CFO | Signed by CFO or designated accountant |
| C4 | Previous 2 years audited financial statements (if entity is >2 years old) | `[ ]` | CFO | Must be signed by registered auditor (IRBA) |
| C5 | Proof of minimum capital — R 1,000,000 | `[ ]` | CFO | Bank statement or auditor confirmation; see `06_financial_requirements.md` |
| C6 | Professional Indemnity Insurance Certificate | `[ ]` | CFO | Minimum R 5,000,000 cover; insurer must be South African registered |
| C7 | Fidelity / Crime Insurance Certificate | `[ ]` | CFO | Cover for employee dishonesty and fraud |
| C8 | Client funds safeguarding arrangement | `[ ]` | CFO | Trust account / segregated account documentation; see `06_financial_requirements.md` |
| C9 | Surety / bond (if required by FSCA) | `[ ]` | CFO | Typically R 500,000–R 2,000,000 for PSP |
| C10 | Budget for first year of licensed operations | `[ ]` | CFO | Including compliance, staffing, technology |

---

## Section D: AML/CFT Compliance Program

| # | Document | Status | Owner | Notes |
|---|---|---|---|---|
| D1 | AML/CFT Policy (use `03_aml_cft_policy.md`) | `[ ]` | CCO / AMLCO | Board-approved; FIC Act compliant |
| D2 | Risk Assessment — Business-wide (BWRA) | `[ ]` | AMLCO | Identify ML/TF risks by product, channel, geography |
| D3 | Customer Risk Assessment (CRA) methodology | `[ ]` | AMLCO | Risk scoring matrix; must distinguish retail vs merchant |
| D4 | Customer Due Diligence (CDD) procedures | `[ ]` | AMLCO | Standard and Enhanced CDD; PEP screening |
| D5 | Know Your Customer (KYC) form samples | `[ ]` | AMLCO | Individual and business customer versions |
| D6 | Politically Exposed Persons (PEP) screening policy | `[ ]` | AMLCO | Screening tool vendor confirmation |
| D7 | Sanctions screening policy and vendor confirmation | `[ ]` | AMLCO | OFAC, UN, EU, FSCA sanctions lists; real-time checks |
| D8 | Transaction monitoring rules documentation | `[ ]` | AMLCO | ForgePay's 8-rule AML engine; threshold documentation |
| D9 | Suspicious Activity Report (SAR) template and escalation procedure | `[ ]` | AMLCO | Must include FIC reporting within 15 business days |
| D10 | Record retention policy (5-year minimum) | `[ ]` | AMLCO | Data lineage from ForgePay PostgreSQL audit tables |
| D11 | AMLCO appointment letter + CV | `[ ]` | CEO | AMLCO must meet fit and proper requirements |
| D12 | AML staff training programme | `[ ]` | AMLCO | Annual training; training records |
| D13 | FIC Accountable Institution registration confirmation | `[ ]` | AMLCO | Register before or simultaneously with FSCA application |
| D14 | Correspondent / third-party risk management policy | `[ ]` | AMLCO | Covers payment processors, card networks, crypto exchanges |

---

## Section E: IT, Systems, and Operational Controls

| # | Document | Status | Owner | Notes |
|---|---|---|---|---|
| E1 | IT Security Policy (use `05_systems_and_controls.md`) | `[ ]` | CTO | Board-approved |
| E2 | PCI DSS compliance status / attestation | `[ ]` | CTO | SAQ or QSA Report on Compliance (ROC) as applicable |
| E3 | Data flow diagrams (cardholder data environment) | `[ ]` | CTO | Show tokenization path through Hyperswitch vault |
| E4 | Network architecture diagram | `[ ]` | CTO | AWS EKS af-south-1 topology; DMZ, VPC segmentation |
| E5 | Access control policy (RBAC, MFA, privileged access) | `[ ]` | CTO | Reference IAM policies in Kubernetes |
| E6 | Encryption standards documentation | `[ ]` | CTO | TLS 1.2+ in transit; AES-256 at rest |
| E7 | Business Continuity Plan (BCP) | `[ ]` | CTO / COO | RTO and RPO targets; tested annually |
| E8 | Disaster Recovery Plan (DRP) | `[ ]` | CTO | Multi-AZ; backup restoration procedures |
| E9 | Incident Response Plan | `[ ]` | CTO | Breach notification (72-hour POPIA rule); escalation paths |
| E10 | Penetration test report (not older than 12 months) | `[ ]` | CTO | External pen test by CREST-accredited or equivalent firm |
| E11 | Vulnerability management policy | `[ ]` | CTO | Patching cadence; CVSS scoring |
| E12 | Audit logging specification | `[ ]` | CTO | OTEL + PostgreSQL audit trails; tamper-evident |
| E13 | Third-party vendor / sub-processor list | `[ ]` | CTO | AWS, Hyperswitch, card acquirer, crypto exchange partners |
| E14 | POPIA compliance documentation (use `07_popia_compliance.md`) | `[ ]` | DPO | Data residency: all primary data in af-south-1 |
| E15 | Software Development Lifecycle (SDLC) policy | `[ ]` | CTO | Secure coding; code review; vulnerability scanning in CI/CD |

---

## Section F: Governance and Legal Documents

| # | Document | Status | Owner | Notes |
|---|---|---|---|---|
| F1 | Board resolutions (use `08_board_resolutions_template.md`) | `[ ]` | Company Secretary | Resolution to apply; adopt policies; appoint compliance officer |
| F2 | Compliance Officer appointment letter + CV | `[ ]` | CEO | Compliance officer must meet FSCA fit and proper |
| F3 | Governance framework / compliance policy | `[ ]` | CCO | Board oversight; compliance reporting structure |
| F4 | Conflicts of interest policy | `[ ]` | CCO | Director and key person disclosure requirements |
| F5 | Outsourcing / third-party management policy | `[ ]` | CCO | Covers cloud services, acquirer relationships |
| F6 | Consumer protection / complaints handling procedure | `[ ]` | CCO | Must include FSCA ombudsman referral process |
| F7 | Product / service terms and conditions (merchant agreement template) | `[ ]` | Legal | Governing law: South Africa; dispute resolution |
| F8 | Merchant onboarding KYB procedure | `[ ]` | CCO | Know Your Business; beneficial ownership verification |
| F9 | Anti-bribery and anti-corruption policy | `[ ]` | CCO | PRECCA alignment |
| F10 | Whistleblower policy | `[ ]` | CCO | Protected Disclosures Act 26 of 2000 |

---

## Section G: Product and Market-Specific Supplements

| # | Document | Status | Owner | Notes |
|---|---|---|---|---|
| G1 | Crypto-asset product description (BTC/ETH/LTC/XMR) | `[ ]` | CTO / CCO | Describe how crypto is settled; custody arrangements |
| G2 | Stablecoin product description (USDC/USDT) | `[ ]` | CTO / CCO | Circle / Tether relationship; reserve attestations |
| G3 | x402 AI agent payment protocol description | `[ ]` | CTO / CCO | Novel product; describe safeguards for automated payments |
| G4 | SARB Exchange Control implications analysis | `[ ]` | Legal | Cross-border crypto settlement; Authorised Dealer relationship |
| G5 | Consumer disclosure (fees, FX rates, settlement times) | `[ ]` | Legal | Section 43 ECTA; mandatory pre-contractual disclosure |
| G6 | CASP registration status (if required by FSCA for crypto) | `[ ]` | CCO | Verify with FSCA whether separate CASP license needed |

---

## Checklist Sign-Off

| Role | Name | Signature | Date |
|---|---|---|---|
| Chief Compliance Officer | | | |
| Chief Executive Officer | | | |
| Chief Financial Officer | | | |
| Chief Technology Officer | | | |
| External Legal Counsel | | | |

---

## Notes and Outstanding Actions

_Record any items that require escalation, external input, or are blocked pending regulatory clarity:_

1. CASP registration requirement — pending legal opinion from external counsel on whether ForgePay's crypto gateway falls within the amended FAIS Act definition of CASP services.
2. Capital adequacy — the SOUTH_AFRICA_LICENSES.md reference notes R 500,000 minimum; the actual FSCA/NPS requirement for PSPs may be R 1,000,000 or higher. Confirm with FSCA licensing unit before submission.
3. Exchange control — SARB's FinSurv reporting requirements apply to cross-border crypto settlements. Authorised Dealer bank relationship required.
