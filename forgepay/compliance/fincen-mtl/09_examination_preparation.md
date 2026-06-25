# State and Federal Examination Preparation Guide
## MSB Regulatory Examination Readiness

**Applicable to:** FinCEN BSA examinations (conducted by IRS), State MTL examinations (by state regulators), NYDFS BitLicense examinations
**Program Owner:** Chief Compliance Officer

---

## Overview

As a registered MSB with state Money Transmitter Licenses, ForgePay is subject to periodic regulatory examinations. These examinations assess whether ForgePay is complying with BSA/AML obligations, state licensing requirements, and applicable consumer protection laws.

**Who examines ForgePay:**
- **IRS (on behalf of FinCEN):** Examines MSBs for federal BSA compliance (AML program, SAR/CTR filings, recordkeeping)
- **State regulators:** Examine for state MTL compliance (permissible investments, net worth, consumer protection, financial soundness)
- **NYDFS:** Conducts BitLicense examinations (comprehensive — AML, cybersecurity, financial condition, consumer protection)

**Exam frequency:** Typically every 2–5 years for BSA exams; every 1–3 years for state exams (NYDFS may examine more frequently for new or high-risk licensees).

---

## Typical Examination Scope

### Federal BSA Exam (IRS on behalf of FinCEN)

IRS examiners assess compliance with the Bank Secrecy Act. The exam scope typically includes:

| Exam Area | What Examiners Review |
|-----------|----------------------|
| AML Program | Written program; four-pillar review |
| Internal controls | Transaction monitoring; AML alert process |
| CCO/compliance officer | Qualifications; authority; day-to-day function |
| Training | Training materials; completion records; frequency |
| Independent audit | Audit scope; findings; remediation |
| SAR filing | Completeness; timeliness; narrative quality |
| CTR filing | Completeness; timeliness; aggregation practices |
| Recordkeeping | 5-year retention; format; accessibility |
| Customer due diligence | KYC practices; beneficial ownership collection |
| OFAC compliance | Screening; blocked transaction procedures |
| Travel Rule | Information collection and transmission |
| MSB registration | Current; accurate; reflects business activities |

### State MTL Exam

State exams assess both safety/soundness and compliance:

| Exam Area | What Examiners Review |
|-----------|----------------------|
| Financial statements | Capital adequacy; liquidity; profitability |
| Permissible investments | Are customer funds backed 1:1 by permissible investments? |
| Net worth | Meets minimum requirement |
| Surety bond | Current; correct amount; correct obligee |
| Licensing information | Accurate on file with state/NMLS |
| Consumer complaints | Log of complaints; resolution processes |
| Transaction records | Volume; types; compliance with state law |
| AML program | State-specific requirements; integration with federal |
| Agent oversight | Supervision of authorized agents (if applicable) |
| Books and records | Accessible; accurate; complete |

### NYDFS BitLicense Exam

NYDFS examinations are among the most comprehensive:

| Exam Area | What Examiners Review |
|-----------|----------------------|
| Financial condition | Capital; liquidity; profitability; balance sheet |
| Virtual currency custody | Segregation; cold storage; key management |
| Cybersecurity | 23 NYCRR Part 500 compliance; annual certification |
| AML/BSA program | In-depth; virtual currency specific |
| Consumer protection | Disclosure practices; complaint handling |
| Books and records | 7-year retention; accessibility |
| Key persons | Background investigations current |
| Changes in ownership | Reported and approved |
| New virtual currencies | Properly approved before listing |

---

## Document Readiness Checklist

Maintain these documents in a readily accessible format at all times:

### Corporate Documents
- [ ] Articles of Incorporation / Operating Agreement
- [ ] Current Certificate of Good Standing
- [ ] List of all officers, directors, and 10%+ shareholders
- [ ] Organizational chart (updated)
- [ ] Board meeting minutes (relevant to compliance)

### Licensing Documents
- [ ] FinCEN MSB Registration confirmation and current registration details
- [ ] All current state MTL certificates
- [ ] All NMLS filings and correspondence
- [ ] NYDFS BitLicense certificate (when obtained)
- [ ] All surety bonds (current; correct amounts)

### AML Program Documents
- [ ] Written BSA/AML Program (current version with revision history)
- [ ] OFAC compliance program
- [ ] SAR filing procedures
- [ ] CTR filing procedures
- [ ] AML risk assessment (current)
- [ ] Prior year AML risk assessments (5 years)
- [ ] Training materials and completion records (5 years)
- [ ] Independent audit reports (5 years)

### Transaction Records
- [ ] Transaction database (accessible by examiner upon request)
- [ ] 5-year archive of all transactions $3,000+
- [ ] SAR filing log (BSA E-Filing DCNs only — not the SARs themselves, which are produced only on court order)
- [ ] CTR filing log with DCNs
- [ ] OFAC screening logs

### Financial Documents
- [ ] Current audited financial statements
- [ ] Prior 5 years financial statements
- [ ] Permissible investment ledger (showing customer fund backing)
- [ ] Monthly financial reports filed with each state
- [ ] Net worth calculation (current)

### Customer Records
- [ ] KYC documentation for all active merchants and consumers (5 years; longer for NY)
- [ ] Beneficial ownership records (for business customers)
- [ ] Enhanced due diligence files (for high-risk customers)
- [ ] Customer complaint log

---

## Common Examination Findings and How to Avoid Them

Based on FinCEN enforcement actions and state exam patterns, the following are the most common deficiencies found in MSB examinations:

### Finding 1: AML Program Not Risk-Based

**The problem:** Generic, boilerplate AML programs that do not reflect the specific risks of the business.

**How to avoid:**
- Ensure the AML program specifically addresses ForgePay's products (crypto, stablecoins, x402 AI agent payments)
- Document the annual risk assessment process and how it drives program updates
- Show that AML rule thresholds in compliance-monitor are calibrated to actual risk data, not arbitrary numbers

### Finding 2: SAR Filing Delays or Missed Filings

**The problem:** SARs filed late, or suspicious activity identified but no SAR filed and no documented reason.

**How to avoid:**
- Track every AML alert from detection to disposition in the case management system
- Document the timeline from detection to SAR decision (must be within 30 days)
- When deciding NOT to file a SAR, document the reasoning as thoroughly as you would if filing
- Conduct quarterly self-reviews of SAR filing metrics (# alerts, # filed, average days to file)

### Finding 3: Inadequate SAR Narratives

**The problem:** SAR narratives that are vague, conclusory, or lack the specific details law enforcement needs.

**How to avoid:**
- Require the narrative to answer: who, what, when, where, why, how much
- Include transaction IDs, account numbers, wallet addresses
- For crypto: include blockchain transaction hashes
- Train compliance staff on narrative writing; use example SARs from FinCEN publications

### Finding 4: Customer Due Diligence Gaps

**The problem:** Incomplete KYC records; missing beneficial ownership information; no EDD for high-risk customers.

**How to avoid:**
- Implement mandatory fields in KYC system; cannot open account without complete data
- Enforce beneficial ownership collection at 25% threshold
- Trigger EDD automatically for high-risk customer categories
- Periodic refresh reviews (annually for medium-risk; more frequently for high-risk)

### Finding 5: Inadequate Transaction Monitoring

**The problem:** AML rules that are too broad (producing only noise) or too narrow (missing real risks); alerts not worked timely; poor documentation of alert disposition.

**How to avoid:**
- Tune ForgePay's 8 AML rules with actual transaction data quarterly
- Establish SLAs for alert review (e.g., all alerts worked within 5 business days)
- Document every alert: what triggered it, who reviewed it, what was found, what action was taken
- Escalation path for complex alerts clearly defined

### Finding 6: Employee Training Deficiencies

**The problem:** Training not completed by all required staff; training content outdated; no records.

**How to avoid:**
- Use an LMS that tracks completion automatically
- Make BSA training mandatory before system access for new hires
- Update training annually; refresh when regulations change significantly
- Keep training records for 5 years

### Finding 7: Independent Audit Deficiencies

**The problem:** Audit not conducted; audit conducted but not truly independent; findings not remediated.

**How to avoid:**
- Engage an external auditor for at least every other year audit (alternate with internal if resources are limited)
- Ensure internal auditor reports to Audit Committee/Board, not CCO
- Track all audit findings with remediation deadlines in the issue management system
- Do not close audit findings without evidence of remediation

### Finding 8: Recordkeeping Failures

**The problem:** Records not retained for 5 years; records not accessible; records in formats examiners cannot read.

**How to avoid:**
- Establish a formal data retention policy with enforcement (no deletion of covered records without CCO approval)
- Test record retrieval annually — can you produce all records for a specific customer within 2 business days?
- Archive format should be readable without specialized software

---

## Responding to an Examination Notice

When ForgePay receives an examination notice:

### Step 1: Notify Key Personnel (Day 1)

- CCO notifies CEO, CFO, and legal counsel
- Form an exam response team: CCO, Deputy CCO, outside counsel, senior compliance analyst

### Step 2: Understand the Exam Scope (Week 1)

- Review the examination notice carefully — what are they asking for?
- Contact the examiner's office to confirm:
  - The exam start date and format (on-site vs. remote)
  - The information request list (often attached or provided shortly after notice)
  - The examiner's name and contact information
  - Any preliminary questions

### Step 3: Prepare Document Production (Weeks 1–3)

- Assign a document coordinator to manage the production process
- Use the document readiness checklist above
- For any gaps: address them immediately and document what is being done
- Organize documents clearly: create a folder structure matching the examiner's request categories

### Step 4: Conduct Internal Pre-Exam Review

Before the exam starts, conduct a mock exam review:
- Pull a sample of recent AML alerts and review for completeness
- Pull recent SAR filings and review narratives for quality
- Review CTR filings for timeliness
- Verify OFAC screening logs are complete
- Confirm AML program version is current and approved

### Step 5: Examiner On-Site Preparation

- Designate an exam liaison (typically CCO or Deputy CCO)
- Provide examiners with a workspace if on-site
- Set up secure document sharing if remote
- Brief all staff likely to be interviewed:
  - Answer questions honestly and completely
  - Do not volunteer information beyond what is asked
  - Escalate to CCO if asked questions you are unsure about
  - Do not argue with examiners; note disagreements respectfully

---

## Responding to Examination Findings

### If ForgePay Receives a Deficiency Letter

1. **Read carefully:** Identify each finding and what the examiner believes ForgePay did wrong
2. **Assess accuracy:** Discuss with legal counsel — is the finding accurate? Is there a regulatory basis being misapplied?
3. **Respond in writing:**
   - Acknowledge each finding
   - For each finding: describe the remediation action and timeline
   - For any finding you disagree with: respectfully note the disagreement and provide your legal/factual basis
4. **Implement remediation:** Do not just write a response — actually fix the deficiency
5. **Follow up:** If the examiner requests a follow-up, respond promptly

### Escalation Risk

Examination findings that are not resolved may result in:
- Formal supervisory action (cease and desist order)
- Civil money penalties
- License suspension or revocation
- Criminal referral (for willful violations)
- Public enforcement order (reputational damage)

Engage legal counsel immediately if findings are material.

---

## NMLS Exam Scheduling (State License Examinations)

Most state MTL examinations are scheduled through NMLS. When an examination is scheduled:

1. You will receive an exam notice through NMLS (check NMLS mailbox weekly)
2. Log into NMLS to access the Document Upload function for the exam
3. Upload all requested documents through NMLS's secure document upload portal
4. Respond to examiner communications through NMLS or directly (as directed by the examiner)
5. After the exam, access the examination report through NMLS

---

## Building an Examination-Ready Culture

The best exam preparation is ongoing compliance — not a last-minute scramble. Build these habits:

- **Monthly compliance meeting:** CCO reviews open issues, metrics, and upcoming deadlines with the compliance team
- **Quarterly self-assessment:** Score ForgePay's AML program against FinCEN exam procedures
- **Annual mock exam:** Hire an external compliance consultant to conduct a mock examination
- **Always-on document organization:** Documents should be ready to produce within 48 hours at any time
- **Continuous training:** Do not wait for annual training — share regulatory updates as they occur

---

*Regulatory examinations are an expected part of operating as a licensed MSB. A well-prepared compliance program transforms an examination from a crisis into a routine event.*
