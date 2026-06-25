# Penetration Testing Scope — ForgePay

## Overview

PCI DSS v4.0 Requirement 11.4 mandates an annual penetration test of all CDE systems, covering both internal and external perspectives, plus explicit testing of network segmentation controls. For ForgePay as a service provider, the requirement is every 6 months. This document defines the scope, methodology, deliverables, and processes for ForgePay's penetration testing program.

**PCI DSS Reference:** Requirements 11.4.1–11.4.6

---

## 1. Regulatory Requirements Summary

| Requirement | Frequency | Notes |
|-------------|-----------|-------|
| Internal penetration test | Every 6 months (service provider) | Must cover CDE and segmentation |
| External penetration test | Every 6 months (service provider) | External IPs + domains |
| Segmentation validation | Every 6 months | Critical for ForgePay's scope reduction strategy |
| After significant changes | As needed | Any major infrastructure change, new system in scope |
| Application-layer testing | Included in annual test | Per OWASP methodology |
| Network-layer testing | Included in annual test | Per PTES or similar methodology |

**Service provider note:** ForgePay processes payments on behalf of other merchants, which qualifies it as a service provider under PCI DSS. Service providers must conduct penetration tests every 6 months rather than annually. QSA confirmation of this classification will be obtained during the ROC assessment.

---

## 2. In-Scope Systems

### 2.1 CDE Systems — Primary In-Scope Targets

| System | Access Type | Priority |
|--------|-------------|---------|
| Hyperswitch payment-engine (EKS pods in `payment-engine` namespace) | External + internal | Critical |
| Hyperswitch PCI vault (EKS pods in `pci-vault` namespace) | Internal only (isolated) | Critical |
| payment-engine PostgreSQL database (RDS) | Internal only | Critical |
| AWS ALB (payment-engine ingress) | External | High |
| AWS WAF rules (test bypass attempt) | External | High |
| Kubernetes API server (CDE cluster) | Internal (bastion) | High |
| AWS EKS node groups (CDE) | Internal (bastion) | High |
| AWS IAM roles for CDE workloads (IRSA) | Internal | High |
| AWS Secrets Manager (CDE secrets) | Internal | High |
| HashiCorp Vault (if used for CDE) | Internal | High |
| CI/CD pipeline access to CDE (GitHub Actions, ArgoCD) | External + internal | High |

### 2.2 Network Segmentation — Critical In-Scope Test

**This is the most important test for ForgePay's PCI DSS compliance strategy.** ForgePay's entire out-of-scope justification for non-CDE services (unified-router, mor-layer, dashboard, stablecoin-gateway, crypto-gateway) depends on effective Kubernetes NetworkPolicy segmentation.

The penetration tester must attempt to:
1. **From each out-of-scope namespace**, attempt direct pod-to-pod communication to CDE namespaces:
   - From `unified-router` namespace → attempt to reach `payment-engine` pods
   - From `mor-layer` namespace → attempt to reach `payment-engine` pods
   - From `dashboard` namespace → attempt to reach `payment-engine` pods
   - From `stablecoin-gateway` namespace → attempt to reach `pci-vault` pods
   - From any namespace → attempt to reach payment-engine RDS
2. Attempt to bypass NetworkPolicy via:
   - Kubernetes API server (can a pod with stolen ServiceAccount token add/modify NetworkPolicy?)
   - Node-level network access (if container escape achieved)
   - DNS rebinding or SSRF to reach CDE from non-CDE pod
   - Accessing cloud metadata service (IMDS) to escalate to CDE node role
3. Verify that the default-deny posture is enforced (no unexpected open paths)

**Pass criteria for segmentation test:** No successful direct communication from out-of-scope namespaces to CDE pods/services, confirmed with supporting network capture evidence.

### 2.3 Application-Layer In-Scope Targets

| Target | Access | Testing Focus |
|--------|--------|--------------|
| Payment-engine REST API (payment processing endpoints) | External (from internet) | Authentication, authorization, injection, business logic |
| payment-engine admin API (if applicable) | Internal | Privilege escalation, IDOR |
| Hyperswitch vault API (internal) | Internal | Unauthorized token access, brute force |
| Merchant dashboard (forgepay/apps/dashboard) | External | XSS, CSRF, authentication |
| Checkout hosted page (if applicable) | External | XSS, card skimming, Magecart-style attack |

### 2.4 Out-of-Scope Systems (Excluded from Test)

| System | Reason for Exclusion |
|--------|---------------------|
| Stablecoin and crypto gateways | No CHD — separate payment rails |
| Marketing site | No connection to CDE |
| External card networks (Visa/Mastercard APIs) | Third-party; cannot test without authorization |
| AWS infrastructure owned by AWS | Shared responsibility; cannot test AWS backbone |

---

## 3. Testing Methodology

### 3.1 Accepted Methodologies

ForgePay requires that the penetration testing firm follow one of these recognized methodologies:

| Methodology | Description |
|-------------|-------------|
| **PTES** (Penetration Testing Execution Standard) | Comprehensive; covers intelligence gathering, threat modeling, exploitation, post-exploitation, and reporting |
| **OWASP Testing Guide** | Application-layer focus; required for web application testing phases |
| **NIST SP 800-115** | Technical Guide to Information Security Testing and Assessment |
| **CIS Penetration Testing Framework** | Cloud-aware; good for AWS/Kubernetes environments |

The firm must document which methodology they followed in the final report.

### 3.2 Testing Phases

**Phase 1: Pre-Engagement**
- Rules of engagement finalized (scope, test windows, emergency contacts)
- Written authorization signed by ForgePay CISO
- ForgePay provides network diagram, system list, and architecture documentation
- Testing windows agreed (avoid peak transaction periods; coordinate with on-call)

**Phase 2: Reconnaissance and Discovery (External)**
- Passive reconnaissance: OSINT, DNS enumeration, certificate transparency, GitHub exposure
- Active reconnaissance: port scanning, service fingerprinting, banner grabbing
- Web application discovery: endpoint enumeration, Swagger/OpenAPI exposure, JS file analysis

**Phase 3: Vulnerability Analysis**
- Automated scanning (Nessus, Burp Suite scanner, Nuclei) — combined with manual testing
- Manual vulnerability identification for application-layer issues
- Authentication mechanism analysis (JWT security, MFA bypass attempts)
- Cloud-specific vulnerability assessment (IAM misconfigurations, IMDS access, public S3 buckets)
- Kubernetes security assessment (RBAC, Pod Security Standards, admission controllers)

**Phase 4: Exploitation (with authorization)**
- Exploitation of identified vulnerabilities within agreed scope
- Post-exploitation: privilege escalation, lateral movement, persistence
- Segmentation testing (critical — per Section 2.2)
- Data discovery: can the attacker reach CHD? Can they reach PANs in the vault?
- Attempt to access or exfiltrate cardholder data (to confirm exposure risk — NOT actual exfiltration)

**Phase 5: Post-Exploitation and Cleanup**
- Document access achieved
- Remove any test accounts, backdoors, or files created during testing
- Confirm all test artifacts removed and systems are in clean state
- Brief ForgePay on critical findings immediately (before written report)

**Phase 6: Reporting**
- Executive summary (non-technical; suitable for board)
- Technical findings (each finding: description, evidence, CVSS score, reproduction steps, remediation guidance)
- Segmentation test results (pass/fail with evidence)
- Remediation prioritization matrix

### 3.3 Testing Windows

| Restriction | Requirement |
|-------------|-------------|
| External testing window | Agreed in advance; avoid peak hours (e.g., 02:00–06:00 UTC on weekdays) |
| Production testing | Permitted with restrictions: no destructive payloads; no data exfiltration; no DoS |
| Denial of Service testing | Prohibited in production; may be conducted in staging with advance notice |
| Social engineering | In scope only if explicitly agreed; requires separate authorization |

---

## 4. Penetration Tester Requirements

### 4.1 Firm Selection Criteria

| Criterion | Requirement |
|-----------|-------------|
| PCI DSS expertise | Must demonstrate experience with PCI DSS Req 11.4 engagements |
| Cloud/Kubernetes expertise | Must demonstrate AWS and Kubernetes penetration testing experience |
| Application security expertise | Burp Suite Pro proficiency; OWASP experience |
| Certifications | At least one senior tester with OSCP, GPEN, GWAPT, CEH, or equivalent |
| Independence | Must be organizationally independent from ForgePay (cannot be the same person or team that built or manages the CDE) |
| References | Must provide 2+ references from PCI DSS penetration testing engagements |
| Insurance | Must carry professional liability/E&O insurance |

### 4.2 Independence Requirements (PCI DSS Req 11.4.2)

The penetration tester must be:
- A qualified external third party, OR
- An internal resource from a team that did not design, build, or manage the systems being tested

**ForgePay policy:** Given the size and current maturity of the security team, ForgePay requires an external firm for all penetration tests.

### 4.3 Recommended Firms

The following types of firms are appropriate for ForgePay's penetration testing needs:

- Specialized penetration testing firms with PCI DSS experience (Bishop Fox, NCC Group, Coalfire, Rapid7 Services, Trustwave SpiderLabs, Cobalt.io for agile testing)
- Big 4 advisory firms with security practices (for integrated compliance + pen test)
- Boutique AWS/Kubernetes-specialized security firms

**Evaluate via RFP process (see Section 7).**

---

## 5. Deliverables

The penetration testing firm must provide:

### 5.1 Executive Summary

A non-technical 2–4 page report suitable for the board:
- Overall risk rating (Critical/High/Medium/Low)
- Number and severity of findings
- Whether CHD was accessible
- Whether network segmentation is effective (pass/fail)
- Top 3 recommendations

### 5.2 Technical Findings Report

For each finding:
- Finding ID and title
- Severity (Critical/High/Medium/Low) with CVSS base score
- Affected system(s)
- Description of the vulnerability
- Step-by-step reproduction instructions
- Screenshot or log evidence
- Business impact (could this lead to CHD exposure?)
- Remediation recommendation
- PCI DSS requirement mapping (if applicable)

### 5.3 Segmentation Test Results

Dedicated section documenting:
- All segmentation paths tested (which namespace to which namespace)
- Methodology used for each test
- Result (blocked/allowed)
- Network capture or log evidence for each test
- Overall pass/fail determination for PCI DSS Req 11.4.5

### 5.4 Re-Test Report

After ForgePay remediates critical and high findings, the firm must conduct a re-test and issue an updated report confirming that remediated items are resolved.

### 5.5 Letter of Attestation

A signed letter from the testing firm stating:
- Engagement dates
- Scope covered
- Methodology used
- That the firm is qualified and independent
- Re-test completion date (if applicable)

---

## 6. Remediation Process

After receiving the penetration test report:

| Finding Severity | Remediation SLA | Re-Test Required |
|-----------------|----------------|-----------------|
| Critical (CVSS 9.0+) | 48 hours for interim containment; 7 days for full remediation | Yes |
| High (CVSS 7.0–8.9) | 7 days | Yes |
| Medium (CVSS 4.0–6.9) | 30 days | Optional (QSA may require) |
| Low (CVSS < 4.0) | 90 days | No |

All findings must be tracked in an issue tracker. Remediation evidence must be documented for QSA review.

**If a critical finding is discovered during testing that represents an active compromise risk, the testing firm must notify the ForgePay CISO immediately by phone — do not wait for the written report.**

---

## 7. RFP Template for Penetration Testing Firms

Use this template when soliciting proposals:

```
REQUEST FOR PROPOSAL — PENETRATION TESTING SERVICES
ForgePay — PCI DSS Level 1 Compliance

Date: [DATE]
Issued by: [CISO NAME], Chief Information Security Officer, ForgePay
Response deadline: [DATE]

BACKGROUND:
ForgePay is a payment orchestration platform running on AWS EKS. We are seeking a qualified penetration testing firm to conduct a PCI DSS Requirement 11.4-compliant penetration test. This is a [first/annual] engagement.

SCOPE:
- External penetration test of payment-engine ALB and associated services
- Internal penetration test via credentials to a non-privileged AWS account
- Kubernetes network segmentation validation (critical)
- Application-layer testing of payment-engine REST API
- AWS IAM and configuration review
- Estimated CDE system components: ~10 EKS services + supporting AWS infrastructure

REQUIREMENTS:
- Experience with PCI DSS Req 11.4 engagements (provide references)
- AWS and Kubernetes penetration testing experience
- Certifications: OSCP, GPEN, GWAPT, or equivalent
- Professional liability insurance: minimum $2M
- Deliverables: executive summary, technical report, segmentation test report, re-test

PROPOSAL MUST INCLUDE:
- Proposed methodology
- Proposed team and qualifications
- Sample report from similar engagement (redacted)
- Fixed-price cost estimate (or T&M with cap)
- Proposed timeline
- 2+ client references

SUBMIT TO: security@forgepay.com
```

---

## 8. Test Authorization and Legal Safeguards

**Written authorization is required before any penetration testing begins.** The authorization letter must be signed by the ForgePay CISO and include:

- Authorized scope (specific systems, IP ranges, namespaces)
- Authorized test window dates and times
- Emergency stop procedure (who to call to halt the test)
- Explicit permission for exploitation attempts within scope
- Prohibition on production data exfiltration
- Confidentiality obligations of the testing firm

**Store the signed authorization letter and all test reports for 3 years per PCI DSS evidence retention requirements.**

---

## 9. Report Retention and Storage

| Document | Retention Period | Storage Location |
|----------|-----------------|----------------|
| Penetration test report (all) | 3 years | `forgepay/compliance/pci-dss/evidence/req-11/pen-tests/YYYY/` |
| Re-test report | 3 years | Same |
| Signed authorization letter | 3 years | Same |
| Remediation evidence | 3 years | Same |
| Firm's attestation letter | 3 years | Same |

---

## 10. Annual Calendar

| Activity | Target Month | Notes |
|----------|-------------|-------|
| RFP issued to pen test firms | Month 1 | Allow 4 weeks for proposals |
| Firm selected; SOW signed | Month 2 | Allow lead time for scheduling |
| Test conducted (first wave) | Month 3 | |
| Report received | Month 3 (4 weeks after test) | |
| Remediation completed | Month 4 | Critical/High findings |
| Re-test completed | Month 4–5 | |
| Final report and attestation | Month 5 | Submit to QSA |
| Repeat (service provider cadence) | Month 7 | Second semi-annual test |

---

*Document Owner: CISO / Head of Compliance*
*Classification: Confidential — Internal Use Only*
*Last Updated: 2026-06-25*
*Review Cadence: Annual; update before each test engagement*
