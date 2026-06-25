# QSA Engagement Guide — ForgePay

## Overview

This guide explains how to select a Qualified Security Assessor (QSA), issue an RFP, conduct the engagement, and obtain the Attestation of Compliance (AOC) at the end of a successful Level 1 ROC assessment. It is designed for ForgePay's CISO and Head of Compliance.

---

## 1. What Is a QSA?

A Qualified Security Assessor (QSA) is an independent company certified by the PCI Security Standards Council (PCI SSC) to assess compliance with the PCI Data Security Standard and issue Reports on Compliance (ROC) and Attestations of Compliance (AOC).

**Key facts:**
- The PCI SSC certifies QSA companies, not individuals. Individual assessors working at a QSA company are QSA employees.
- The QSA's ROC and AOC are the formal outputs accepted by Visa and Mastercard for Level 1 compliance
- QSAs are not employed by the card brands; they are independent third parties
- The QSA owes a professional duty to accurately assess compliance — they cannot certify a non-compliant entity
- The assessed entity (ForgePay) pays the QSA, but the QSA's obligation is to PCI DSS accuracy

**Find approved QSA companies:** https://www.pcisecuritystandards.org/assessors_and_solutions/qualified_security_assessors/

---

## 2. QSA Selection Criteria

Not all QSA firms are created equal. Evaluate firms on these dimensions:

### 2.1 Technical Expertise

| Criterion | Why It Matters |
|-----------|---------------|
| Cloud (AWS) experience | ForgePay is entirely AWS-based; a QSA unfamiliar with EKS, IRSA, and AWS Secrets Manager will struggle |
| Kubernetes / container expertise | CDE runs on EKS; Kubernetes RBAC and NetworkPolicy are primary security controls |
| Payment facilitator experience | PayFac engagements have nuances (sub-merchant scoping, card brand requirements) |
| Rust/TypeScript/Python familiarity | Helpful for code review sampling during SDLC assessment |
| Startup/fintech experience | Large QSA firms sometimes apply enterprise-oriented practices that don't fit startups |

### 2.2 PCI SSC Standing

- QSA company must be on the PCI SSC's current approved list
- Ask for their PCI SSC Company ID (verifiable on the PCI SSC website)
- Confirm the specific assessor assigned to ForgePay is a qualified QSA employee of the company

### 2.3 Independence and Objectivity

- The QSA must not have a consulting conflict of interest (cannot be the firm that built your security controls and then assesses them — some firms wall off consulting and assessment practices)
- No prior relationship with ForgePay that could compromise objectivity

### 2.4 Process and Communication

| Dimension | What to Evaluate |
|-----------|-----------------|
| Project management | Dedicated project manager? Structured document request process? |
| Communication style | Do they explain findings clearly? Will they work with your team to understand context? |
| Dispute resolution | How do they handle situations where ForgePay believes a finding is a false positive? |
| Remediation guidance | Do they provide actionable guidance, or just cite requirements? |
| Report quality | Ask for a sample ROC (redacted) to evaluate writing quality and depth |

### 2.5 Commercial Considerations

| Factor | Notes |
|--------|-------|
| Fixed price vs. T&M | Fixed price preferred; T&M can balloon if engagement is slow |
| Scope of work clarity | Ensure scope is clearly defined; ambiguity leads to additional charges |
| Re-assessment pricing | What happens if ForgePay needs to remediate and re-assess? Is there a fee? |
| Travel costs | For on-site visits; consider virtual-first QSAs to reduce cost |
| Contract flexibility | Milestone-based payment preferred; avoid paying in full upfront |

---

## 3. RFP Template

Adapt this template to issue an RFP to 3+ QSA firms:

```
REQUEST FOR PROPOSAL — PCI DSS LEVEL 1 ROC ASSESSMENT
ForgePay Financial Technologies
Date: [DATE]
Issued by: [CISO NAME]
Response deadline: [DATE + 3 WEEKS]

1. ABOUT FORGEPAY

ForgePay is a payment orchestration platform and payment facilitator, processing
card-not-present transactions on behalf of merchants. Our platform is built on
AWS EKS (Kubernetes), with core payment processing handled by Hyperswitch
(open-source payment engine). Cardholder data is tokenized by the Hyperswitch
PCI vault; other platform services handle only payment tokens.

Annual transaction volume target: [X] million

2. ASSESSMENT SCOPE

- In-scope CDE components: Hyperswitch payment-engine (EKS), Hyperswitch PCI vault
  (EKS), payment-engine PostgreSQL (RDS), AWS ALB, AWS IAM, AWS Secrets Manager,
  Kubernetes control plane (CDE namespaces)
- Out-of-scope: all other ForgePay microservices (segmented via Kubernetes
  NetworkPolicy; no CHD access)
- Estimated total in-scope system components: ~10–15

3. REQUIRED SERVICES

a) Full PCI DSS v4.0 ROC assessment
b) Attestation of Compliance (AOC) — both merchant and service provider AOC
c) Onsite or virtual assessment visits (indicate your approach)
d) Up to 2 re-assessments for remediation of open findings

4. PROPOSAL REQUIREMENTS

Please include in your response:
a) Company PCI SSC QSA ID and current approval status
b) Named lead assessor(s) and their qualifications (certifications, experience)
c) Experience with AWS/EKS/Kubernetes PCI assessments (references available?)
d) Experience with payment facilitators or fintech startups
e) Proposed engagement timeline (kickoff to final ROC)
f) Proposed project management and communication approach
g) Sample ROC (redacted) from a comparable engagement
h) Document request list (preliminary)
i) Fixed-price quote broken down by phase
j) Your approach to virtual vs. onsite assessment
k) Certificate of professional liability insurance ($[X]M minimum)

5. EVALUATION CRITERIA

Proposals evaluated on: technical expertise (40%), process and communication (30%),
price (20%), references (10%).

6. QUESTIONS

Submit questions to: compliance@forgepay.com by [DATE].

7. CONFIDENTIALITY

This RFP and all information provided about ForgePay is confidential. Do not
share with third parties. Return or destroy all ForgePay materials if not selected.

8. SUBMIT TO

compliance@forgepay.com, subject line: "QSA RFP Response — [FIRM NAME]"
```

---

## 4. Questions to Ask QSA Candidates

During the proposal review and finalist calls, ask:

### About Experience
1. "How many PCI DSS Level 1 ROC assessments have you completed for companies on AWS EKS?"
2. "Can you provide a reference from a payment facilitator or fintech you've assessed?"
3. "Has your team assessed Kubernetes NetworkPolicy as a segmentation control? What's your approach?"
4. "Have you assessed Hyperswitch or similar open-source payment engines before?"

### About Process
5. "Walk me through your typical document request process. How do you share documents securely?"
6. "What is your approach if we disagree with a finding? How are disputes resolved?"
7. "How do you handle findings discovered during the assessment that require remediation before the ROC can be issued?"
8. "Will the same assessor(s) be on our account from kickoff to final ROC?"

### About Timeline
9. "What is the typical timeline from kickoff to final ROC for a comparable engagement?"
10. "What are the top 3 reasons assessments take longer than planned? How do you mitigate them?"

### About Commercial Terms
11. "Is your quote fixed price? What triggers additional billing?"
12. "If we need to remediate a finding and you need to re-assess, is that included in the price?"
13. "What is your policy if we are not satisfied with the assessment?"

---

## 5. What a Level 1 ROC Engagement Looks Like

A Level 1 ROC engagement typically proceeds in five phases:

### Phase 1: Kickoff and Scoping (Weeks 1–4)

**Activities:**
- Kickoff meeting: introductions, roles, timelines, communication cadence
- Scope finalization: QSA reviews ForgePay's scope definition document (`01_scope_definition.md`); confirms or challenges scope
- Network segmentation review (preliminary): QSA reviews network diagrams and data flow diagrams
- Document request list issued: QSA issues a list of every document, policy, and record they need
- Assessment methodology agreed: what systems will be sampled? How many?

**ForgePay's preparation:**
- Have the scope definition document ready
- Have the evidence folder structure populated (see `07_evidence_collection_checklist.md`)
- Designate a primary compliance contact for the QSA

**Common scope disputes:**
- QSA may argue that systems ForgePay considers out-of-scope are actually in-scope (e.g., CI/CD pipeline, OTEL collector)
- QSA may want to test that NetworkPolicy is correctly enforced (this is expected — plan for it)
- If the QSA finds systems not included in ForgePay's scope definition, the scope must be updated

### Phase 2: Document Review (Weeks 4–10)

**Activities:**
- QSA reviews all submitted policies, procedures, configs, and records
- QSA issues questions and requests for additional evidence
- Remote interviews with key personnel (CISO, Engineering Lead, DevSecOps)
- QSA may request specific output from ForgePay's systems (logs, screenshots, config exports)

**ForgePay's preparation:**
- Submit all documents via the QSA's secure portal (not email)
- Respond to evidence requests within the agreed SLA (typically 5 business days)
- Escalate to the Incident Commander if QSA requests something sensitive

**Document review typically covers:**
- All 12 PCI DSS requirements
- Policy completeness, approval, and currency
- Procedure alignment with policy
- Evidence that procedures are actually followed (spot checks)

### Phase 3: Onsite or Virtual Assessment (Weeks 10–16)

**Activities:**
- Interviews with personnel: CISO, Engineering, DevSecOps, HR (for training/offboarding)
- Observation of processes: log review, change management, access provisioning
- Technical testing: QSA may review configs directly, run test queries, review code samples
- System component sampling: QSA selects a sample of CDE systems and validates controls on each
- Segmentation testing: QSA validates that NetworkPolicy isolates CDE namespaces

**Interview preparation:**
- Brief all interview subjects on their specific role in PCI DSS compliance
- CISO should be prepared to speak to all 12 requirements at a high level
- DevSecOps should be able to demonstrate: WAF config, Falco alerts, CloudWatch log review, SAST pipeline
- Engineering Lead should be able to walk through CI/CD pipeline from code commit to deployment
- HR/People Ops should be able to show onboarding security training and offboarding procedures

**Common QSA requests during onsite:**
- "Show me the last SAST build that caught a vulnerability."
- "Pull up the CloudWatch dashboard and walk me through the last security alert."
- "Show me the access review for the payment-engine namespace from last month."
- "Log into the Kubernetes cluster and show me the NetworkPolicy for the pci-vault namespace."

### Phase 4: Draft ROC and Remediation (Weeks 16–22)

**Activities:**
- QSA issues draft Report on Compliance
- ForgePay reviews draft: check for factual errors, misunderstandings, or missing evidence
- ForgePay responds to draft: submit additional evidence or clarifications
- For any open findings: QSA issues a remediation list; ForgePay remediates
- Re-assessment of remediated items

**How to respond to the draft ROC:**
- Review each finding carefully: is it factually accurate?
- If you believe a finding is incorrect, provide evidence and request reconsideration
- Do not argue with findings that are accurate — remediate them
- For findings that cannot be fully remediated, document compensating controls per PCI DSS Appendix B
- Engage legal counsel if you need to negotiate the scope or wording of findings

**Compensating Controls:**
If ForgePay cannot meet a specific PCI DSS requirement as stated, a compensating control may be accepted if it:
1. Meets the intent and rigor of the original requirement
2. Provides a similar level of defense
3. Goes above and beyond other PCI DSS requirements
4. Is commensurate with the additional risk of not meeting the original requirement

Compensating controls must be documented in a Compensating Control Worksheet and included in the ROC.

### Phase 5: Final ROC and AOC (Weeks 22–26)

**Activities:**
- QSA issues final Report on Compliance (ROC)
- QSA issues Attestation of Compliance (AOC)
- ForgePay countersigns the AOC
- AOC submitted to acquiring bank and card brands

**What the final AOC contains:**
- ForgePay's name and business type
- Scope of the assessment
- PCI DSS version assessed against
- Assessment date
- QSA company name and signature
- ForgePay executive signature
- Compliance status (compliant / not compliant / compliant with compensating controls)

**AOC distribution:**
- Acquiring bank (required — they submit to card brands)
- Card brands directly (for service providers)
- Merchant customers who request it (redacted as appropriate)
- Internal records

**Ongoing after AOC:**
- Quarterly ASV scans (ongoing)
- Semi-annual penetration testing (ongoing)
- Annual ROC renewal (schedule QSA for next cycle within 12 months of AOC date)

---

## 6. Cost Breakdown

| Cost Category | Estimate | Notes |
|---------------|---------|-------|
| QSA firm fee | $50,000–$150,000 | Wide range; cloud-native/startup QSAs often lower |
| QSA travel (if onsite) | $5,000–$20,000 | Reduce with virtual-first QSA |
| ForgePay staff time (compliance, engineering, DevSecOps) | $30,000–$80,000 | FTE hours at fully-loaded cost |
| Remediation work (depends on gap analysis) | $20,000–$100,000 | WAF, SIEM, EDR, pen test, training |
| Penetration testing | $20,000–$60,000 | Separate from QSA fee |
| ASV scanning (annual) | $3,000–$10,000 | Depends on IP count |
| Legal counsel | $5,000–$20,000 | Contract review, AOC review |
| **Total Year 1** | **$133,000–$440,000** | First-time certification is always highest cost |
| **Annual renewal (Year 2+)** | **$80,000–$200,000** | Ongoing QSA, pen test, ASV |

**Cost reduction tips:**
- Negotiate fixed price with QSA; compare 3+ proposals
- Use virtual-first QSA to eliminate travel costs
- Invest heavily in pre-QSA remediation — every gap found during the assessment costs more in QSA time than fixing it beforehand
- Bundle ASV scanning with the QSA firm if they also offer it (some discount available)

---

## 7. Timeline Reference

| Milestone | Target | Notes |
|-----------|--------|-------|
| Gap analysis complete | Month 1 | This document + `02_gap_analysis_v4.md` |
| Critical gaps remediated | Month 3 | Per `03_remediation_roadmap.md` |
| High gaps remediated | Month 4 | |
| First ASV scan (passing) | Month 4 | |
| Penetration test complete | Month 5 | |
| Evidence package assembled | Month 5 | Per `07_evidence_collection_checklist.md` |
| RFP issued to QSA firms | Month 5 | |
| QSA firm selected | Month 6 | |
| QSA kickoff | Month 6 | |
| Document review complete | Month 8 | |
| Onsite/virtual assessment | Month 9–10 | |
| Draft ROC received | Month 11 | |
| Remediation complete | Month 11–12 | |
| Final ROC and AOC | Month 12–13 | |

**Total estimated time from gap analysis to AOC: 12–15 months for first certification.**

---

## 8. Key Contacts and Resources

| Resource | URL / Contact |
|---------|--------------|
| PCI SSC Website | https://www.pcisecuritystandards.org/ |
| QSA Company List | https://www.pcisecuritystandards.org/assessors_and_solutions/qualified_security_assessors/ |
| PCI DSS v4.0 Download | https://www.pcisecuritystandards.org/document_library/ |
| PCI SSC ROC Reporting Template | https://www.pcisecuritystandards.org/document_library/ |
| ASV Program Guide | https://www.pcisecuritystandards.org/document_library/ |
| Visa CISP | https://usa.visa.com/support/merchant/library/pci-dss-compliance.html |
| Mastercard SDP | https://www.mastercard.us/en-us/business/overview/safety-and-security/security-recommendations/ |
| Selected QSA firm | [TO BE FILLED AFTER SELECTION] |
| QSA primary contact | [TO BE FILLED] |
| QSA project portal | [TO BE FILLED] |
| ForgePay compliance contact | compliance@forgepay.com |

---

## 9. Post-ROC: Maintaining Compliance

Achieving the first AOC is the beginning, not the end. Annual recertification requires:

| Activity | Frequency | Owner |
|----------|-----------|-------|
| QSA ROC re-assessment | Annual | Head of Compliance |
| ASV external scan | Quarterly | DevSecOps |
| Internal vulnerability scan | Quarterly | DevSecOps |
| Penetration test | Semi-annual (service provider) | Head of Compliance |
| Security awareness training | Annual (per employee) | CISO / HR |
| Policy review | Annual | CISO |
| Access review (CDE) | Semi-annual | DevSecOps / Engineering |
| Risk assessment | Annual | CISO |
| Scope review | Annual + significant changes | Head of Compliance |
| Third-party compliance review | Annual | Head of Compliance |

**Set a compliance calendar with all of the above activities scheduled for the next 12 months after each AOC is issued.**

---

*Document Owner: CISO / Head of Compliance*
*Classification: Confidential — Internal Use Only*
*Last Updated: 2026-06-25*
*Review Cadence: Annual; update after each QSA engagement*
