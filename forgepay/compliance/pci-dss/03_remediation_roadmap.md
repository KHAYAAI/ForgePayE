# PCI DSS v4.0 Remediation Roadmap — ForgePay

## Overview

This 90-day roadmap addresses the gaps identified in `02_gap_analysis_v4.md`. Items are ordered by risk priority: critical gaps that pose immediate CHD exposure risk come first, followed by high-priority control gaps, then documentation and process improvements.

**Goal:** Achieve a QSA-ready compliance posture within 90 days. This means all critical and high-priority gaps are remediated, evidence is collected, and remaining medium/low gaps have documented remediation plans.

**Note:** Some critical gaps (SIEM, penetration testing, ASV scanning) may take longer than 90 days to fully implement. The roadmap prioritizes getting these started within the first 30 days even if completion extends beyond the 90-day window.

---

## Sprint 1: Weeks 1–2 — Critical Gaps (Immediate Risk)

These items pose an immediate risk of CHD exposure or will prevent QSA engagement from starting.

### Task 1.1 — Deploy Anti-Malware / EDR on CDE Nodes

**PCI DSS Req:** 5.2.1, 5.2.2, 5.3.1, 5.3.2, 5.3.3
**Priority:** CRITICAL
**Owner:** DevSecOps Engineer / SRE Team
**Effort:** 1 week

**Background:** No anti-malware or endpoint detection and response (EDR) solution is deployed on EKS nodes hosting CDE workloads. This is a critical PCI DSS failure.

**Recommended Solution Options:**
1. **Falco** (open source) — Kubernetes-native runtime security; detects anomalous syscall behavior, container escapes, privilege escalation
2. **AWS GuardDuty + EKS Protection** — managed threat detection for EKS workloads; integrates with CloudWatch
3. **CrowdStrike Falcon for Containers** — commercial, comprehensive coverage; DaemonSet deployment on CDE nodes
4. **SentinelOne Singularity** — commercial alternative

**Recommended approach for ForgePay:** Deploy Falco (immediate, open source) as the primary runtime detection layer on CDE nodes, combined with AWS GuardDuty EKS Protection for network-level threat detection.

**Implementation Steps:**
1. Deploy Falco DaemonSet to CDE node group via Helm chart
2. Configure Falco rules for PCI DSS use case (card data access, privilege escalation, container escape)
3. Enable AWS GuardDuty with EKS Runtime Monitoring
4. Configure alert routing to incident response channel (PagerDuty / Slack #security-alerts)
5. Configure log retention per Req 10.7 (12 months minimum)
6. Document solution with evidence for QSA

**Acceptance Criteria:**
- [ ] Falco DaemonSet running on all CDE node group nodes
- [ ] Falco alerts flowing to log aggregation system
- [ ] GuardDuty enabled with EKS Runtime Monitoring
- [ ] Test alert generated and verified end-to-end
- [ ] Configuration documented and stored in `forgepay/compliance/pci-dss/evidence/req-5/`

---

### Task 1.2 — Deploy WAF for Payment-Engine Ingress

**PCI DSS Req:** 1.5.1, 6.4.1, 6.4.2
**Priority:** CRITICAL
**Owner:** DevSecOps Engineer / Infra Team
**Effort:** 1–2 weeks

**Background:** The payment-engine is publicly accessible via AWS ALB without a WAF. PCI DSS v4.0 Req 6.4.1 requires that public-facing web applications are protected by either a WAF or a code review process that addresses OWASP Top 10. A WAF is strongly preferred for an ongoing technical control.

**Recommended Solution:** AWS WAF v2 on the ALB fronting payment-engine

**Implementation Steps:**
1. Create WAF Web ACL with the following rule groups:
   - AWS Managed Rules: AWSManagedRulesCommonRuleSet (OWASP Top 10)
   - AWS Managed Rules: AWSManagedRulesSQLiRuleSet (SQLi protection)
   - AWS Managed Rules: AWSManagedRulesKnownBadInputsRuleSet
   - Rate limiting rule: 1000 requests/5 minutes per IP on payment endpoints
   - Geo-blocking rule if applicable (block high-risk geographies)
2. Associate WAF Web ACL with the payment-engine ALB
3. Enable WAF logging to S3 with 12-month retention
4. Review WAF logs weekly; tune false positive rules
5. Set WAF to Block mode (not Count mode) after 72-hour validation period
6. Document WAF configuration for QSA evidence

**Acceptance Criteria:**
- [ ] AWS WAF Web ACL associated with payment-engine ALB
- [ ] WAF in Block mode (not Count mode)
- [ ] WAF logs flowing to S3 with 12-month retention
- [ ] Test blocked request verified (e.g., SQLi attempt blocked, 403 returned)
- [ ] WAF configuration stored in IaC (Terraform or CDK)
- [ ] Evidence documented in `forgepay/compliance/pci-dss/evidence/req-6/`

---

### Task 1.3 — Implement SIEM / Automated Log Review

**PCI DSS Req:** 10.3.2, 10.4.1, 10.4.1.1, 10.4.2.1
**Priority:** CRITICAL
**Owner:** DevSecOps Engineer / SRE Team
**Effort:** 2–3 weeks (initial deployment); ongoing tuning

**Background:** Logs are collected via OpenTelemetry but there is no SIEM or automated log review system. PCI DSS v4.0 requires automated mechanisms for log analysis, alerting on anomalies, and log integrity protection.

**Recommended Solution Options:**
1. **AWS Security Hub + CloudWatch Logs Insights** — managed, lower cost, AWS-native
2. **OpenSearch (Elasticsearch) with OTEL integration** — self-hosted, more control
3. **Datadog SIEM** — commercial, strong PCI DSS support
4. **Splunk Cloud** — enterprise-grade, highest cost

**Recommended approach:** AWS Security Hub (aggregation + findings) + CloudWatch Logs with automated anomaly detection for initial compliance. Migrate to Datadog or Splunk as scale warrants.

**Implementation Steps:**
1. Enable AWS Security Hub in all accounts
2. Enable AWS Config Rules for CDE resources
3. Configure CloudWatch Log Groups for all CDE components with 13-month retention
4. Configure log integrity: enable S3 Object Lock (WORM) for log exports
5. Create CloudWatch Alarms / EventBridge rules for:
   - Authentication failures > threshold
   - Privilege escalation events
   - Network policy violations
   - Unauthorized API calls
   - Changes to security group or NetworkPolicy
6. Route all OTEL logs from CDE pods to CloudWatch via OTEL Collector
7. Configure PagerDuty/Slack integration for critical alerts
8. Implement Kubernetes audit log forwarding to CloudWatch
9. Document log sources, retention, and alert rules for QSA evidence

**Acceptance Criteria:**
- [ ] All CDE component logs flowing to CloudWatch with 13-month retention
- [ ] S3 log archive with Object Lock (immutable) configured
- [ ] Automated alerts configured for all events in Req 10.2.1 (invalid access, privilege use, etc.)
- [ ] Kubernetes audit logs enabled and forwarded
- [ ] CloudTrail enabled in all accounts for AWS API actions
- [ ] Test alert generated and verified (e.g., force a failed login, confirm alert fires)
- [ ] Evidence in `forgepay/compliance/pci-dss/evidence/req-10/`

---

### Task 1.4 — Draft Information Security Policy and Incident Response Plan

**PCI DSS Req:** 12.1.1, 12.1.2, 12.10.1
**Priority:** CRITICAL
**Owner:** CISO / Head of Compliance
**Effort:** 1 week (draft); review and approval in week 2

**Background:** No formal Information Security Policy or Incident Response Plan exists. These are foundational documents required by PCI DSS and must be approved by executive management before other policies can reference them.

**Deliverables:**
- `04_security_policies/information_security_policy.md` (in this package)
- `04_security_policies/incident_response_policy.md` (in this package)
- Signed approval page from executive management

**Acceptance Criteria:**
- [ ] Information Security Policy drafted and approved by executive management
- [ ] Incident Response Plan drafted and approved
- [ ] Both documents stored in compliance repository
- [ ] Distribution to all relevant personnel documented
- [ ] Evidence in `forgepay/compliance/pci-dss/evidence/req-12/`

---

### Task 1.5 — Deploy SAST and Dependency Scanning in CI/CD

**PCI DSS Req:** 6.2.3, 6.3.2
**Priority:** CRITICAL
**Owner:** Engineering Lead / DevSecOps
**Effort:** 1–2 weeks

**Background:** No static analysis or software composition analysis (SCA) is integrated into the CI/CD pipeline. Raw PAN processing code in payment-engine and pci-vault must be reviewed for security vulnerabilities before deployment.

**Implementation Steps:**
1. Integrate SAST into GitHub Actions CI pipeline for CDE services:
   - Rust (payment-engine): `cargo audit` + `cargo clippy` with deny warnings + `semgrep` with Rust ruleset
   - TypeScript services: `semgrep --config p/typescript` or `Snyk Code`
   - Python (mor-layer): `bandit` + `semgrep --config p/python`
2. Integrate SCA / dependency scanning:
   - Rust: `cargo audit` for CVE database check
   - All services: `Snyk` or `OWASP Dependency-Check`
3. Configure CI pipeline to fail builds with CRITICAL or HIGH CVEs in CDE services
4. Generate SBOM artifacts per release for CDE components (cyclonedx format)
5. Establish vulnerability remediation SLA: Critical 48h, High 7d, Medium 30d
6. Document pipeline configuration for QSA evidence

**Acceptance Criteria:**
- [ ] SAST running on every PR merge to CDE service branches
- [ ] SCA/dependency scan running on every PR merge
- [ ] SBOM generated per release for payment-engine and pci-vault
- [ ] Build fails on CRITICAL CVEs in CDE services
- [ ] Vulnerability remediation SLA defined and documented
- [ ] Evidence in `forgepay/compliance/pci-dss/evidence/req-6/`

---

## Sprint 2: Weeks 3–6 — High-Priority Gaps

### Task 2.1 — Engage ASV and Schedule First Vulnerability Scan

**PCI DSS Req:** 11.3.2, 11.3.2.1
**Priority:** HIGH (CRITICAL outcome — must complete before QSA)
**Owner:** Head of Compliance + DevSecOps
**Effort:** 1 week to engage; scan within 30 days

**Steps:**
1. Select ASV vendor (see `05_asv_scanning_guide.md` for vendor list and criteria)
2. Execute contract with ASV
3. Provide ASV with all external IP addresses and domains in scope:
   - AWS ALB IPs for payment-engine ingress
   - NAT gateway external IPs for CDE egress
   - Any directly reachable EC2 IPs in CDE subnets
4. Schedule and complete first quarterly scan
5. Review scan results; prioritize HIGH/CRITICAL findings
6. Remediate and re-scan until passing report achieved
7. Store passing scan reports (retain for 3 years)

**Acceptance Criteria:**
- [ ] ASV contract executed
- [ ] Scope document (IP list) provided to ASV
- [ ] First ASV scan completed
- [ ] All HIGH/CRITICAL findings remediated or disputed with documentation
- [ ] Passing ASV scan report obtained and stored
- [ ] Quarterly scan calendar set up for next 12 months

---

### Task 2.2 — Conduct Internal Vulnerability Scanning

**PCI DSS Req:** 11.3.1, 11.3.1.1, 11.3.1.3
**Priority:** HIGH
**Owner:** DevSecOps Engineer
**Effort:** 1 week setup; quarterly ongoing

**Recommended Tool:** Trivy (container image scanning) + Kubernetes vulnerability scanner (Trivy k8s or kube-bench)

**Steps:**
1. Deploy Trivy in CI/CD pipeline for container image scanning
2. Configure Trivy to scan all CDE container images for OS and package CVEs
3. Run kube-bench against CDE node groups to identify CIS Benchmark gaps
4. Configure authenticated network scanning for CDE hosts (Nessus Essentials or OpenVAS)
5. Set quarterly internal scan cadence
6. Remediation SLA: Critical 48h, High 7d

**Acceptance Criteria:**
- [ ] Container image scanning running on every build
- [ ] Kubernetes CIS Benchmark assessment completed (kube-bench)
- [ ] Authenticated host scan completed for CDE nodes
- [ ] Findings report generated and remediation tracked
- [ ] Quarterly scan schedule documented

---

### Task 2.3 — Formalize Account Lifecycle Management

**PCI DSS Req:** 8.2.4, 8.2.5, 8.2.6, 7.2.4
**Priority:** HIGH
**Owner:** Engineering Lead + HR
**Effort:** 1 week

**Steps:**
1. Document account lifecycle management procedure:
   - New hire: access request, approval, provisioning within 24h
   - Role change: access review and adjustment within 48h
   - Termination: access revocation within 1 hour of notification
   - Contractor: access scoped to project; reviewed quarterly
2. Implement automated detection of inactive accounts (>90 days no login):
   - AWS IAM: enable IAM Access Analyzer + credential report
   - Kubernetes RBAC: audit with `kubectl auth` for stale bindings
   - PostgreSQL: query pg_stat_activity for inactive roles
3. Perform immediate audit of all active accounts with CDE access
4. Remove or disable any accounts not meeting criteria

**Acceptance Criteria:**
- [ ] Account lifecycle policy documented and approved
- [ ] Account audit completed; stale accounts removed
- [ ] Automated detection of inactive accounts operational
- [ ] Termination procedure SLA (1 hour) documented and tested
- [ ] Evidence in `forgepay/compliance/pci-dss/evidence/req-8/`

---

### Task 2.4 — Implement IDS/IPS for CDE Network Monitoring

**PCI DSS Req:** 11.5.1, 11.5.1.1
**Priority:** HIGH
**Owner:** DevSecOps / SRE Team
**Effort:** 2 weeks

**Recommended Solution:**
- **AWS Network Firewall** with IDS signatures on CDE VPC traffic
- **Falco** (from Task 1.1) covers host-level detection
- Together these satisfy Req 11.5.1 for IDS/IPS on all CDE traffic

**Steps:**
1. Deploy AWS Network Firewall in CDE VPC with stateful inspection rules
2. Enable Suricata rule groups for CDE traffic (Emerging Threats IDS rules)
3. Configure VPC routing to route CDE traffic through Network Firewall
4. Configure Network Firewall alerts to CloudWatch/SIEM
5. Validate IDS alerts firing on test attack traffic

**Acceptance Criteria:**
- [ ] AWS Network Firewall deployed in CDE VPC
- [ ] Suricata rules enabled and current
- [ ] VPC traffic flowing through firewall inspection
- [ ] Test IDS alert generated and verified
- [ ] Evidence in `forgepay/compliance/pci-dss/evidence/req-11/`

---

### Task 2.5 — Immutable Audit Log Storage

**PCI DSS Req:** 10.3.2, 10.3.3
**Priority:** HIGH
**Owner:** DevSecOps / SRE
**Effort:** 1 week

**Steps:**
1. Create dedicated S3 bucket for audit log archival with:
   - S3 Object Lock in Compliance mode (cannot be overwritten or deleted)
   - 13-month retention period
   - SSE-KMS encryption
   - Access logging enabled
   - Public access blocked
2. Configure log export pipeline: CloudWatch → S3 (daily export via Lambda or Data Firehose)
3. Configure OTEL Collector to export CDE logs to S3 in addition to PostgreSQL
4. Validate integrity: SHA-256 hash of each log batch stored in separate manifest file
5. Document log retention configuration for QSA evidence

**Acceptance Criteria:**
- [ ] S3 bucket with Object Lock Compliance mode created
- [ ] All CDE audit logs exporting to S3 within 24 hours
- [ ] Log integrity hashes stored
- [ ] Deletion of log files blocked (tested)
- [ ] Evidence in `forgepay/compliance/pci-dss/evidence/req-10/`

---

### Task 2.6 — Network Diagram and Data Flow Documentation

**PCI DSS Req:** 1.2.3, 1.2.4
**Priority:** HIGH
**Owner:** Engineering Lead / Architect
**Effort:** 1 week

**Deliverables:**
1. Current network diagram showing all CDE components, network segments, and trust boundaries (AWS VPC layout, EKS cluster, ALB, RDS)
2. Data flow diagram showing all paths where CHD/SAD flows (from browser entry to vault tokenization to card network)
3. Change management process for keeping diagrams current

**Acceptance Criteria:**
- [ ] Network diagram created and approved
- [ ] Data flow diagram created and approved
- [ ] Both stored in `forgepay/compliance/pci-dss/evidence/req-1/`
- [ ] Change management process documented

---

### Task 2.7 — Key Management Policy and Rotation Schedule

**PCI DSS Req:** 3.6.1, 3.6.1.4
**Priority:** HIGH
**Owner:** DevSecOps + CISO
**Effort:** 1 week

**Steps:**
1. Document key management policy covering:
   - Key inventory (vault master key, DB encryption key, TLS certificates, signing keys)
   - Cryptoperiod for each key type (recommend: AES-256 data keys 1 year; TLS certs 1 year; signing keys 2 years)
   - Key rotation procedure
   - Key compromise procedure
   - Dual control requirements for vault master key operations
2. Configure automated key rotation in AWS KMS for vault master key
3. Configure ACM certificate auto-renewal
4. Test key rotation without service disruption

**Acceptance Criteria:**
- [ ] Key management policy approved
- [ ] Key inventory documented
- [ ] Automated KMS key rotation enabled
- [ ] ACM auto-renewal configured
- [ ] Key rotation tested without downtime
- [ ] Evidence in `forgepay/compliance/pci-dss/evidence/req-3/`

---

### Task 2.8 — Security Awareness Training Program

**PCI DSS Req:** 12.6.1, 12.6.2, 12.6.3, 12.6.3.1
**Priority:** HIGH
**Owner:** CISO / HR
**Effort:** 2 weeks to implement; annual ongoing

**Steps:**
1. Select security awareness training platform (KnowBe4, Proofpoint Security Awareness, or build in-house)
2. Define training curriculum:
   - PCI DSS overview and ForgePay's obligations
   - Phishing and social engineering awareness
   - Password security and MFA
   - Data handling procedures (no CHD in email, no test with real PANs)
   - Incident reporting procedures
   - Acceptable use policy acknowledgment
3. Assign training to all personnel with access to CDE (mandatory within 30 days of hire; annual refresh)
4. Track completion; 100% completion required for CDE access
5. Conduct phishing simulation within 60 days

**Acceptance Criteria:**
- [ ] Training platform selected and configured
- [ ] Training curriculum approved by CISO
- [ ] 100% completion by all CDE-access personnel
- [ ] Phishing simulation completed and results recorded
- [ ] Evidence in `forgepay/compliance/pci-dss/evidence/req-12/`

---

## Sprint 3: Weeks 7–10 — Medium Gaps

### Task 3.1 — CIS Benchmark Validation for Container Images and EKS Nodes

**PCI DSS Req:** 2.2.1, 2.2.4
**Priority:** MEDIUM
**Owner:** DevSecOps
**Effort:** 1 week

**Steps:**
1. Run `kube-bench` against EKS CDE node groups for CIS Kubernetes Benchmark
2. Run `docker-bench-security` against container build environment
3. Review all HIGH/CRITICAL findings from kube-bench
4. Remediate: disable unnecessary features, set security contexts, configure audit logging
5. Document exceptions with business justification
6. Configure kube-bench to run quarterly

---

### Task 3.2 — Formal Least-Privilege Audit for Service Accounts and Users

**PCI DSS Req:** 7.2.2, 7.2.5, 7.2.5.1, 7.3.3
**Priority:** MEDIUM
**Owner:** Engineering Lead / DevSecOps
**Effort:** 1 week

**Steps:**
1. Enumerate all Kubernetes ServiceAccounts in CDE namespaces
2. Review each ServiceAccount's ClusterRoleBinding / RoleBinding
3. Remove or reduce any permissions not required for the service's function
4. Enumerate all AWS IAM roles used by CDE pods (IRSA — IAM Roles for Service Accounts)
5. Review IAM policies for each role; apply least-privilege
6. Document each service account's required permissions
7. Set 6-month access review calendar

---

### Task 3.3 — Data Retention and Disposal Policy

**PCI DSS Req:** 3.2.1
**Priority:** MEDIUM
**Owner:** CISO + Engineering Lead
**Effort:** 1 week

**Steps:**
1. Document data retention schedule for all data types:
   - Payment records (tokens, transaction logs): retain 7 years (legal requirement)
   - Audit logs: retain 13 months online; archive 3 years total
   - CHD backups: not retained (Hyperswitch vault); document this
   - PII: per applicable privacy law (POPIA, GDPR)
2. Implement automated deletion for records past retention period
3. Document disposal procedure for decommissioned storage

---

### Task 3.4 — File Integrity Monitoring (FIM)

**PCI DSS Req:** 11.5.2
**Priority:** MEDIUM
**Owner:** DevSecOps
**Effort:** 1 week

**Recommended Solution:** Falco (already deployed in Task 1.1) covers file integrity monitoring at the container level. Additional host-level FIM:
- AIDE (Advanced Intrusion Detection Environment) on EKS nodes
- OR Wazuh agent on CDE nodes for FIM + log forwarding

**Steps:**
1. Configure Falco rules for file write events on critical paths in CDE containers
2. Deploy AIDE on CDE node groups (via DaemonSet or node configuration)
3. Configure AIDE to monitor: /etc, /bin, /sbin, /usr/bin, kernel modules
4. Set AIDE to run nightly; alert on changes
5. Route FIM alerts to SIEM/CloudWatch

---

### Task 3.5 — Acceptable Use Policy and Third-Party Risk Management

**PCI DSS Req:** 12.2.1, 12.8.x
**Priority:** MEDIUM
**Owner:** CISO + Legal
**Effort:** 1 week

**Steps:**
1. Draft Acceptable Use Policy covering: system use, data handling, internet use, BYOD, remote access
2. Obtain signed acknowledgment from all personnel
3. Draft Third-Party Service Provider Policy:
   - Inventory of all third parties with access to CDE or CHD
   - Annual review of each TPSPs PCI compliance status
   - Contractual requirements: PCI DSS compliance, breach notification, audit rights
4. Collect compliance documentation from key TPSPs: AWS (use AWS Artifact), Hyperswitch upstream

---

## Sprint 4: Weeks 11–12 — Documentation, Evidence Collection, and QSA Readiness

### Task 4.1 — Penetration Testing Engagement

**PCI DSS Req:** 11.4.1, 11.4.2, 11.4.3, 11.4.5, 11.4.6
**Priority:** CRITICAL (start engagement by Week 6; complete by Week 12)
**Owner:** Head of Compliance + CISO
**Effort:** 2–4 weeks for engagement; 1 week for remediation

**Note:** See `06_penetration_testing_scope.md` for full scope document.

**Steps:**
1. Develop penetration testing scope document (see `06_penetration_testing_scope.md`)
2. Issue RFP to 2–3 qualified penetration testing firms
3. Review proposals; select firm
4. Execute statement of work; coordinate with DevSecOps for test window
5. Conduct penetration test (internal + external + segmentation)
6. Receive findings report
7. Remediate all CRITICAL and HIGH findings
8. Conduct re-test of remediated findings
9. Store final report for QSA evidence (3-year retention)

---

### Task 4.2 — Formal Risk Assessment

**PCI DSS Req:** 12.3.1, 12.3.2
**Priority:** MEDIUM
**Owner:** CISO
**Effort:** 1 week

**Steps:**
1. Conduct annual risk assessment using NIST RMF or ISO 27005 methodology
2. Document:
   - Asset inventory for CDE
   - Threat scenarios
   - Likelihood and impact scoring
   - Risk treatment decisions (accept, mitigate, transfer, avoid)
3. Obtain executive approval of risk assessment results
4. Review and update annually

---

### Task 4.3 — Evidence Package Assembly

**PCI DSS Req:** All
**Priority:** HIGH
**Owner:** Head of Compliance
**Effort:** 1 week

**Steps:**
1. Create evidence folder structure per `07_evidence_collection_checklist.md`
2. Collect all artifacts listed in the checklist
3. Conduct internal pre-assessment walkthrough for each requirement
4. Identify any remaining gaps not yet remediated
5. Document compensating controls for any items that cannot be fully remediated before QSA engagement
6. Prepare QSA onboarding materials

---

### Task 4.4 — QSA Engagement Initiation

**PCI DSS Req:** All (assessment preparation)
**Priority:** HIGH
**Owner:** CISO + Head of Compliance
**Effort:** Ongoing (initiate by end of Day 90)

**Steps:**
1. Issue RFP to 3+ QSA firms (see `08_qsa_engagement_guide.md`)
2. Review proposals
3. Select QSA firm
4. Execute engagement letter
5. Schedule kickoff meeting
6. Begin document submission process

---

## Remediation Tracking Dashboard

Use this table to track status weekly. Update the Status column as tasks progress.

| Task | Owner | Priority | Target Date | Status |
|------|-------|----------|-------------|--------|
| 1.1 — Anti-malware / EDR | DevSecOps | CRITICAL | Week 2 | NOT STARTED |
| 1.2 — WAF deployment | DevSecOps / Infra | CRITICAL | Week 2 | NOT STARTED |
| 1.3 — SIEM / log automation | DevSecOps | CRITICAL | Week 3 | NOT STARTED |
| 1.4 — InfoSec Policy + IR Plan | CISO | CRITICAL | Week 2 | NOT STARTED |
| 1.5 — SAST / dependency scanning | Eng Lead | CRITICAL | Week 2 | NOT STARTED |
| 2.1 — ASV scanning | Compliance | HIGH | Week 6 | NOT STARTED |
| 2.2 — Internal vuln scanning | DevSecOps | HIGH | Week 4 | NOT STARTED |
| 2.3 — Account lifecycle | Eng Lead + HR | HIGH | Week 4 | NOT STARTED |
| 2.4 — IDS/IPS (Network Firewall) | DevSecOps | HIGH | Week 5 | NOT STARTED |
| 2.5 — Immutable audit logs | DevSecOps | HIGH | Week 4 | NOT STARTED |
| 2.6 — Network + data flow diagrams | Engineering | HIGH | Week 4 | NOT STARTED |
| 2.7 — Key management policy | DevSecOps + CISO | HIGH | Week 5 | NOT STARTED |
| 2.8 — Security awareness training | CISO / HR | HIGH | Week 6 | NOT STARTED |
| 3.1 — CIS Benchmark validation | DevSecOps | MEDIUM | Week 8 | NOT STARTED |
| 3.2 — Least-privilege audit | Eng Lead | MEDIUM | Week 8 | NOT STARTED |
| 3.3 — Data retention policy | CISO | MEDIUM | Week 8 | NOT STARTED |
| 3.4 — File integrity monitoring | DevSecOps | MEDIUM | Week 9 | NOT STARTED |
| 3.5 — AUP + third-party risk | CISO + Legal | MEDIUM | Week 10 | NOT STARTED |
| 4.1 — Penetration testing | Compliance | CRITICAL | Week 12 | NOT STARTED |
| 4.2 — Risk assessment | CISO | MEDIUM | Week 11 | NOT STARTED |
| 4.3 — Evidence package | Compliance | HIGH | Week 12 | NOT STARTED |
| 4.4 — QSA engagement | CISO | HIGH | Week 12 | NOT STARTED |

---

*Document Owner: CISO / Head of Compliance*
*Classification: Confidential — Internal Use Only*
*Last Updated: 2026-06-25*
*Review Cadence: Weekly during remediation period*
