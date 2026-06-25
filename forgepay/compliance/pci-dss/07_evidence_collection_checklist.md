# QSA Evidence Collection Checklist — ForgePay

## Overview

This checklist enumerates the specific artifacts required for each PCI DSS v4.0 requirement. It is organized by requirement and maps each artifact to where it lives in ForgePay's systems. Use this checklist to prepare for a QSA assessment.

**Purpose:** Ensure no evidence gaps before the QSA arrives. A well-prepared evidence package reduces QSA time, reduces cost (QSAs bill by the hour), and demonstrates organizational maturity.

**QSA Assessment Approach:** QSAs validate compliance through four methods: (1) document review, (2) interviews with relevant personnel, (3) observation of systems and processes, (4) sampling of system components. This checklist prepares for all four.

---

## Evidence Folder Structure

Organize all evidence in the following folder structure before QSA engagement:

```
forgepay/compliance/pci-dss/evidence/
├── req-1/           # Network Security Controls
│   ├── network-diagrams/
│   ├── dataflow-diagrams/
│   ├── networkpolicy-configs/
│   ├── firewall-rule-reviews/
│   └── waf-config/
├── req-2/           # Secure Configurations
│   ├── configuration-standards/
│   ├── cis-benchmark-results/
│   └── hardening-evidence/
├── req-3/           # Protect Stored Account Data
│   ├── key-management-policy/
│   ├── vault-architecture/
│   └── data-retention/
├── req-4/           # Protect Data in Transit
│   ├── tls-configs/
│   └── certificate-inventory/
├── req-5/           # Anti-Malware
│   ├── falco-config/
│   ├── guardduty-config/
│   └── scan-reports/
├── req-6/           # Secure Systems and Software
│   ├── sast-reports/
│   ├── sca-reports/
│   ├── waf-evidence/
│   └── change-management/
├── req-7/           # Restrict Access
│   ├── rbac-configs/
│   ├── access-reviews/
│   └── iam-policies/
├── req-8/           # Identify Users and Authenticate
│   ├── mfa-configs/
│   ├── password-policy/
│   ├── account-reviews/
│   └── offboarding-records/
├── req-9/           # Physical Security
│   └── aws-artifact-reports/
├── req-10/          # Logging and Monitoring
│   ├── log-configs/
│   ├── siem-config/
│   ├── log-retention-evidence/
│   └── alert-configs/
├── req-11/          # Test Security
│   ├── asv-scans/
│   │   ├── 2026/Q1/
│   │   └── 2026/Q2/
│   ├── pen-tests/
│   │   └── 2026/
│   └── internal-scans/
├── req-12/          # Information Security Policies
│   ├── policies/
│   ├── training-records/
│   ├── risk-assessment/
│   └── vendor-management/
└── scope/
    ├── scope-definition.md (→ 01_scope_definition.md)
    ├── network-segmentation-evidence/
    └── cardholder-data-flow-diagram/
```

---

## Requirement 1: Network Security Controls

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 1.1 | Network diagram | Current diagram showing all CDE systems, segments, trust boundaries | `evidence/req-1/network-diagrams/` | TODO |
| 1.2 | Data flow diagram | Shows all paths where CHD flows through the system | `evidence/req-1/dataflow-diagrams/` | TODO |
| 1.3 | Kubernetes NetworkPolicy YAMLs | All NetworkPolicy objects in CDE namespaces | Export from cluster; store in `evidence/req-1/networkpolicy-configs/` | TODO |
| 1.4 | NetworkPolicy review evidence | Screenshot or export showing review was completed in last 6 months | `evidence/req-1/firewall-rule-reviews/` | TODO |
| 1.5 | WAF configuration export | AWS WAF WebACL configuration | AWS Console screenshot + Terraform config | TODO |
| 1.6 | WAF rule list | List of active WAF rules and associated protections | `evidence/req-1/waf-config/waf-rules.md` | TODO |
| 1.7 | NSC change management log | Record of last 3 months of changes to NetworkPolicy or security groups | Jira/GitHub issue history | TODO |
| 1.8 | VPC security group configs | All security groups attached to CDE resources | AWS Console export + Terraform | TODO |
| 1.9 | Egress documentation | Documented and approved outbound connections from CDE | `evidence/req-1/` | TODO |

**QSA Interview Topics — Req 1:**
- "Walk me through how traffic flows from a cardholder to the vault."
- "How do you prevent out-of-scope services from reaching the CDE?"
- "What is your process for reviewing and approving NSC changes?"
- "Who can modify NetworkPolicy in the CDE namespace?"

---

## Requirement 2: Secure Configurations

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 2.1 | Configuration standards document | Formal standards for CDE system configuration | `evidence/req-2/configuration-standards/` | TODO |
| 2.2 | CIS Benchmark results | kube-bench output for EKS CDE node groups | Run: `kube-bench --json > kube-bench-results.json` | TODO |
| 2.3 | Container hardening evidence | Docker bench / Trivy results for CDE container images | `evidence/req-2/cis-benchmark-results/` | TODO |
| 2.4 | Kubernetes Pod Security Standards enforcement | Screenshot/config showing `Restricted` profile enforced on CDE namespaces | `kubectl get ns payment-engine -o yaml` | TODO |
| 2.5 | Helm chart security context configs | Snippet showing securityContext, non-root user, readOnlyRootFilesystem | From Helm chart source | TODO |
| 2.6 | Vendor default credential change evidence | Documentation that no vendor defaults are in use in CDE | Config audit results | TODO |
| 2.7 | Port/service inventory | Inventory of all open ports/services on CDE system components | Nmap output from internal scan | TODO |

**QSA Interview Topics — Req 2:**
- "How do you ensure CDE containers run as non-root?"
- "What hardening standards do you follow for EKS nodes?"
- "How are vendor default accounts managed?"

---

## Requirement 3: Protect Stored Account Data

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 3.1 | Hyperswitch vault architecture doc | Explanation of how PANs are tokenized and stored | `evidence/req-3/vault-architecture/` | TODO |
| 3.2 | Confirmation that no raw PANs stored | Database schema or query confirming only tokens stored in payment-engine DB | `SELECT column_name FROM information_schema.columns WHERE table_schema='payment'` audit | TODO |
| 3.3 | Key management policy | Formal policy for vault key lifecycle | `evidence/req-3/key-management-policy/` | TODO |
| 3.4 | AWS KMS key inventory | List of KMS keys used for CDE, with rotation status | AWS KMS console screenshot | TODO |
| 3.5 | KMS automatic rotation enabled | Screenshot showing `enableKeyRotation: true` for vault master key | AWS KMS console | TODO |
| 3.6 | Cryptoperiod definitions | Document defining cryptoperiod for each key type | In key management policy | TODO |
| 3.7 | Data retention policy | Formal document defining retention periods for all payment data | `evidence/req-3/data-retention/retention-schedule.md` | TODO |
| 3.8 | PAN truncation evidence | Screenshot showing truncated PAN display in dashboard and logs | Dashboard screenshot | TODO |
| 3.9 | RDS encryption configuration | Confirmation that RDS instance is encrypted at rest | AWS RDS console → Storage → Encryption | TODO |

**QSA Interview Topics — Req 3:**
- "Walk me through exactly how a PAN is handled from entry to storage."
- "Where is the vault master key stored? Who has access?"
- "How do you verify that no raw PANs end up in logs?"
- "What is your data retention policy for payment records?"

---

## Requirement 4: Protect Data in Transit

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 4.1 | TLS configuration for ALB | Minimum TLS version and allowed cipher suites | AWS ALB listener configuration | TODO |
| 4.2 | TLS configuration for internal services | mTLS config between payment-engine and pci-vault | Helm chart / Istio / Envoy config | TODO |
| 4.3 | Certificate inventory | List of all TLS certificates in scope, with expiry dates | ACM certificate list export | TODO |
| 4.4 | SSL/TLS test results | Output of SSLyze, testssl.sh, or Qualys SSL Labs scan | `sslyze --regular api.forgepay.com` | TODO |
| 4.5 | Confirmation TLS 1.0/1.1 disabled | Test confirming these protocol versions are rejected | SSL test output | TODO |

**QSA Interview Topics — Req 4:**
- "What TLS versions are supported on your public-facing payment endpoints?"
- "How is TLS managed between internal services?"
- "How do you track certificate expiry?"

---

## Requirement 5: Protect Against Malicious Software

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 5.1 | Falco deployment confirmation | Screenshot of Falco DaemonSet running on CDE nodes | `kubectl get daemonset -n falco` | TODO |
| 5.2 | Falco configuration | Falco rules config file showing PCI-relevant rules | `evidence/req-5/falco-config/` | TODO |
| 5.3 | Falco alert log sample | Sample of Falco alerts demonstrating logging is working | Export from log system | TODO |
| 5.4 | GuardDuty EKS Protection status | Screenshot showing GuardDuty enabled with EKS Runtime Monitoring | AWS GuardDuty console | TODO |
| 5.5 | Anti-malware log retention config | Config showing logs retained per Req 10.7 (12 months) | CloudWatch log group retention setting | TODO |
| 5.6 | Periodic evaluation documentation | For Linux containers: documented evaluation confirming anti-malware approach is appropriate | `evidence/req-5/linux-evaluation.md` | TODO |

**QSA Interview Topics — Req 5:**
- "What anti-malware solution is deployed on CDE nodes?"
- "How would you detect malware running inside a container?"
- "How are anti-malware alerts investigated?"

---

## Requirement 6: Secure Systems and Software

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 6.1 | Secure coding standard | Documented guidelines for secure development | `evidence/req-6/` | TODO |
| 6.2 | SAST pipeline configuration | GitHub Actions workflow showing SAST integrated into CI | `.github/workflows/` + screenshot | TODO |
| 6.3 | Sample SAST report | Last SAST report for payment-engine build | `evidence/req-6/sast-reports/` | TODO |
| 6.4 | SCA / dependency scan config | Snyk or cargo-audit configuration | `evidence/req-6/sca-reports/` | TODO |
| 6.5 | SBOM for CDE services | CycloneDX SBOM for payment-engine and pci-vault | `evidence/req-6/` | TODO |
| 6.6 | WAF deployment evidence | AWS WAF WebACL association with payment-engine ALB | AWS WAF console screenshot | TODO |
| 6.7 | WAF in Block mode confirmation | Screenshot showing WAF mode is Block (not Count) | AWS WAF console | TODO |
| 6.8 | Developer security training records | Evidence that developers completed secure coding training | `evidence/req-12/training-records/` | TODO |
| 6.9 | Change management policy | Formal policy for managing changes to CDE | `evidence/req-6/change-management/` | TODO |
| 6.10 | Pre-production separation evidence | Config showing staging namespace is separate from production | Kubernetes namespace listing + NetworkPolicy | TODO |

**QSA Interview Topics — Req 6:**
- "Walk me through the deployment pipeline for payment-engine."
- "How do you ensure no vulnerabilities are deployed to production?"
- "What happens when SAST finds a critical finding?"
- "How does the WAF protect against OWASP Top 10?"

---

## Requirement 7: Restrict Access

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 7.1 | RBAC policy documentation | Description of role-based access model for CDE | `evidence/req-7/rbac-configs/` | TODO |
| 7.2 | Kubernetes RBAC configs | ClusterRoles, Roles, ClusterRoleBindings, RoleBindings for CDE namespaces | `kubectl get clusterrolebinding,rolebinding -n payment-engine -o yaml` | TODO |
| 7.3 | AWS IAM roles and policies for CDE | IAM role definitions for IRSA roles used by CDE pods | AWS IAM console + Terraform | TODO |
| 7.4 | PostgreSQL role grants | Database role permissions for CDE database | `\du` and `\dp` output from psql | TODO |
| 7.5 | Access review records | Last 6-month access review results for CDE access | `evidence/req-7/access-reviews/` | TODO |
| 7.6 | Access request records | Sample access request and approval documentation | Ticketing system export | TODO |

**QSA Interview Topics — Req 7:**
- "How do you ensure least privilege for CDE access?"
- "When was the last access review conducted? What did it find?"
- "How does a new engineer get access to the payment-engine namespace?"

---

## Requirement 8: Identify Users and Authenticate

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 8.1 | MFA configuration evidence | Screenshot of MFA enforced for all CDE admin access | AWS IAM policy + Okta/SSO config | TODO |
| 8.2 | Password policy configuration | Formal policy + technical enforcement evidence | `evidence/req-8/password-policy/` | TODO |
| 8.3 | Account lockout configuration | Evidence of lockout after 10 failed attempts | Auth system config | TODO |
| 8.4 | Inactive account report | Last monthly report showing inactive accounts detected/disabled | `evidence/req-8/account-reviews/` | TODO |
| 8.5 | Offboarding records | Sample records showing access revoked within 1 hour for terminated users | HR system + DevSecOps ticket | TODO |
| 8.6 | Service account inventory | List of all service accounts in CDE with permissions | `kubectl get serviceaccount -n payment-engine` + IRSA role list | TODO |
| 8.7 | Session recording evidence | Evidence that privileged sessions are recorded (SSM Session Manager logs) | AWS CloudWatch or S3 session logs | TODO |
| 8.8 | No hard-coded credentials scan | Evidence that SAST or credential scanner has confirmed no hard-coded creds | SAST/Gitleaks scan results | TODO |

**QSA Interview Topics — Req 8:**
- "How is MFA enforced for all CDE access?"
- "What happens when an employee leaves? Walk me through the offboarding steps."
- "How are service account credentials managed and rotated?"
- "Can you show me the process for detecting and disabling inactive accounts?"

---

## Requirement 9: Physical Security

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 9.1 | AWS SOC 2 Type II report | Current AWS SOC 2 report evidencing physical security controls | AWS Artifact — download annually | TODO |
| 9.2 | AWS PCI DSS AOC | AWS Attestation of Compliance for PCI DSS | AWS Artifact | TODO |
| 9.3 | Inherited controls documentation | Document explaining that physical security is inherited from AWS | `evidence/req-9/` | TODO |
| 9.4 | Responsibility matrix | AWS Shared Responsibility Model reference showing physical security is AWS responsibility | `evidence/req-9/` | TODO |

**QSA Interview Topics — Req 9:**
- "Where are your servers located?"
- "How do you verify AWS's physical security controls?"
- "How do you ensure AWS's data center certifications remain current?"

---

## Requirement 10: Logging and Monitoring

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 10.1 | Log source inventory | List of all log sources feeding SIEM/CloudWatch | `evidence/req-10/log-configs/log-sources.md` | TODO |
| 10.2 | CloudWatch log group configs | Screenshots showing all CDE log groups with 13-month retention | AWS CloudWatch console | TODO |
| 10.3 | Kubernetes audit log config | EKS audit log configuration showing API server audit logging enabled | AWS EKS console + audit log config | TODO |
| 10.4 | CloudTrail configuration | All accounts, all regions, management and data events enabled | AWS CloudTrail console + config | TODO |
| 10.5 | SIEM/log review alert configs | Configuration of automated alerts (CloudWatch Alarms / EventBridge rules) | `evidence/req-10/alert-configs/` | TODO |
| 10.6 | Sample SIEM alerts | Screenshots of security alerts fired and investigated | CloudWatch Alarms history | TODO |
| 10.7 | Immutable log storage evidence | S3 bucket config showing Object Lock Compliance mode enabled | AWS S3 console + bucket policy | TODO |
| 10.8 | Log retention verification | Confirmation that logs are retained 12 months online, 3 years total | S3 lifecycle policy + CloudWatch retention | TODO |
| 10.9 | Log review procedure | Written procedure for daily/weekly log review | `evidence/req-10/` | TODO |
| 10.10 | NTP synchronization evidence | Configuration showing all CDE systems synchronized to AWS NTP | AWS Time Sync Service config | TODO |
| 10.11 | Falco log review evidence | Evidence that Falco logs are reviewed and alerts acted upon | Incident ticket for any Falco alert | TODO |

**QSA Interview Topics — Req 10:**
- "Show me the last security alert that fired. What was it and how was it handled?"
- "How do you prevent someone from deleting or modifying audit logs?"
- "How long are logs retained? Where are they stored?"
- "What events are you alerted on?"

---

## Requirement 11: Test Security

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 11.1 | ASV scan reports — all quarters | Passing ASV scan reports for last 4 quarters | `evidence/req-11/asv-scans/` | TODO |
| 11.2 | ASV scope list | IP addresses and domains included in each scan | `evidence/req-11/asv-scans/YYYY/QX/scope.txt` | TODO |
| 11.3 | ASV remediation evidence | Evidence of remediation for any findings from ASV scans | `evidence/req-11/asv-scans/YYYY/QX/remediation/` | TODO |
| 11.4 | Internal vulnerability scan results | Trivy and kube-bench output for CDE | `evidence/req-11/internal-scans/` | TODO |
| 11.5 | Penetration test report | Full technical pen test report | `evidence/req-11/pen-tests/YYYY/` | TODO |
| 11.6 | Penetration test re-test report | Report confirming critical/high findings remediated | `evidence/req-11/pen-tests/YYYY/retest/` | TODO |
| 11.7 | Segmentation test results | Dedicated section from pen test confirming segmentation is effective | In pen test report | TODO |
| 11.8 | IDS/IPS configuration | AWS Network Firewall config + Falco as host IDS | `evidence/req-11/` | TODO |
| 11.9 | IDS/IPS alert sample | Evidence that IDS is generating and routing alerts | CloudWatch / SIEM screenshot | TODO |
| 11.10 | FIM configuration | AIDE or Falco FIM config + sample alert | `evidence/req-11/` | TODO |

**QSA Interview Topics — Req 11:**
- "When was your last penetration test? Can I see the report and the remediation evidence?"
- "Walk me through the segmentation test results. How was it validated?"
- "Show me the last ASV passing scan report."
- "What IDS/IPS do you use? Show me a recent alert."

---

## Requirement 12: Information Security Policies

| # | Artifact | Description | Where It Lives | Status |
|---|---------|-------------|----------------|--------|
| 12.1 | Information Security Policy (signed) | Approved ISP-001 with executive signatures | `evidence/req-12/policies/ISP-001-signed.pdf` | TODO |
| 12.2 | Access Control Policy (signed) | Approved ISP-002 | `evidence/req-12/policies/ISP-002-signed.pdf` | TODO |
| 12.3 | Incident Response Policy (signed) | Approved ISP-003 | `evidence/req-12/policies/ISP-003-signed.pdf` | TODO |
| 12.4 | Acceptable Use Policy + acknowledgments | Signed AUP acknowledgments from all personnel | `evidence/req-12/policies/aup-acknowledgments/` | TODO |
| 12.5 | Risk assessment | Annual risk assessment report | `evidence/req-12/risk-assessment/` | TODO |
| 12.6 | Security awareness training records | Completion records for all personnel; training curriculum | `evidence/req-12/training-records/` | TODO |
| 12.7 | Phishing simulation results | Results of most recent phishing simulation | `evidence/req-12/training-records/phishing-sim/` | TODO |
| 12.8 | Third-party vendor list | Inventory of all third parties with CDE access or access to CHD | `evidence/req-12/vendor-management/tpsp-list.md` | TODO |
| 12.9 | Third-party compliance attestations | PCI DSS AOC or compliance letter from each TPSP | `evidence/req-12/vendor-management/tpsp-attestations/` | TODO |
| 12.10 | Scope definition document | Current scope of PCI DSS assessment | `01_scope_definition.md` | DONE |
| 12.11 | IR plan test records | Tabletop exercise or simulation results | `evidence/req-12/` | TODO |
| 12.12 | Background check policy | Policy and evidence that background checks are performed | `evidence/req-12/` | TODO |
| 12.13 | CISO appointment evidence | Formal appointment letter or role description for CISO | `evidence/req-12/` | TODO |

**QSA Interview Topics — Req 12:**
- "Show me your information security policy. When was it last reviewed?"
- "How do you perform security awareness training? Can I see completion records?"
- "What is your process for assessing third-party vendors?"
- "Walk me through your incident response procedure. Has it ever been tested?"

---

## Pre-QSA Readiness Checklist

Run this checklist 2–4 weeks before the QSA assessment begins:

### Documentation
- [ ] All policies in the table above are approved (signed) and current
- [ ] Evidence folder structure is populated with all required artifacts
- [ ] Network diagram and data flow diagram are current and accurate
- [ ] Scope definition document reviewed and confirmed

### Technical
- [ ] Last ASV scan is a passing report dated within the last 3 months
- [ ] Last penetration test report is available with remediation evidence
- [ ] SIEM/CloudWatch alerts are operational and generating output
- [ ] Falco / GuardDuty are operational
- [ ] WAF is in Block mode (not Count mode)
- [ ] All accounts with CDE access have MFA enabled
- [ ] Access review completed within last 6 months

### Interviews
- [ ] CISO briefed on all policy documents and can speak to them
- [ ] DevSecOps lead briefed on technical controls and can demonstrate them
- [ ] Engineering lead briefed on SDLC and can walk through CI/CD pipeline
- [ ] Head of Compliance can walk through the scope definition
- [ ] On-call SRE can demonstrate log review procedure

### Logistics
- [ ] QSA kickoff meeting scheduled
- [ ] Document access provided to QSA via secure portal (not email)
- [ ] Conference room or video call infrastructure arranged for interviews
- [ ] System access for QSA (read-only) provisioned for assessment period
- [ ] Legal counsel briefed and available for QSA calls if needed

---

*Document Owner: Head of Compliance*
*Classification: Confidential — Internal Use Only*
*Last Updated: 2026-06-25*
*Review Cadence: Update before each QSA assessment*
