# ForgePay FCA PI Application — Master Checklist

**Application type:** Payment Institution (PI) — full authorisation under PSR 2017  
**Applicant:** ForgePay Ltd  
**Prepared:** 25 June 2026  
**Review owner:** MLRO / Compliance Officer  

---

## How to Use This Checklist

Work through each section in order. Mark each item as:
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[N/A]` Not applicable (add brief reason)

All items marked complete must have a supporting document reference before submission to FCA Connect.

---

## Section A — Applicant Details

### A1. Entity Information
- [ ] Companies House incorporation certificate (UK Ltd)
- [ ] Memorandum and Articles of Association (drafted to include payment services as objects)
- [ ] Certificate of Registered Office (UK address)
- [ ] List of directors and company secretaries (full legal names, DOB, nationality)
- [ ] List of shareholders with >10% beneficial interest (PSR 2017 Schedule 2 para 1(h))
- [ ] Group structure chart (if ForgePay Ltd is part of a group)
- [ ] Confirmation that no director/controller is disqualified under Company Directors Disqualification Act 1986

### A2. Contact Details
- [ ] Principal contact for FCA correspondence (name, title, email, phone)
- [ ] FCA Connect user accounts created for all SMF applicants
- [ ] Registered email address confirmed for FCA Connect notifications

### A3. Ownership and Controllers
- [ ] Qualifying holding notification (PSR 2017 Schedule 6) for any person with >10% voting rights or shares
- [ ] Source of funds declaration for initial capital investment
- [ ] Enhanced due diligence (EDD) on controllers if applicable

---

## Section B — Programme of Operations

**Supporting document:** `02_programme_of_operations.md`

- [ ] B1: Description of each payment service to be provided, referencing PSR 2017 Schedule 1 categories
- [ ] B2: Types of payment instruments accepted (cards, bank transfer, stablecoins, crypto)
- [ ] B3: Target customer segments (B2B merchants — UK and EEA incorporated)
- [ ] B4: Geographic scope — UK domestic + cross-border (EEA + international)
- [ ] B5: Distribution channels (API, dashboard, Stripe-compatible SDK)
- [ ] B6: Correspondent banking and settlement arrangements
- [ ] B7: Currency coverage (GBP, EUR, USD, USDC, USDT, BTC, ETH, LTC, XMR)
- [ ] B8: Description of x402 AI agent payment protocol (novel — will require pre-application discussion with FCA)
- [ ] B9: Exclusions / services NOT provided (e-money issuance, credit, FX dealing as principal)

---

## Section C — Business Plan

**Supporting document:** `03_regulatory_business_plan.md`

- [ ] C1: Executive summary (1–2 pages)
- [ ] C2: Company background and ownership structure
- [ ] C3: Management team profiles (experience, qualifications, regulatory track record)
- [ ] C4: Services to be provided (detailed narrative, not just PSR categories)
- [ ] C5: Revenue model (interchange share, SaaS fees, gateway fees, crypto spread)
- [ ] C6: Customer acquisition strategy (how ForgePay will onboard merchants)
- [ ] C7: Technology description (Hyperswitch payment router, EKS deployment, OTEL observability)
- [ ] C8: Third-party dependencies (Hyperswitch upstream, AWS EKS, Vault, payment networks)
- [ ] C9: IT security overview (PCI DSS scope, card vault, encryption at rest/transit)
- [ ] C10: Outsourcing arrangements (cloud infrastructure, card network acquiring)
- [ ] C11: Three-year growth projections narrative (supporting Section D numbers)
- [ ] C12: Regulatory history of directors/key personnel

---

## Section D — Financial Projections

**Supporting document:** `04_financial_projections.md`

- [ ] D1: Three-year P&L forecast (monthly Year 1, quarterly Years 2–3)
- [ ] D2: Three-year balance sheet forecast
- [ ] D3: Three-year cash flow statement
- [ ] D4: Capital adequacy calculation (fixed overhead requirement vs payment volume method vs €125k minimum)
- [ ] D5: Initial capital evidence (bank statement showing minimum €125,000 / ~£108,000 GBP equivalent)
- [ ] D6: Assumptions schedule (growth rate, transaction values, interchange rates, staff costs)
- [ ] D7: Stress scenarios (3 scenarios: base, downside, severe downside)
- [ ] D8: Liquidity buffer analysis
- [ ] D9: Breakdown of projected payment volumes by service type
- [ ] D10: Funding sources and runway analysis (how long initial capital lasts pre-revenue)

---

## Section E — Evidence of Initial Capital

- [ ] Bank statement(s) dated within 3 months showing minimum €125,000 (or GBP/USD equivalent at FCA-specified rate)
- [ ] If capital is being raised (investor / founder loan), provide evidence of commitment (term sheet, shareholder resolution)
- [ ] Confirmation that capital is free from encumbrances and available on demand
- [ ] If capital is held in foreign currency, provide exchange rate used and source

---

## Section F — Governance Arrangements

**Supporting document:** `08_smf_declarations.md`

- [ ] F1: Governance structure chart (board, committees, reporting lines)
- [ ] F2: Board composition (names, roles, executive/non-executive split)
- [ ] F3: Committee structure (e.g., Risk Committee, Audit Committee if applicable)
- [ ] F4: Delegation of authority framework
- [ ] F5: Conflicts of interest policy
- [ ] F6: Board meeting frequency and quorum rules
- [ ] F7: Remuneration policy (PSR 2017 Schedule 3 para 4 — risk alignment)
- [ ] F8: SM&CR Senior Manager Function mapping (see Section K)

---

## Section G — Internal Control Mechanisms

**Supporting documents:** `07_aml_policy.md`, `09_operational_resilience_policy.md`

### G1: AML/CFT Controls
- [ ] AML Policy (aligned to MLR 2017 and JMLSG Guidance, Parts I–III)
- [ ] Customer Due Diligence (CDD) procedures — standard and enhanced
- [ ] PEP and sanctions screening procedures (OFAC, UK HMT, EU consolidated list)
- [ ] Transaction monitoring rules (ForgePay 8-rule AML engine documented)
- [ ] SAR/DAML submission procedures (NCA reporting)
- [ ] MLRO appointment and mandate
- [ ] Annual MLRO report template
- [ ] AML training programme (frequency, content, records)
- [ ] Record keeping policy (minimum 5 years, MLR 2017 reg 40)

### G2: Operational Risk Controls
- [ ] Business Continuity Plan (BCP)
- [ ] Disaster Recovery Plan (DRP) (EKS multi-AZ in eu-west-2)
- [ ] Incident management procedures
- [ ] Change management process (Kubernetes deployments, Hyperswitch upgrades)
- [ ] Third-party / outsourcing risk management (AWS dependency, acquiring banks)
- [ ] Penetration testing schedule (annual minimum, PCI DSS requirement)
- [ ] Vulnerability management programme
- [ ] Data protection impact assessment (DPIA) for payment data processing

### G3: Compliance Monitoring Programme (see Section J)
- [ ] Compliance monitoring plan (annual schedule)
- [ ] Regulatory horizon scanning process
- [ ] Breach / incident reporting procedure (internal + FCA)
- [ ] Complaints handling procedure (FCA DISP rules apply to PI)

---

## Section H — Safeguarding Arrangements

**Supporting document:** `05_safeguarding_policy.md`

- [ ] H1: Safeguarding method selected (segregation OR insurance/guarantee — must specify)
- [ ] H2: Name of nominated safeguarding bank (authorised UK credit institution)
- [ ] H3: Draft safeguarding account agreement / letter from bank
- [ ] H4: Daily reconciliation procedure (end-of-day balance check, exception process)
- [ ] H5: Handling of interest earned on safeguarded funds
- [ ] H6: Insolvency procedure (how customer funds are returned, who administers)
- [ ] H7: Monitoring and internal audit of safeguarding (frequency, responsible officer)
- [ ] H8: Evidence that safeguarding account is in the name of ForgePay Ltd (ring-fenced, not commingled with operational funds)

---

## Section I — Wind-Down Arrangements

**Supporting document:** `06_wind_down_plan.md`

- [ ] I1: Trigger events for wind-down (financial, regulatory, voluntary)
- [ ] I2: Governance and decision-making during wind-down
- [ ] I3: Customer notification procedure and timeline (20 business days' notice minimum)
- [ ] I4: Return of safeguarded funds to customers
- [ ] I5: Data portability and access after cessation
- [ ] I6: Notification to FCA (PSR 2017 reg 44)
- [ ] I7: Estimated wind-down costs and capital held against those costs
- [ ] I8: Wind-down testing — when and how the plan will be rehearsed

---

## Section J — Compliance Monitoring Programme

The FCA requires a **written Compliance Monitoring Programme (CMP)** demonstrating how ForgePay will monitor ongoing compliance with PSR 2017 obligations.

### J1: CMP Structure
- [ ] Regulatory universe mapped (all FCA rules applicable to ForgePay as PI)
- [ ] Monitoring activities scheduled (frequency: daily, weekly, monthly, quarterly, annual)
- [ ] Owner assigned to each monitoring activity
- [ ] Escalation path for compliance failures
- [ ] Board/senior management reporting mechanism (minimum quarterly MI pack)

### J2: Key Monitoring Activities

| Monitoring Activity | Frequency | Owner |
|---|---|---|
| Safeguarding account reconciliation | Daily | Finance / Treasury |
| Transaction monitoring alert review | Daily | MLRO team |
| PEP/sanctions screening (new merchants) | At onboarding | Compliance |
| SAR log review | Weekly | MLRO |
| Complaints register review | Monthly | Compliance Officer |
| AML policy effectiveness review | Quarterly | MLRO |
| Capital adequacy calculation | Monthly | CFO |
| Regulatory change horizon scan | Monthly | Compliance Officer |
| Penetration testing | Annual | CTO / Security |
| AML training completion rates | Quarterly | Compliance Officer |
| Outsourcing performance review | Quarterly | COO |
| Full CMP audit | Annual | Internal / External Audit |

### J3: Regulatory Reporting to FCA
- [ ] FCA RegData reporting obligations mapped (PI Annual Report, payment statistics)
- [ ] Process for submitting FCA RegData returns on time
- [ ] Significant incident reporting procedure (FCA operational resilience requirements)
- [ ] Change in control notification procedure (PSR 2017 reg 29)

### J4: SM&CR Ongoing Obligations
- [ ] Fit and proper assessment schedule for SMF holders (annual refresh)
- [ ] Regulatory reference request/provision procedure
- [ ] Certification Regime assessment process (if applicable)
- [ ] Conduct Rules training (annual, for all staff in scope)

---

## Section K — SMF Applications

**Supporting document:** `08_smf_declarations.md`

For each individual holding an SMF, submit a separate individual application in FCA Connect:

- [ ] K1: SMF16 (Compliance Oversight) — Individual application, IQ, Statement of Responsibilities, regulatory references
- [ ] K2: SMF17 (MLRO) — Individual application, IQ, Statement of Responsibilities, regulatory references
- [ ] K3: CEO (SMF1 if applicable, or relevant executive function) — Individual application
- [ ] K4: CFO (SMF2 if applicable) — Individual application
- [ ] K5: All IQs submitted via FCA Connect (paper IQ fallback available)
- [ ] K6: Regulatory references requested from all previous FCA-authorised employers (within 6 years)

---

## Section L — Regulatory References

- [ ] L1: Regulatory reference requests sent to all employers where SMF applicant held controlled function or SMF (within 6 years)
- [ ] L2: Reference responses received and reviewed
- [ ] L3: Any adverse reference information disclosed to FCA proactively
- [ ] L4: Regulatory reference log maintained

---

## Pre-Submission Final Checks

- [ ] All FCA Connect form sections completed — no mandatory fields blank
- [ ] All supporting documents uploaded in FCA Connect (PDF format, max 10MB per file)
- [ ] Application fee paid (£5,000 PI, or £10,000 for combined PI + Cryptoasset)
- [ ] Pre-application meeting (PAM) completed or waived (document decision)
- [ ] Legal counsel has reviewed all documents
- [ ] Compliance consultant sign-off obtained
- [ ] Board resolution approving submission of FCA application
- [ ] All SMF applicants have reviewed and signed their Statements of Responsibilities
- [ ] MLRO appointed and in post (or conditional upon authorisation — confirm with FCA)

---

## Post-Submission Obligations

- [ ] Monitor FCA Connect for queries (minimum weekly)
- [ ] Designate a single point of contact for FCA case officer
- [ ] Brief all SMF holders on FCA interview preparation
- [ ] Notify FCA of any material changes during review period (PSR 2017 reg 10(7))
- [ ] Maintain application document version control (FCA may request updated versions)

---

*Document version: 1.0 — 25 June 2026*  
*Owner: Compliance Officer / MLRO*  
*Next review: Prior to FCA submission*
