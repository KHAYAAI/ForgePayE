# NMLS Application Guide
## Nationwide Multistate Licensing System — Money Transmitter License

**System URL:** https://www.nmlsconsumeraccess.org/
**NMLS Call Center:** 1-855-NMLS-123 (1-855-665-7123)
**NMLS Resource Center:** https://mortgage.nationwidelicensingsystem.org/slr/Pages/msb.aspx
**Hours:** Monday–Friday, 9 AM – 9 PM ET

---

## Overview

The Nationwide Multistate Licensing System (NMLS) is the centralized platform used by most U.S. states to process Money Transmitter License (MTL) applications, collect licensing fees, manage renewals, and conduct ongoing supervision. Filing through NMLS allows ForgePay to submit a single company profile and apply to multiple states simultaneously, significantly reducing the administrative burden of multi-state licensing.

**Key NMLS Concepts:**
- **MU1:** Company (Entity) Form — the base application for ForgePay as a business
- **MU2:** Individual (Control Person) Form — submitted for each officer, director, and 10%+ owner
- **NMLS Company ID:** Assigned when the company account is created; used on all state applications and communications
- **Attestation:** An authorized signer must attest to the accuracy of all NMLS filings

---

## Step 1: Create ForgePay's Company Account

### 1.1 Account Creation

1. Navigate to [https://www.nmlsconsumeraccess.org/](https://www.nmlsconsumeraccess.org/)
2. Click **"Apply for a New Company License"** or navigate to the NMLS company portal
3. Select **"Submit a Company Filing"**
4. Choose **"Create a New Account"**

You will be prompted to provide:
- Company legal name (as registered with the state of incorporation)
- EIN (Federal Employer Identification Number)
- State of formation
- Business type (Corporation, LLC, etc.)
- Principal business address
- Company contact information

5. Create login credentials (Primary Account Administrator)
6. Designate a backup administrator
7. Complete identity verification

### 1.2 Account Roles

Set up the following NMLS account roles:

| Role | Person | Access Level |
|------|--------|-------------|
| Primary Account Admin | CCO or COO | Full access, all filings |
| Secondary Account Admin | Deputy CCO | Full access (backup) |
| Filing Preparer | Compliance Analyst | Can draft, cannot submit |
| MU2 Contact | Each control person | Personal MU2 form only |

---

## Step 2: Complete the MU1 Form (Company Form)

The MU1 is ForgePay's core company filing in NMLS. It must be completed before any state applications can be submitted.

### MU1 Sections

**Section 1 — Identifying Information**
- Legal name of company
- All DBA (doing business as) names
- Federal Tax ID (EIN)
- State of formation and date of formation
- Fiscal year end
- Entity type
- Stock type (if applicable)

**Section 2 — Primary Contact**
- Primary contact for regulatory correspondence
- This should be the CCO or a senior compliance officer

**Section 3 — Financial Statements**
Upload the following financial documents:

| Document | Requirement |
|----------|-------------|
| Most recent audited annual financial statements | Typically required (2 years) |
| Most recent balance sheet | As of filing date |
| Proof of net worth (by state requirement) | Signed letter from CPA or auditor |
| Bank statements (3 months) | Some states require |

For a startup without 2 years of audited financials:
- Submit audited statements for available periods
- Supplement with compiled or reviewed statements
- Provide 3-year financial projections prepared by a CPA
- Include startup funding documentation (Series A, seed round, bank balances)

**Section 4 — Disclosure Questions**

Answer all disclosure questions regarding:
- Criminal history of the company and its principals
- Regulatory actions (prior license denials, suspensions, revocations)
- Litigation (material lawsuits, judgments, settlements)
- Bankruptcy history

**Tip:** Disclosures do not automatically disqualify an applicant. States want to see candid disclosure plus explanation and mitigation. Disclose everything; consult legal counsel on presentation.

**Section 5 — Business Activities**

Describe ForgePay's money transmission business:
- Types of products/services offered (card payments, stablecoin, crypto, x402)
- Geographic scope of operations
- Target customer segments (merchants, consumers, AI agents)
- Transaction volume estimates (annual)
- Whether ForgePay uses authorized agents or sub-processors

**Section 6 — Books and Records Location**
- Where ForgePay's financial records and transaction records are maintained
- For cloud-hosted records (AWS us-east-1): specify the data location and that records are accessible to regulators within 5 business days

**Section 7 — Bank Accounts**
- List all bank accounts used for customer funds (segregated trust accounts)
- List all operating accounts
- Include bank name, account type, and purpose

**Section 8 — Organizational Chart**
Upload an organizational chart showing:
- Corporate ownership structure (all entities and individuals owning 10%+)
- Management hierarchy
- Compliance function reporting lines

**Section 9 — Control Persons (Links to MU2)**
- List all individuals who must complete MU2 forms
- Each MU2 record will be linked to the MU1

---

## Step 3: Complete MU2 Forms (Control Person Forms)

Every **officer, director, and individual owning 10% or more** of ForgePay must complete an MU2 form. This includes:

- CEO / Founder
- CTO / Technical co-founders
- CCO (Chief Compliance Officer)
- CFO
- Any board members who are also officers
- Any investors owning 10%+ (individual or entity)

**If a 10%+ owner is an entity (e.g., a VC fund), the fund must also complete an MU1 filing, and the fund's control persons may need MU2 forms. Consult legal counsel on entity ownership chains.**

### MU2 Sections

**Section 1 — Personal Information**
- Full legal name (must match government ID)
- Date of birth
- Place of birth
- Social Security Number (SSN)
- Current home address
- All addresses for the past 10 years

**Section 2 — Employment History**
- 10-year employment history
- All prior financial services roles
- Current roles at other companies

**Section 3 — Background Disclosure**
- Criminal history (all charges, not just convictions)
- Prior regulatory actions
- Civil judgments
- Bankruptcy history
- Tax liens

**Section 4 — Fingerprinting Authorization**

Most states require fingerprinting for all control persons. The fingerprinting process through NMLS:

1. In NMLS, navigate to the MU2 form → Fingerprint section
2. Select **"FBI Criminal Background Check"**
3. Schedule a fingerprint appointment at an authorized fingerprinting location (IdentoGO — Fieldprint)
4. Complete fingerprinting at the appointment
5. Results are routed directly to NMLS and shared with states
6. Timeline: allow 2–4 weeks for results to clear

**Note:** If a control person has already been fingerprinted for NMLS within the last 3 years, results may be reused (state-dependent).

---

## Step 4: Upload Required Documents

The following documents must be uploaded to NMLS before submitting state applications. Not all states require all documents; the NMLS checklist for each state will indicate what is required.

### Corporate Documents
- [ ] Articles of Incorporation / Articles of Organization
- [ ] Certificate of Good Standing from state of formation (issued within 30–60 days)
- [ ] Bylaws or Operating Agreement
- [ ] Organizational chart (corporate structure)
- [ ] List of all DBA names and state registrations

### Financial Documents
- [ ] Audited financial statements (2 most recent years)
- [ ] Compiled or reviewed financial statements (if audited not available)
- [ ] 3-year financial projections (signed by CPA)
- [ ] Recent bank statements (3 months, all business accounts)
- [ ] Evidence of permissible investments (if required by state)
- [ ] Net worth certification letter from CPA

### Business Plan
The business plan is required by most states and must include:
- Executive summary
- Description of money transmission products and services
- Target customer base (merchant and consumer)
- Description of crypto/stablecoin services (and how Travel Rule is handled)
- ForgePay's AML/BSA compliance program overview
- Technology platform description (Hyperswitch-based router, EKS on AWS)
- Cybersecurity program overview
- Financial projections (3 years)
- Management team biographies

**Tip:** The business plan is one of the most scrutinized elements. Hire a compliance consultant or attorney experienced in MTL applications to help draft this document.

### AML/BSA Program
- [ ] Written BSA/AML Program (see `02_bsa_aml_program.md`)
- [ ] OFAC compliance program (see `06_ofac_compliance_program.md`)
- [ ] Training program description and materials sample
- [ ] Independent audit plan or prior audit report (if available)

### Surety Bond
- [ ] Executed surety bond in the state-required amount
- [ ] Named obligee: "[State Name] Department of [Banking/Finance/etc.]"
- [ ] Bond effective date: concurrent with or prior to license issuance
- [ ] Upload the bond to NMLS in the Surety section

**Surety Bond Process:**
1. Contact a surety bond provider (Travelers, Zurich, Markel, Philadelphia Insurance)
2. Provide ForgePay's financial statements and credit information
3. Bond underwriter will assess premium (typically 1–5% of bond amount per year)
4. Obtain executed bond certificates for each state
5. Upload each bond to NMLS under the corresponding state application

### Key Personnel Background
- [ ] Resumes/CVs for all officers and directors
- [ ] Background disclosure narratives for any disclosed events
- [ ] Fingerprint authorization forms (if not doing electronic fingerprinting)

---

## Step 5: Submit State Applications

Once the MU1, all MU2 forms, and required documents are complete:

1. In NMLS, navigate to **"Apply for License/Registration"**
2. Select the state(s) to apply to
3. Review the state-specific checklist — each state has additional requirements beyond the base MU1
4. Complete any state-specific sections (some states have additional questions about virtual currency, number of locations, etc.)
5. Pay the application fee through NMLS (credit card or ACH)
6. Submit the application

**Multi-State Strategy:** For Tier 1 states, file applications 3–6 months before anticipated launch in each state. For Tier 2/3, file on a rolling basis. Some states can be filed simultaneously to reduce overall timeline.

### State-Specific Amendments

After submitting the base MU1, each state may require:
- State-specific business plan pages
- State-specific officer list
- Registered agent information in the state
- Foreign qualification (Certificate of Authority to do business in the state)
- State-specific surety bond form (some states have their own form, not just the NMLS bond form)

---

## Step 6: Manage the Application Process

### Deficiency Responses

States will issue deficiency letters requesting additional information. Timelines:
- Most states allow 30–60 days to respond to a deficiency
- Failing to respond timely can result in application abandonment
- Track all deficiency deadlines in a compliance calendar

### Communication with State Examiners

- Assign one point of contact (CCO or senior compliance officer) for each state
- Respond professionally and thoroughly to all examiner questions
- For complex questions, loop in legal counsel before responding
- Do not volunteer information beyond what is asked, but do not be evasive

### Application Status Tracking

NMLS provides real-time status for all submitted applications:
- **Pending Review:** Application received, not yet reviewed
- **Pending Additional Information:** Deficiency issued
- **Approved:** License issued
- **Denied:** Application denied (can appeal or refile)

---

## Step 7: Annual NMLS Renewal

Most state MTLs renew annually. The NMLS renewal window opens **November 1** and closes **December 31** each year (exact dates vary by state).

### Renewal Checklist (Annual)
- [ ] Update financial statements (most recent fiscal year)
- [ ] Update surety bond (renew if bond anniversary is before license renewal)
- [ ] Confirm no changes to control persons (if changes, update MU2 forms)
- [ ] Confirm no changes to business activities
- [ ] Confirm no new criminal, regulatory, or litigation disclosures
- [ ] Pay renewal fees through NMLS
- [ ] Attest to accuracy of all information

**Late Renewal Penalties:** Many states impose late fees or allow licenses to lapse if not renewed on time. Lapsed licenses may require a new application. Set calendar reminders for November 1 every year.

---

## NMLS Quick Reference

| Task | Where in NMLS |
|------|--------------|
| Create company account | Company Filing → Create New Account |
| Complete MU1 | Company Filing → Edit Company Form |
| Add MU2 (control person) | Company Filing → Add Control Person |
| Upload documents | Company Filing → Documents |
| Submit state application | Apply for License/Registration |
| Pay fees | Payments section |
| Check application status | License/Registration Status |
| Schedule fingerprinting | Individual Filing → Fingerprint |
| Renew licenses | Annual Renewal (opens Nov 1) |

---

*The NMLS Resource Center provides state-by-state checklists at https://mortgage.nationwidelicensingsystem.org. Always download the current checklist before filing — requirements change frequently.*

*Engage legal counsel with money transmission licensing experience for at least the Tier 1 state applications. The cost of legal guidance is far less than a denial or the cost of operating without a license.*
