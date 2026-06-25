# ForgePay — PCI DSS Level 1 Audit Preparation Package

## What Is PCI DSS?

The Payment Card Industry Data Security Standard (PCI DSS), currently at version 4.0 (effective March 2024, with v3.2.1 sunset March 31, 2024), is the global security framework mandated by Visa, Mastercard, American Express, Discover, and JCB for any organization that stores, processes, or transmits cardholder data (CHD) or sensitive authentication data (SAD).

## Why Level 1?

PCI DSS compliance level is determined by transaction volume and card brand mandates:

| Level | Criteria | Validation Method |
|-------|----------|-------------------|
| Level 1 | >6 million Visa OR Mastercard transactions/year; OR any merchant that has suffered a breach; OR any merchant Visa/Mastercard designates as Level 1 | Annual ROC by QSA + quarterly ASV scans |
| Level 2 | 1–6 million transactions/year | Annual SAQ + quarterly ASV scans |
| Level 3 | 20,000–1 million e-commerce transactions/year | Annual SAQ + quarterly ASV scans |
| Level 4 | <20,000 e-commerce transactions OR up to 1 million total/year | Annual SAQ + quarterly ASV scans (recommended) |

ForgePay targets Level 1 certification because:
1. The platform is designed to process >6M transactions/year at scale
2. Processing Mastercard and Visa as a payment facilitator triggers Level 1 per card brand rules
3. Enterprise merchant customers require their payment processors to hold Level 1 certification
4. Payment facilitator (PayFac) status with card brands requires Level 1

## ROC vs. SAQ

### Report on Compliance (ROC)
- Required for Level 1 merchants and service providers
- Conducted by a Qualified Security Assessor (QSA) — an independent firm certified by the PCI Security Standards Council
- Results in a formal Report on Compliance and Attestation of Compliance (AOC)
- Covers all 12 PCI DSS requirements across all in-scope systems
- Typically includes onsite or virtual assessment visits, document review, interviews, and technical testing

### Self-Assessment Questionnaire (SAQ)
- Used by Level 2–4 merchants (and some service providers with limited scope)
- Self-completed; no QSA required (though QSA assistance is permitted)
- Multiple SAQ types (A, A-EP, B, B-IP, C, C-VT, D, P2PE) based on payment acceptance method
- ForgePay does NOT qualify for SAQ — full ROC is required

## QSA Engagement Overview

A QSA engagement for Level 1 ROC typically follows this structure:

```
Phase 1: Scoping & Kickoff (Weeks 1–4)
  ├── Define CDE boundary
  ├── Network segmentation review
  ├── Agree on assessment methodology
  └── Document request list issued

Phase 2: Document Review (Weeks 4–8)
  ├── Policy and procedure review
  ├── Network diagrams and data flow diagrams
  ├── Configuration standards review
  └── Interview scheduling

Phase 3: Onsite / Virtual Assessment (Weeks 8–14)
  ├── System component sampling
  ├── Technical interviews with staff
  ├── Configuration validation
  └── Log review and testing

Phase 4: Reporting (Weeks 14–20)
  ├── Draft ROC issued
  ├── ForgePay response to findings
  ├── Remediation of outstanding gaps
  └── Final ROC and AOC issued
```

## Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Gap analysis and remediation | 2–4 months | Depends on current posture |
| QSA engagement | 3–6 months | From kickoff to final AOC |
| Total first-time certification | 6–12 months | Typical for new Level 1 entities |
| Annual recertification | 2–4 months | Ongoing after first year |

ForgePay's current gap analysis (see `02_gap_analysis_v4.md`) identifies several critical and high-priority gaps. Assuming aggressive remediation, a realistic timeline for first-time Level 1 ROC is **9–12 months** from initiation.

## Cost Estimate

### Level 1 ROC Costs

| Cost Category | Estimate Range | Notes |
|---------------|---------------|-------|
| QSA firm engagement | $50,000–$150,000 | Varies by QSA firm, scope, and engagement model |
| ASV quarterly scans | $2,000–$10,000/year | Per IP/domain scanned |
| Penetration testing (annual) | $20,000–$60,000 | Internal + external + segmentation test |
| WAF implementation | $10,000–$30,000/year | AWS WAF or equivalent |
| SIEM/log management | $15,000–$50,000/year | If not already in place |
| Security tooling (SAST, DAST, SCA) | $10,000–$40,000/year | Developer security toolchain |
| Staff time (internal) | $50,000–$100,000 | Engineering, security, compliance FTEs |
| Legal/advisory | $10,000–$30,000 | Contract review, card brand agreements |
| **Total Year 1** | **$170,000–$470,000** | Wide range due to tooling choices |
| **Recurring Annual** | **$80,000–$200,000** | After initial certification |

## Contents of This Package

| File | Purpose |
|------|---------|
| `01_scope_definition.md` | CDE boundary, in-scope/out-of-scope systems, segmentation methodology |
| `02_gap_analysis_v4.md` | PCI DSS v4.0 gap analysis — all 12 requirements |
| `03_remediation_roadmap.md` | 90-day remediation plan with owners and acceptance criteria |
| `04_security_policies/information_security_policy.md` | Master InfoSec Policy (Req 12.1) |
| `04_security_policies/access_control_policy.md` | Access Control Policy (Req 7 + 8) |
| `04_security_policies/incident_response_policy.md` | Incident Response Policy (Req 12.10) |
| `05_asv_scanning_guide.md` | ASV scan setup, vendors, and interpretation |
| `06_penetration_testing_scope.md` | Pen test scope and methodology (Req 11.4) |
| `07_evidence_collection_checklist.md` | QSA evidence artifacts by requirement |
| `08_qsa_engagement_guide.md` | QSA selection, RFP, and engagement process |

## Useful References

- PCI SSC Official Site: https://www.pcisecuritystandards.org/
- PCI DSS v4.0 Document: https://www.pcisecuritystandards.org/document_library/
- QSA Company List: https://www.pcisecuritystandards.org/assessors_and_solutions/qualified_security_assessors/
- ASV Company List: https://www.pcisecuritystandards.org/assessors_and_solutions/approved_scanning_vendors/
- Visa Level 1 Requirements: https://usa.visa.com/support/merchant/library/pci-dss-compliance.html
- Mastercard Level 1 Requirements: https://www.mastercard.us/en-us/business/overview/safety-and-security/security-recommendations/merchants-need-to-know.html

---

*Document Owner: CISO / Head of Compliance*
*Classification: Confidential — Internal Use Only*
*Last Updated: 2026-06-25*
*Review Cadence: Annual or upon PCI DSS version update*
