# New York BitLicense Application Package
## NYDFS Virtual Currency Business Activity License

**Regulator:** New York Department of Financial Services (NYDFS)
**Regulation:** 23 NYCRR Part 200 (NY BitLicense)
**Application Portal:** https://myportal.dfs.ny.gov
**NYDFS Virtual Currency Contact:** vc@dfs.ny.gov
**Application Fee:** $5,000 (non-refundable) + investigation costs (typically $1,000–$10,000+)
**Timeline:** 12–24 months from complete application submission
**Status:** HIGHEST PRIORITY — do not serve NY customers for virtual currency activities without this license

---

## What Is the BitLicense?

The BitLicense, established by NYDFS under 23 NYCRR Part 200 (effective June 24, 2015), is a license required for any entity engaged in **Virtual Currency Business Activity** involving New York or New York residents.

**Virtual Currency Business Activity** is defined under 23 NYCRR 200.2(q) as any of the following conducted with New York or New York residents:
1. Receiving virtual currency for transmission or transmitting it
2. Storing, holding, or maintaining custody or control of virtual currency on behalf of others
3. Buying and selling virtual currency as a customer business
4. Performing exchange services as a customer business
5. Controlling, administering, or issuing a virtual currency

**Virtual Currency** under 23 NYCRR 200.2(p) means any type of digital unit used as a medium of exchange or a form of digitally stored value. This includes: BTC, ETH, LTC, XMR, USDC, USDT, and all other cryptocurrencies and stablecoins ForgePay handles.

---

## Why ForgePay Needs the BitLicense

ForgePay's activities requiring BitLicense:

| Activity | BitLicense Trigger |
|----------|--------------------|
| Processing USDC payments | Virtual currency transmission (23 NYCRR 200.2(q)(1)) |
| Processing USDT payments | Virtual currency transmission |
| Processing BTC payments | Virtual currency transmission |
| Processing ETH payments | Virtual currency transmission |
| Processing LTC payments | Virtual currency transmission |
| Processing XMR payments | Virtual currency transmission |
| x402 AI agent payments in crypto | Virtual currency transmission |
| Custodying customer crypto | Virtual currency custody (23 NYCRR 200.2(q)(2)) |

**Even if ForgePay only facilitates the transmission (does not hold the crypto itself), the transmission activity requires a BitLicense.**

---

## Pre-Application: NYDFS Pre-Application Meeting

NYDFS strongly encourages (and effectively requires for complex applicants) a pre-application meeting before filing. This is one of the most valuable steps.

### How to Request a Pre-Application Meeting

1. Send an email to vc@dfs.ny.gov with:
   - Subject line: "BitLicense Pre-Application Meeting Request — ForgePay"
   - Company name and description
   - Summary of virtual currency activities
   - List of virtual currencies to be supported
   - Estimated transaction volume
   - Key executives' names and titles
2. NYDFS will schedule a call/meeting (typically within 4–8 weeks)
3. Prepare a brief presentation covering:
   - Business model overview
   - Technology architecture
   - AML/cybersecurity program summary
   - Key compliance staff credentials
   - Capital and financial position

### What to Ask at the Pre-Application Meeting

- What are the most important areas of concern for a payment processor like ForgePay?
- How does NYDFS view x402 AI agent payments — is there guidance?
- What is NYDFS's current position on Monero (XMR) support?
- What is the typical investigation timeline given current application volume?
- Are there any interim operating agreements possible while application is pending?
- What capital level is NYDFS expecting for our transaction volume?

---

## Application Sections

The BitLicense application is submitted through the NYDFS MyPortal at https://myportal.dfs.ny.gov. The application consists of the following sections:

---

### Section 1: Applicant Information

- Full legal name of ForgePay entity
- DBA name(s)
- State of formation and date
- Federal Tax ID (EIN)
- Principal place of business address
- Registered agent in New York
- Website and contact information
- Description of virtual currency business activities
- List of all virtual currencies to be supported

---

### Section 2: Business Description and Plan

This is one of the most substantive sections. Prepare a comprehensive business plan including:

**Company Overview:**
- ForgePay's mission and business model
- Payment orchestration platform overview
- Target customers (merchants, AI agents)
- Revenue model (transaction fees, subscription tiers)

**Virtual Currency Operations:**
- How ForgePay processes virtual currency transactions (technical flow)
- Which currencies are supported and why
- How ForgePay handles custody (custodial vs. non-custodial)
- Settlement and reconciliation processes
- Integration with Hyperswitch payment router

**Technology Architecture:**
- High-level architecture diagram (AWS EKS, us-east-1)
- How the stablecoin-gateway and crypto-gateway services work
- Smart contract usage (if any)
- Hot vs. cold wallet strategy (if ForgePay custodies crypto)

**Financial Projections:**
- 3-year financial projections
- Assumptions underlying projections
- Expected New York transaction volume
- Stress-tested capital scenarios

---

### Section 3: Financial Statements

| Document | Requirement |
|----------|-------------|
| Audited balance sheet | Most recent |
| Audited income statement | Most recent fiscal year |
| Interim financial statements | If more than 90 days since last audit |
| 3-year financial projections | CPA-prepared |
| Capital adequacy analysis | Showing compliance with minimum $500,000 capital requirement |

**Minimum Capital Requirement:**
NYDFS requires BitLicense holders to maintain sufficient capital to ensure the financial integrity of the business. The regulatory guidance indicates a minimum of **$500,000** in net capital, with higher amounts required based on transaction volume and risk profile. For a platform of ForgePay's anticipated scale, NYDFS may require significantly more (potentially $2M–$10M+).

**Permissible Investments for NY:**
Funds received from NY customers for virtual currency purchases must be held in permissible investments until transmitted. NY-specific rules on permissible investments under the BitLicense framework must be reviewed with counsel.

---

### Section 4: AML/BSA Compliance Program

NYDFS will conduct a detailed review of ForgePay's AML program. Submit:

- [ ] Written BSA/AML Program (from `02_bsa_aml_program.md`) — NY-specific version
- [ ] NY-specific AML procedures addressing:
  - Virtual currency-specific red flags
  - Blockchain transaction monitoring
  - Stablecoin issuer verification
  - Enhanced due diligence for high-risk customers
- [ ] Transaction monitoring system description (AML engine, 8 rules)
- [ ] OFAC screening procedures (from `06_ofac_compliance_program.md`)
- [ ] SAR filing procedures (from `07_sar_ctr_procedures.md`)
- [ ] CTR procedures
- [ ] AML training program
- [ ] Independent AML audit plan

NYDFS may request to interview the CCO during the examination phase.

---

### Section 5: Cybersecurity Program

NYDFS requires a comprehensive cybersecurity program consistent with 23 NYCRR Part 500 (NY cybersecurity regulation). This is a separate but related requirement.

Submit:
- [ ] Written cybersecurity policy
- [ ] Risk assessment process
- [ ] Encryption standards (data at rest and in transit)
- [ ] Access controls and multi-factor authentication description
- [ ] Vulnerability management and penetration testing procedures
- [ ] Incident response plan
- [ ] Business continuity and disaster recovery plan
- [ ] Chief Information Security Officer (CISO) designation
- [ ] Vendor/third-party cybersecurity due diligence process

**AWS EKS Specifics:** Document ForgePay's AWS security controls:
- VPC isolation and security groups
- KMS encryption for all stored data
- IAM roles and least-privilege access
- CloudTrail audit logging
- GuardDuty threat detection
- AWS WAF on API endpoints

---

### Section 6: Key Persons

For each officer, director, principal stockholder (10%+), and any individual with control over ForgePay's virtual currency business, submit:

- [ ] Resume/CV (detailed — list all prior employment)
- [ ] Personal financial statement
- [ ] Background affidavit (disclosing any criminal, regulatory, or civil matters)
- [ ] Fingerprint authorization (NYDFS will arrange)
- [ ] Two professional references
- [ ] Passport or government-issued photo ID

NYDFS conducts its own independent background investigation. This is the step that most often causes delays — ensure all control persons cooperate fully and promptly.

---

### Section 7: Surety Bond

- Minimum surety bond: $500,000 (NYDFS may require more)
- Obligee: "Superintendent of Financial Services of the State of New York"
- Bond form: Use NYDFS-approved surety bond form (available from NYDFS)
- Bond must remain in force throughout the license period

---

### Section 8: Organizational Structure

- Corporate ownership chart (showing all entities and individuals through ultimate beneficial owners)
- Identification of all subsidiaries and affiliates
- Management structure chart

---

## BitLicense Ongoing Requirements

Once licensed, ForgePay must comply with ongoing BitLicense obligations:

### Financial Reporting
- Quarterly financial statements to NYDFS
- Annual audited financial statements
- Capital adequacy reports

### Change in Control
- Prior NYDFS approval required for any transaction resulting in a 10%+ change in ownership
- Prior approval required for mergers, acquisitions, or material changes to business model

### Cybersecurity Annual Certification
- Annual certification to NYDFS that cybersecurity program complies with 23 NYCRR Part 500

### AML Program Updates
- Notify NYDFS of material changes to AML program
- Annual AML audit required

### New Virtual Currency Approval
- Must notify NYDFS before listing any new virtual currency
- NYDFS approval may be required for currencies with enhanced privacy features (Monero consideration)

### Books and Records
- All records maintained for 7 years (NY Banking Law requirement — longer than federal 5-year rule)
- Records must be accessible to NYDFS within 5 business days

### Examination
- NYDFS conducts periodic examinations (typically every 1–3 years depending on risk)
- Full access to all books, records, and systems

---

## XMR (Monero) Special Consideration

Monero uses ring signatures, stealth addresses, and RingCT to provide privacy that makes blockchain analytics significantly harder. NYDFS and other regulators have expressed concern about privacy coins.

**ForgePay must:**
1. At the pre-application meeting, specifically ask NYDFS about Monero acceptance
2. Consult with legal counsel on whether XMR can be included in the initial BitLicense application or should be excluded initially and added later
3. If XMR is included, document:
   - Enhanced AML controls specific to XMR
   - Limitations of blockchain analytics for XMR and compensating controls
   - Business justification for supporting a privacy coin
4. Note that some states (e.g., Louisiana) have banned licensed entities from supporting privacy coins

**Recommendation:** Exclude XMR from the initial BitLicense application to avoid complicating approval. Add XMR via a license amendment after initial approval.

---

## Timeline and Project Plan

| Milestone | Estimated Timing |
|-----------|-----------------|
| Pre-application meeting request submitted | Month 1 |
| Pre-application meeting with NYDFS | Month 2–3 |
| Draft application materials | Month 1–4 |
| Audited financials obtained | Month 2–4 |
| Cybersecurity program documented | Month 2–4 |
| AML program finalized | Month 1–2 |
| Background investigations on key persons | Month 2–5 |
| Application submitted | Month 4–6 |
| NYDFS deficiency responses | Month 6–18 |
| NYDFS investigation and interviews | Month 12–20 |
| License approval (optimistic) | Month 18–24 |

**While application is pending:** Do NOT provide virtual currency services to New York residents unless a specific exemption or no-action relief is obtained from NYDFS.

---

## Fees Summary

| Fee | Amount |
|----|--------|
| Application fee | $5,000 (non-refundable) |
| Investigation costs | $1,000–$10,000+ (variable, billed by NYDFS) |
| Annual license fee | $5,000 |
| Legal fees (estimate) | $75,000–$200,000 |
| Surety bond premium (estimate) | $5,000–$25,000/year |
| Audited financial statements | $15,000–$50,000 |
| Cybersecurity assessment | $15,000–$40,000 |
| **Total estimated first-year cost** | **$120,000–$330,000+** |

---

## Useful Resources

- NYDFS BitLicense Application: https://myportal.dfs.ny.gov
- 23 NYCRR Part 200 (BitLicense regulation): https://www.dfs.ny.gov/legal/regulations/adoptions/dfsp200t.pdf
- NYDFS Virtual Currency Faqs: https://www.dfs.ny.gov/virtual_currency_businesses
- NYDFS Approved BitLicense Holders (reference for approved applications): https://www.dfs.ny.gov/apps_and_licensing/virtual_currency_businesses/approved_businesses

---

*The BitLicense process is one of the most complex financial service license applications in the US. ForgePay must retain legal counsel with specific NYDFS BitLicense experience. This package is for internal planning only.*
