# ASV Scanning Guide — ForgePay

## Overview

PCI DSS Requirement 11.3.2 mandates that all external-facing IP addresses and domains in the Cardholder Data Environment (CDE) be scanned for vulnerabilities by an **Approved Scanning Vendor (ASV)** at least once every three months. This guide covers what ForgePay must scan, how to select and engage an ASV, how to interpret scan results, and how to manage the quarterly scan cadence.

**PCI DSS Reference:** Requirements 11.3.2, 11.3.2.1

---

## 1. What Is an ASV?

An Approved Scanning Vendor (ASV) is a company approved by the PCI Security Standards Council (PCI SSC) to conduct external network vulnerability scanning. ASVs use tools and processes validated by the PCI SSC. Only passing scan reports from a PCI SSC-approved ASV are accepted as evidence of PCI DSS compliance.

**ASV requirements:**
- Must be on the PCI SSC's ASV list: https://www.pcisecuritystandards.org/assessors_and_solutions/approved_scanning_vendors/
- Must use approved scanning tools and methodologies
- Must issue scan reports in the ASV program format (contains specific required fields)
- Cannot conduct scans against IP ranges without the entity's written authorization

**ASV vs. internal scanning:** ASV scans are external-only (from the internet, targeting your external IPs). They do not cover internal network scanning. Internal vulnerability scanning (Req 11.3.1) can be conducted by qualified internal staff or by a third party that is NOT required to be a PCI SSC-approved ASV.

---

## 2. Scope: What ForgePay Must Scan

### 2.1 In-Scope External IP Addresses

All externally routable IP addresses associated with CDE systems must be included in the ASV scan. For ForgePay running on AWS EKS:

| System | External IP Type | Where to Find |
|--------|-----------------|--------------|
| Payment-engine ALB | AWS Application Load Balancer — dynamic public IPs | AWS Console: EC2 → Load Balancers → DNS name; resolve to IPs |
| AWS NAT Gateway(s) for CDE subnet | Elastic IP (static) | AWS Console: VPC → NAT Gateways → Elastic IP |
| Any EC2 instances with public IPs in CDE | Elastic IP | AWS Console: EC2 → Instances |
| Any API Gateway endpoints for CDE | AWS-assigned public IP / custom domain | AWS Console: API Gateway |

**Important:** AWS ALB uses dynamic IPs that may change. Provide the ALB DNS name to the ASV; they will resolve and scan all returned IPs. If using AWS Certificate Manager + custom domain, include the domain name in scope.

### 2.2 Scope List Template

Prepare a formal scope list to provide to the ASV:

```
ForgePay ASV Scan Scope — Q[X] [YEAR]

Prepared by: [Name]
Date: [Date]
Authorized by: [CISO Name]

EXTERNAL IP ADDRESSES:
1. [IP ADDRESS] — payment-engine ALB ingress (primary)
2. [IP ADDRESS] — payment-engine ALB ingress (secondary, if multi-AZ)
3. [ELASTIC IP] — CDE NAT Gateway (us-east-1a)
4. [ELASTIC IP] — CDE NAT Gateway (us-east-1b)

DOMAIN NAMES (scan all resolved IPs):
1. api.forgepay.com — payment-engine external API
2. checkout.forgepay.com — hosted checkout page (if applicable)

OUT OF SCOPE (with justification):
- Internal VPC IP ranges (10.0.0.0/8) — not internet-reachable
- Non-CDE service IPs — network-segmented per NetworkPolicy; separate systems
```

### 2.3 What ASV Scans Detect

ASV scans test external-facing systems for:
- Open ports and services
- Known vulnerabilities in detected services (CVE database)
- Weak TLS cipher suites (SSLv3, TLS 1.0, TLS 1.1, RC4, DES, EXPORT ciphers)
- Missing security headers (relevant for HTTP-based services)
- Default credentials on management interfaces
- DNS zone transfer vulnerabilities
- Common web application vulnerabilities (XSS, SQLi — limited coverage; WAF and DAST provide deeper coverage)

ASV scans do NOT test:
- Internal network vulnerabilities
- Application logic vulnerabilities
- Business logic flaws
- Authentication bypass (application-level)

---

## 3. Approved ASV Vendors

The following ASVs are PCI SSC-approved and commonly used in the industry. Verify current approval status at https://www.pcisecuritystandards.org/assessors_and_solutions/approved_scanning_vendors/ before engaging.

| ASV | Strengths | Notes |
|-----|----------|-------|
| **Qualys** | Market leader; strong reporting; SaaS | QualysGuard PCI module streamlines quarterly scanning |
| **Trustwave** | Integrated with managed security services | Good if also using Trustwave for other compliance services |
| **Tenable (Nessus PCI ASV)** | Widely used; familiar to many security teams | Nessus.io has ASV scanning capability |
| **ControlScan** | PCI-focused company; responsive support | Smaller but PCI-specialist |
| **SecurityMetrics** | PCI-focused; competitive pricing | Good for organizations in early compliance journey |
| **Rapid7** | Good integration with InsightVM for combined internal/external scanning | Useful if already using InsightVM internally |
| **Coalfire** | Also a QSA; can bundle ASV scanning with ROC assessment | Efficient if using Coalfire as QSA |

### 3.1 Vendor Selection Criteria

| Criterion | Weight | Notes |
|-----------|--------|-------|
| PCI SSC approval current | Required | Non-negotiable |
| Scan report format | High | Must produce PCI DSS-compliant ASV report |
| False positive dispute process | High | Some vendors are faster/easier to work with on disputes |
| Portal usability | Medium | Self-service scheduling and reporting |
| Price per IP/domain | Medium | Typically $500–$2,000/quarter for ForgePay's scale |
| Customer support SLA | Medium | Need responsive support for re-scans after remediation |
| Integration with ticketing | Low | Nice to have |

---

## 4. Quarterly Scan Process

### 4.1 Scan Schedule

Scans must be completed within each 3-month calendar quarter. ForgePay's recommended schedule:

| Quarter | Scan Target Completion | Notes |
|---------|----------------------|-------|
| Q1 (Jan–Mar) | By March 15 | Allows time for remediation and re-scan before quarter end |
| Q2 (Apr–Jun) | By June 15 | Same |
| Q3 (Jul–Sep) | By September 15 | Same |
| Q4 (Oct–Dec) | By December 15 | Same |

**Important:** A passing scan report must be dated within the same quarter. Starting a scan on December 31 leaves no time for remediation and re-scan if issues are found.

### 4.2 Pre-Scan Checklist

Before each quarterly ASV scan:

- [ ] Verify scope list is current (any new external IPs or domains added?)
- [ ] Notify DevSecOps and SRE that scan is scheduled (to distinguish scan traffic from real attacks)
- [ ] Confirm ASV authorization letter is current (some ASVs require signed authorization per scan)
- [ ] Ensure AWS WAF is not blocking ASV scanner IPs (may need to whitelist ASV IP ranges for scan period)
- [ ] Confirm all new services deployed since last scan are included in scope

### 4.3 Scan Execution

1. Log into ASV portal
2. Create new scan job with current scope list
3. Schedule scan for agreed time window
4. ASV initiates scan from their external infrastructure
5. Scan typically completes in 2–24 hours depending on scope size
6. Raw results available in ASV portal after completion

### 4.4 Reviewing Scan Results

ASV scan reports contain:

| Section | Content |
|---------|---------|
| Executive Summary | Pass/Fail status; number of findings by severity |
| Target Summary | Each IP/domain scanned; pass/fail per target |
| Vulnerability Details | Each finding with CVE, CVSS score, affected service, remediation recommendation |
| Special Notes | Items requiring merchant confirmation (e.g., host-based findings) |

**PCI DSS pass criteria (from ASV Program Guide):**
- No CVSS base score of 4.0 or higher (after applying temporal/environmental adjustments)
- No PCI DSS-specific failures (e.g., SSL v3, TLS 1.0, weak ciphers)

Even a single HIGH or CRITICAL finding causes the scan to FAIL.

---

## 5. Remediation and Re-Scanning

### 5.1 Finding Triage

When the scan returns findings:

1. **Classify each finding:** Is it a real vulnerability or a false positive?
2. **Prioritize:** Critical/High findings must be remediated before re-scan; Medium/Low addressed per your vulnerability management SLA
3. **Assign owners:** Map each finding to the responsible system owner
4. **Remediation:** Patch, reconfigure, or remove the vulnerable service
5. **Verify:** Confirm the fix is in place before re-scanning

### 5.2 False Positive Process

Not every finding is a real vulnerability. Common false positives in cloud environments:
- Service banners showing version numbers that ASV flags as vulnerable, but the actual package is patched
- Load balancer responses that mimic vulnerable server headers
- Closed ports that appear "open" due to scanning artifacts

**False positive dispute process:**
1. Gather evidence that the vulnerability does not actually exist (e.g., show the actual patched version, demonstrate the control compensating the risk)
2. Submit dispute to ASV via their dispute process (portal upload or email)
3. ASV reviews and may mark the finding as "confirmed false positive" or may request additional evidence
4. QSA reviews disputed findings; compensating controls may be required

**Document all disputes with evidence and ASV outcome. Store with scan report.**

### 5.3 Re-Scan Process

After remediation:
1. Log into ASV portal
2. Request a re-scan of the specific IPs/domains that had findings
3. Re-scan must be completed within the same calendar quarter for the report to count for that quarter
4. Continue re-scanning until a passing report is obtained
5. Download and store the passing report

---

## 6. After-Significant-Changes Scans

Per PCI DSS Req 11.3.1.2 (for internal scanning) and best practice, an ASV scan should also be conducted:
- After any new external IP or domain is added to the CDE
- After any significant change to the network perimeter (new ALB, new service exposed externally)
- After a security incident that may have resulted in configuration changes

These additional scans are separate from the quarterly scan requirement. If a new significant-change scan falls within a quarter, it can count as that quarter's scan if it covers all in-scope targets.

---

## 7. Scan Report Storage and Retention

- All ASV scan reports (passing and failing) must be retained for **3 years**
- Store reports in: `forgepay/compliance/pci-dss/evidence/req-11/asv-scans/YYYY/QX/`
- Naming convention: `asv-report-YYYY-QX-[vendor]-[pass|fail].pdf`
- Reports must be available to the QSA on request
- Failed scan reports must be retained along with evidence of remediation actions

**Example folder structure:**
```
evidence/req-11/asv-scans/
├── 2026/
│   ├── Q1/
│   │   ├── asv-report-2026-Q1-qualys-fail.pdf
│   │   ├── asv-report-2026-Q1-qualys-remediation-evidence.pdf
│   │   └── asv-report-2026-Q1-qualys-pass.pdf
│   ├── Q2/
│   │   └── asv-report-2026-Q2-qualys-pass.pdf
│   └── ...
```

---

## 8. Communicating with the QSA About ASV Scans

The QSA will request:
- Last 4 quarters of ASV scan reports (all attempts, not just passing reports)
- Evidence that all in-scope external IPs were included in scope
- Evidence of remediation for any findings
- False positive documentation for any disputed findings
- ASV contract / engagement letter confirming ASV is PCI SSC-approved

**Common QSA questions about ASV scans:**
- "How do you track scope changes between quarters?"
- "Can you show that the scope includes all external IPs?"
- "Walk me through how you remediated this finding from last quarter."
- "What is your process for adding new external IPs to the scan scope?"

---

## 9. ASV Scan Contacts and Accounts

| Field | Value |
|-------|-------|
| Selected ASV vendor | [TO BE FILLED] |
| ASV portal URL | [TO BE FILLED] |
| ASV account holder | [NAME / EMAIL] |
| ASV support email | [TO BE FILLED] |
| ASV support phone | [TO BE FILLED] |
| Contract expiry | [TO BE FILLED] |
| Next scheduled scan | [DATE] |

---

*Document Owner: Head of Compliance / DevSecOps*
*Classification: Confidential — Internal Use Only*
*Last Updated: 2026-06-25*
*Review Cadence: Annual; update scope list before each quarterly scan*
