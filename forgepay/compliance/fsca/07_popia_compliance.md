# ForgePay — POPIA (Protection of Personal Information Act) Compliance Documentation

**Document Classification:** Confidential — Regulatory Submission
**Version:** 1.0
**Date:** 2026-06-25
**Prepared By:** Data Protection Officer (DPO)
**Reviewed By:** Chief Technology Officer, Chief Compliance Officer
**Approved By:** Board of Directors

---

## 1. Introduction

### 1.1 Purpose

This document demonstrates ForgePay (Pty) Ltd's compliance with the Protection of Personal Information Act 4 of 2013 (POPIA), which came fully into force on 1 July 2021. POPIA is the primary data protection legislation of the Republic of South Africa and imposes obligations on responsible parties (data controllers) and operators (data processors) regarding the processing of personal information of South African data subjects.

ForgePay processes personal information of:
- Merchant owners and directors (business onboarding / KYB process)
- Individual consumers making payments through merchant checkout flows
- ForgePay employees and contractors
- Job applicants

### 1.2 Applicable Legislation and Guidance

- Protection of Personal Information Act 4 of 2013 (POPIA)
- Regulations relating to the Protection of Personal Information (Government Gazette No. 44557, 22 June 2021)
- Information Regulator (South Africa) Guidance Notes
- FSCA guidance on data protection in financial services
- Payment Card Industry Data Security Standard (PCI DSS) — intersects with personal data protection

### 1.3 Information Regulator

The Information Regulator is the supervisory authority for POPIA in South Africa.

| Contact | Detail |
|---|---|
| Information Regulator (South Africa) | inforeg@justice.gov.za |
| Physical Address | JD House, 27 Stiemens Street, Braamfontein, Johannesburg, 2001 |
| Website | www.inforegulator.org.za |
| Complaints | POPIAComplaints@inforegulator.org.za |
| Breach Notification | PAIAComplaints@inforegulator.org.za (also inforeg@justice.gov.za) |

---

## 2. Data Protection Officer (DPO)

### 2.1 DPO Appointment

ForgePay has appointed a Data Protection Officer (DPO) responsible for ensuring POPIA compliance. The DPO is appointed by the Board of Directors and has direct reporting access to the CEO and Board Chairperson.

| Field | Detail |
|---|---|
| DPO Name | [Name] |
| Title | Data Protection Officer |
| Email | dpo@forgepay.co.za |
| Phone | [Number] |
| Appointment Date | [Date] |
| Appointment Authority | Board resolution ([Date]) |

**Note:** POPIA does not require a mandatory DPO for all responsible parties (unlike GDPR which has a mandatory DPO for certain organisations). ForgePay has appointed a DPO voluntarily given the volume and sensitivity of personal data processed and the requirement for an Information Officer under POPIA Section 55.

### 2.2 DPO and Information Officer

Under POPIA, every responsible party must have an Information Officer registered with the Information Regulator. ForgePay's Information Officer is:

| Field | Detail |
|---|---|
| Information Officer Name | [Name — typically CEO or designated senior officer] |
| Information Regulator Registration | [Registration number — register at www.inforegulator.org.za] |
| Email | information.officer@forgepay.co.za |
| Appointment Authority | Board resolution |

**Registration:** ForgePay's Information Officer must be registered with the Information Regulator before the organisation commences processing personal information. Registration is done via the Information Regulator's online portal.

### 2.3 DPO Responsibilities

- Monitoring POPIA compliance across all ForgePay systems and processes
- Advising on privacy impact assessments (PIAs) for new products and processing activities
- Responding to data subject requests (access, correction, deletion, objection)
- Managing the personal data breach notification process
- Maintaining the Record of Processing Activities (ROPA)
- Liaising with the Information Regulator
- Reporting to the Board quarterly on POPIA compliance status
- Conducting annual POPIA compliance reviews
- Training staff on POPIA obligations

---

## 3. Data Mapping and Record of Processing Activities (ROPA)

### 3.1 Data Mapping Methodology

ForgePay has conducted a data mapping exercise to identify all personal information processing activities. The mapping covers:
- What personal information is collected
- From whom it is collected (data subjects)
- Why it is collected (purpose / lawful basis)
- How it is used and who has access
- Where it is stored (system / location)
- How long it is retained
- Whether it is shared with third parties

### 3.2 ROPA — Summary Table

#### Category 1: Merchant Onboarding (Know Your Business — KYB)

| Field | Detail |
|---|---|
| Data subjects | Merchant owners, directors, beneficial owners (natural persons) |
| Personal information categories | Full name; ID number; date of birth; residential address; email; mobile number; ID document image; photo |
| Special information (POPIA s.26) | None |
| Collection method | Web form (merchant onboarding flow in mor-layer service); document upload |
| Lawful basis | Section 11(1)(c): Necessary for performance of contract (merchant agreement); Section 11(1)(a): Consent; Section 11(1)(e): Legal obligation (FIC Act CDD requirements) |
| Primary purpose | KYB identity verification; AML/CFT CDD; FSCA license compliance |
| Systems | mor-layer (Python FastAPI); S3 document store (af-south-1); PostgreSQL |
| Third-party sharing | KYC/eKYC verification vendor; blockchain analytics (wallet addresses only) |
| Retention period | 5 years from end of business relationship (FIC Act requirement) |
| Data residency | AWS af-south-1 (South Africa) |

#### Category 2: Consumer Payment Transactions

| Field | Detail |
|---|---|
| Data subjects | Consumers making payments at merchant checkout |
| Personal information categories | Name; email address; payment reference; IP address; browser/device fingerprint; billing address (if provided); masked card number (last 4 digits only — no full PAN stored) |
| Special information | None (note: card data tokenised; no PAN stored by ForgePay) |
| Collection method | Merchant checkout integration; Hyperswitch JavaScript SDK |
| Lawful basis | Section 11(1)(c): Necessary for performance of payment contract; Section 11(1)(e): Legal obligation (NPS Act; FIC Act) |
| Primary purpose | Payment processing; fraud prevention; AML monitoring; dispute resolution |
| Systems | Hyperswitch router (crates/router); unified-router; PostgreSQL audit tables |
| Third-party sharing | Card acquirer (tokenised); card scheme (tokenised); fraud scoring service |
| Retention period | 5 years from transaction date (FIC Act; FSCA requirements) |
| Data residency | AWS af-south-1 |

#### Category 3: Employee and Contractor Data

| Field | Detail |
|---|---|
| Data subjects | ForgePay employees, directors, contractors |
| Personal information categories | Full name; ID number; address; tax number; bank account; CV; qualifications; salary; performance records; disciplinary records |
| Special information | Health information (leave records); race (EEA compliance) |
| Collection method | Employment application; onboarding forms; HR system |
| Lawful basis | Section 11(1)(c): Employment contract; Section 11(1)(e): Legal obligation (SARS, Dept. of Labour, FSCA fit and proper) |
| Primary purpose | Employment management; payroll; regulatory reporting; FSCA fit and proper compliance |
| Systems | HR system ([Vendor]); payroll system ([Vendor]); PostgreSQL |
| Third-party sharing | SARS (payroll submissions); FSCA (fit and proper declarations); IRBA auditors |
| Retention period | Duration of employment + 5 years |
| Data residency | [HR system — confirm data residency; must be SA or POPIA-compliant] |

#### Category 4: Website and Marketing Analytics

| Field | Detail |
|---|---|
| Data subjects | Website visitors (forgepay.co.za); marketing leads |
| Personal information categories | IP address; browser type; pages visited; form submissions (name, email, company); cookie identifiers |
| Special information | None |
| Collection method | Web analytics (Next.js 14 marketing site); contact forms; email marketing |
| Lawful basis | Section 11(1)(a): Consent (cookie banner); Section 11(1)(f): Legitimate interest (security, fraud prevention) |
| Primary purpose | Website analytics; lead generation; marketing |
| Systems | Marketing site (forgepay/apps/web); analytics tool ([Vendor — ensure SA or adequate jurisdiction]) |
| Third-party sharing | Analytics vendor; email marketing platform |
| Retention period | 3 years (marketing); 90 days (raw logs) |
| Data residency | [Confirm — analytics vendor must be POPIA-compliant] |

#### Category 5: Compliance and AML Records

| Field | Detail |
|---|---|
| Data subjects | Customers flagged for AML review; SAR subjects |
| Personal information categories | All CDD information; transaction patterns; alert dispositions; SAR content |
| Special information | Potentially criminal behaviour records (POPIA s.26) |
| Collection method | AML monitoring system; compliance dashboard |
| Lawful basis | Section 11(1)(e): Legal obligation (FIC Act); Section 11(1)(c): Legitimate interest (compliance) |
| Primary purpose | AML/CFT compliance; FIC reporting; regulatory obligations |
| Systems | Compliance dashboard; PostgreSQL audit tables |
| Third-party sharing | FIC (SAR/STR reporting); FSCA (regulatory reporting); Law enforcement (if lawfully required) |
| Retention period | 5 years from filing/creation (FIC Act) |
| Data residency | AWS af-south-1 |

---

## 4. Privacy Policy (Template)

_The following is a template privacy policy for ForgePay's merchant-facing and consumer-facing communications. Legal counsel must review and finalise before publication._

---

### ForgePay Privacy Policy

**Effective Date:** [Date]
**Last Updated:** [Date]

#### Who We Are

ForgePay (Pty) Ltd ("ForgePay", "we", "our", "us") is a Payment Service Provider registered and operating in the Republic of South Africa. We are a Responsible Party in terms of the Protection of Personal Information Act 4 of 2013 (POPIA).

Our Information Officer can be contacted at: information.officer@forgepay.co.za

#### What Personal Information We Collect

We collect personal information necessary to provide payment services, including:
- **Identity information:** Name, ID number, date of birth
- **Contact information:** Email address, phone number, mailing address
- **Financial information:** Bank account details, payment card metadata (last 4 digits and card type — no full card numbers), transaction history
- **Business information:** Company registration, directorship and ownership details
- **Technical information:** IP address, device identifiers, browser type, usage data

We do not collect special personal information (e.g., biometric data, health data, political opinions, religious beliefs) except where required by law and only with your explicit consent.

#### Why We Collect Your Information (Purposes)

We process your personal information for the following purposes:
1. To verify your identity and onboard you as a merchant or process your payment (contractual necessity)
2. To comply with our legal obligations under the FIC Act (Anti-Money Laundering / Know Your Customer)
3. To detect and prevent fraud and financial crime
4. To process and settle payments
5. To resolve disputes and chargebacks
6. To communicate with you about your account and our services
7. To improve our services through aggregated, anonymised analytics

We will only use your personal information for the purposes stated above. If we wish to use it for a new purpose, we will obtain your consent or rely on another lawful basis and inform you.

#### Who We Share Your Information With

We share your personal information only as necessary:
- **Payment network partners** (card acquirers, Visa, Mastercard, Circle): to process your payment
- **Identity verification vendors**: to verify your identity at onboarding (required by law)
- **Financial Intelligence Centre (FIC)**: where we are legally required to report suspicious transactions
- **FSCA and Prudential Authority**: for regulatory compliance and reporting
- **Our technology providers** (AWS): who process data on our behalf under Data Processing Agreements
- **Law enforcement**: where required by a valid court order or legal process

We do not sell your personal information to third parties.

#### Cross-Border Transfers

Your personal information is primarily processed and stored in South Africa (AWS Cape Town region). Where we transfer data outside South Africa, we ensure appropriate safeguards are in place in terms of POPIA Section 72, including:
- The recipient country provides an adequate level of protection; or
- We have entered into a binding agreement with the recipient providing equivalent protection to POPIA; or
- You have consented to the transfer

#### Your Rights

As a data subject under POPIA, you have the right to:
- **Access** your personal information held by us
- **Correct** inaccurate or incomplete information
- **Request deletion** of your information (subject to our legal retention obligations)
- **Object** to the processing of your information
- **Lodge a complaint** with the Information Regulator if you believe we have violated your rights

To exercise any of these rights, contact our Information Officer at: information.officer@forgepay.co.za. We will respond within 30 days (or within such extended period as permitted by POPIA).

#### Retention

We retain personal information for as long as necessary to fulfil the stated purposes and to comply with legal obligations. Minimum retention periods are:
- Transaction and KYC records: 5 years from end of relationship (FIC Act requirement)
- Marketing contact records: 3 years from last interaction
- Employee records: Duration of employment + 5 years

#### Security

We implement technical and organisational security measures to protect your personal information, including encryption (AES-256), TLS 1.2+ for data in transit, access controls (RBAC, MFA), and regular security testing. See our Systems and Controls document for full details.

#### Automated Decision-Making

ForgePay uses automated fraud scoring and AML transaction monitoring. These systems may affect your transaction. Where a decision has a significant effect on you, you may request human review by contacting us.

#### Contact Us

Data Protection Officer / Information Officer
ForgePay (Pty) Ltd
Email: dpo@forgepay.co.za / information.officer@forgepay.co.za

---

## 5. Data Processing Records

### 5.1 Processing Activity Register Maintenance

The DPO maintains the full Record of Processing Activities (ROPA) in ForgePay's compliance document management system. The ROPA is updated:
- When a new processing activity commences
- When an existing activity changes materially
- At minimum, annually during the POPIA compliance review

### 5.2 Data Processing Agreements (DPAs)

ForgePay enters into POPIA-compliant Data Processing Agreements with all operators (third parties processing personal data on ForgePay's behalf):

| Operator | Data Processed | DPA Status |
|---|---|---|
| AWS (af-south-1) | All personal data (encrypted storage) | AWS DPA (POPIA addendum) |
| KYC/eKYC vendor | Identity documents; biometric (liveness) | DPA required before go-live |
| HR system vendor | Employee personal data | DPA required |
| Email marketing platform | Marketing contact data | DPA required |
| Analytics vendor | Website visitor data (IP, cookies) | DPA required |

### 5.3 Privacy Impact Assessments (PIAs)

ForgePay conducts Privacy Impact Assessments (PIAs) for:
- New products or services involving new categories of personal information
- Significant changes to existing processing activities
- New third-party vendors receiving personal information
- Implementation of new technology systems

PIAs are documented and retained by the DPO. High-risk PIAs are reported to the Board.

The following PIAs are required before launch:
- [ ] Consumer checkout flow (Hyperswitch tokenization path)
- [ ] Merchant onboarding (eKYC vendor integration)
- [ ] x402 AI agent payments (automated processing; novel)
- [ ] XMR/Monero merchant onboarding (enhanced data collection)
- [ ] Blockchain analytics integration (wallet address profiling)

---

## 6. Data Breach Notification Procedure

### 6.1 The 72-Hour Rule (POPIA Section 22)

If ForgePay becomes aware of a breach of personal information that poses a risk to data subjects, it must:
1. Notify the **Information Regulator** within **72 hours** of becoming aware of the breach
2. Notify **affected data subjects** without unreasonable delay (where the breach poses a high risk to their rights and freedoms)
3. Notify **FSCA** and **acquirer / card schemes** (for card data breaches) within their required timeframes

### 6.2 Breach Detection and Escalation

**Detection channels:**
- AWS GuardDuty and Security Hub alerts → Security Engineer → CTO
- Hyperswitch/router anomaly alerts → On-call engineer → CTO
- Staff report via compliance hotline → DPO
- External report (customer, researcher, threat intelligence) → DPO

**Escalation:**

```
Potential breach detected
        |
Security Engineer / staff member notifies DPO + CTO immediately (within 1 hour)
        |
DPO and CTO assess: Is personal information involved? What scale?
        |
[Personal information breach confirmed?]
    /               \
  Yes                No
   |                  |
DPO begins 72-hour     Document; close
notification clock     assessment; retain
   |                   record
DPO prepares notification to Information Regulator (within 72 hours)
   |
DPO assesses risk to data subjects (high / low)
   |
[High risk to data subjects?]
    /               \
  Yes                No
   |                  |
Notify data subjects   Notification to
without unreasonable   Regulator only
delay
   |
Notify FSCA, card schemes, acquirer as applicable
   |
Document all notifications; update incident record
   |
Post-incident review within 5 business days
```

### 6.3 Notification Content to Information Regulator

The notification to the Information Regulator must include (per POPIA Section 22 and Regulations):
- Description of the breach (what happened, how it was discovered)
- Categories and approximate number of data subjects affected
- Categories and approximate number of personal information records affected
- Contact details of the DPO / Information Officer
- Description of likely consequences of the breach
- Description of measures taken or proposed to address the breach

### 6.4 Notification to Data Subjects

Notification to affected data subjects must include:
- Description of the breach in plain language
- What personal information was involved
- Steps the data subject should take to protect themselves
- Steps ForgePay is taking to remedy the breach
- Contact details for questions and complaints
- Reference to the data subject's right to complain to the Information Regulator

### 6.5 Breach Register

All personal data breaches (regardless of whether notification is required) are recorded in the DPO's breach register, including:
- Date and time of breach / discovery
- Nature of the breach
- Categories and volume of data affected
- Remediation steps
- Notification actions taken
- Outcome and lessons learned

Retention of breach records: 5 years.

---

## 7. Data Retention Schedule

| Data Category | Retention Period | Basis | Deletion Method |
|---|---|---|---|
| Merchant KYC/KYB records | 5 years from end of relationship | FIC Act s.22 | Secure deletion from S3; DB record anonymisation |
| Consumer transaction records | 5 years from transaction date | FIC Act s.22; FSCA | Secure deletion; DB record anonymisation |
| AML alert records | 5 years from alert date | FIC Act | Secure deletion |
| SAR / STR records | 5 years from filing | FIC Act | Restricted archive; secure deletion after period |
| Employee records | Employment + 5 years | Basic Conditions of Employment Act; POPIA | Secure deletion from HR system |
| Audit logs (compliance) | 7 years (CloudTrail); 5 years (PostgreSQL) | FSCA; Companies Act | Object Lock expiry; DB purge |
| Marketing contacts | 3 years from last interaction | Legitimate interest; consent | Email system deletion + DB purge |
| Website logs / analytics | 90 days (raw) | Legitimate interest (security) | Automated log rotation |
| Job applicant records | 1 year from application date (if not hired) | POPIA; legitimate interest | Secure deletion |
| Breach records | 5 years from incident | POPIA; FSCA | Secure deletion |

### 7.1 Deletion Procedures

**Secure deletion process:**
- S3 documents: S3 Object Expiration rule deletes objects automatically at end of retention period; S3 versioning ensures no recoverable copies
- PostgreSQL records: Logical anonymisation (PII fields set to `NULL` or replaced with pseudonymous identifiers) at end of retention period; records with regulatory requirement to retain are archived in restricted-access schema
- Backups: Encrypted backups expire at configured lifecycle policy; backup encryption keys rotated after backup expiry making data unrecoverable
- KYC document images: S3 Object Lock (Governance mode) prevents deletion until retention period expires; automatically purged via lifecycle rule

---

## 8. Cross-Border Transfer Restrictions

### 8.1 POPIA Section 72

ForgePay may only transfer personal information to a foreign country or international organisation if:
(a) The recipient is subject to a law, binding corporate rules, or binding agreement providing an adequate level of protection equivalent to POPIA; or
(b) The data subject consents to the transfer; or
(c) The transfer is necessary for the performance of a contract; or
(d) The transfer is for the benefit of the data subject and it is not practicable to obtain consent.

### 8.2 Transfer Assessment

| Destination | Data Transferred | Basis | Safeguard |
|---|---|---|---|
| AWS eu-west-1 (Ireland) | Encrypted compliance archive backups | Adequate protection (EU GDPR); ForgePay-AWS DPA | Encryption (keys in af-south-1 only); GDPR adequacy |
| KYC vendor (location TBC) | ID images; biometric data | DPA; confirm jurisdiction adequacy | DPA with POPIA-equivalent clauses; PIA required |
| Card schemes (US-headquartered) | Transaction metadata (no PAN; tokenised) | Necessary for contract performance | Scheme rules; standard contractual clauses where applicable |
| Circle (USDC — US) | Wallet addresses; transaction references | Necessary for contract; no personal data (pseudonymous) | Pseudonymous; no DPA required for wallet addresses |
| Blockchain analytics vendor | Wallet addresses | Pseudonymous; no personal data | Not personal data (no re-identification risk assessed) |

**Key principle:** No plain-text PAN, ID document, or biometric data is transferred outside South Africa. Backup archives transferred to eu-west-1 are encrypted and cannot be processed without keys held in af-south-1.

---

## 9. Data Subject Rights Procedure

### 9.1 Rights Under POPIA

| Right | Section | ForgePay Process | Response Time |
|---|---|---|---|
| Right to access personal information (PAIA) | POPIA s.23; PAIA | Submit request to Information Officer; identity verification required | 30 days |
| Right to correct or delete | POPIA s.24 | Submit to DPO; assessment of legal retention obligations | 30 days |
| Right to object to processing | POPIA s.11(3) | Submit to DPO; assessment of lawful basis; override where legal obligation exists | 30 days |
| Right not to be subject to automated decision | POPIA s.71 | Submit to DPO; human review within 30 days | 30 days |
| Right to complain to Information Regulator | POPIA s.74 | Inform data subject of right; provide Regulator contact | N/A |

### 9.2 Request Handling Process

1. Data subject submits request to dpo@forgepay.co.za or information.officer@forgepay.co.za
2. DPO verifies identity of requestor (to prevent fraudulent access requests)
3. DPO assesses request against POPIA and any competing legal obligations (e.g., FIC Act retention requirements override deletion requests)
4. DPO responds within 30 days; may extend to 60 days with written notice and reason
5. If request is denied (e.g., retention obligation), DPO provides written reasons and informs data subject of right to complain to Information Regulator
6. All requests and responses are logged in the DPO's data subject request register

---

## 10. POPIA Compliance Assessment

### 10.1 Eight Conditions for Lawful Processing (POPIA Chapter 3)

| Condition | Requirement | ForgePay Status |
|---|---|---|
| 1. Accountability | Responsible party implements POPIA measures | DPO appointed; ROPA maintained |
| 2. Processing limitation | Collect for specific purpose; minimise | Purpose-limited collection; no excessive data |
| 3. Purpose specification | Specify purpose before collection | Privacy Policy and onboarding forms state purpose |
| 4. Further processing limitation | Only use for collected purpose | Data use policy enforced; staff training |
| 5. Information quality | Accurate and up-to-date | Customer self-service update; eKYC re-verification |
| 6. Openness | Maintain documentation; notify data subjects | Privacy policy; ROPA; this document |
| 7. Security safeguards | Technical and organisational measures | AES-256; TLS; RBAC; MFA; see `05_systems_and_controls.md` |
| 8. Data subject participation | Enable access, correction, deletion, objection | Data subject rights procedure above |

### 10.2 Annual POPIA Review

The DPO conducts an annual POPIA compliance review covering:
- ROPA review and update
- Privacy Policy review
- PIA review and any required new PIAs
- Breach register review
- Training completion rates
- Data subject request log review
- Third-party DPA review and renewal
- Assessment of any POPIA regulatory developments or Information Regulator guidance

Results are reported to the Board of Directors and retained as evidence of ongoing compliance.

---

## Sign-Off

| Role | Name | Signature | Date |
|---|---|---|---|
| Data Protection Officer | | | |
| Chief Technology Officer | | | |
| Chief Compliance Officer | | | |
| Chief Executive Officer | | | |
| Board Chairperson | | | |
