# PCI DSS v4.0 Gap Analysis — ForgePay

## Overview

This gap analysis assesses ForgePay's current state against all 12 PCI DSS v4.0 requirements. It is based on the platform architecture as of June 2026 and should be re-assessed after each significant change or at minimum annually.

**Assessment Scope:** CDE components only (Hyperswitch payment-engine, PCI vault, payment-engine PostgreSQL, AWS ALB, connected-to systems). See `01_scope_definition.md` for full scope definition.

**PCI DSS Version:** v4.0 (all future-dated requirements with target date March 31, 2025 are now mandatory)

### Gap Status Legend

| Status | Meaning |
|--------|---------|
| COMPLIANT | Control is in place and meets PCI DSS requirements |
| PARTIAL | Control exists but has gaps or is not fully documented |
| GAP | Control is missing or does not meet requirements |
| N/A | Requirement not applicable (with documented justification) |

### Priority Legend

| Priority | Meaning | Remediation Timeframe |
|----------|---------|----------------------|
| CRITICAL | Control failure poses immediate CHD exposure risk | Within 30 days |
| HIGH | Significant control gap that must be resolved before QSA engagement | Within 60 days |
| MEDIUM | Gap that will result in a finding but low immediate risk | Within 90 days |
| LOW | Documentation or process improvement | Before QSA assessment |

---

## Requirement 1: Install and Maintain Network Security Controls

### 1.1 Processes and mechanisms for installing and maintaining network security controls are defined and understood.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 1.1.1 | All security policies for Req 1 documented, current, in use | PARTIAL | Network security policies drafted but not formally approved or reviewed | MEDIUM |
| 1.1.2 | Roles and responsibilities for Req 1 defined | PARTIAL | Roles not formally assigned in documented RACI | MEDIUM |

### 1.2 Network security controls are configured and maintained.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 1.2.1 | Configuration standards for NSCs defined | PARTIAL | Kubernetes NetworkPolicy exists; no formal written standard with review cadence | MEDIUM |
| 1.2.2 | All changes to NSCs managed per change management process | GAP | No formal change management process documented for NetworkPolicy changes | HIGH |
| 1.2.3 | Network diagram accurate and current | PARTIAL | Diagram exists in architecture docs; not kept current after changes | HIGH |
| 1.2.4 | Data flow diagrams accurate and current | PARTIAL | See `01_scope_definition.md`; not formally maintained with change process | HIGH |
| 1.2.5 | All services, protocols, ports in NSCs are required and approved | PARTIAL | Not formally inventoried and approved | MEDIUM |
| 1.2.6 | Security features for all in-use protocols documented | GAP | Protocol security features (e.g., TLS cipher suites) not formally documented | MEDIUM |
| 1.2.7 | NSC configurations reviewed at least every 6 months | GAP | No formal review cadence established | HIGH |
| 1.2.8 | NSC config files protected from unauthorized access and inconsistencies | COMPLIANT | Kubernetes RBAC controls access to NetworkPolicy objects; ArgoCD manages config | — |

### 1.3 Network access to and from the CDE is restricted.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 1.3.1 | Inbound traffic to CDE restricted to necessary traffic | COMPLIANT | Kubernetes NetworkPolicy deny-all with allowlist in place | — |
| 1.3.2 | Outbound traffic from CDE restricted to necessary traffic | PARTIAL | Egress policies in place; not all egress paths formally reviewed and documented | HIGH |
| 1.3.3 | NSCs prevent spoofed source IP addresses entering CDE | COMPLIANT | AWS VPC + ALB handles anti-spoofing at network boundary | — |

### 1.4 Network connections between trusted and untrusted networks are controlled.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 1.4.1 | NSCs in place between trusted/untrusted networks | COMPLIANT | ALB + Kubernetes NetworkPolicy | — |
| 1.4.2 | Inbound traffic from untrusted networks denied except necessary | COMPLIANT | ALB security groups restrict inbound | — |
| 1.4.3 | Anti-spoofing measures implemented | COMPLIANT | AWS VPC provides this | — |
| 1.4.4 | System components storing CHD are not directly accessible from untrusted network | COMPLIANT | PCI vault and payment DB in private subnets; no public access | — |
| 1.4.5 | Disclosure of internal IP addresses restricted | PARTIAL | Not formally validated | LOW |

### 1.5 Risks from connecting to untrusted networks are addressed.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 1.5.1 | Security controls on devices connecting from untrusted networks | GAP | No mobile device management (MDM) or endpoint assessment for admin workstations | HIGH |

**Req 1 Summary — Key Gaps:**
- WAF is not yet configured (protects against application-layer attacks at ingress) — CRITICAL
- No formal NSC change management process
- Network and data flow diagrams not formally maintained with change control
- Egress controls not formally reviewed and documented

---

## Requirement 2: Apply Secure Configurations to All System Components

### 2.2 System components are configured and managed securely.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 2.2.1 | Configuration standards developed for all system components | PARTIAL | Helm charts with securityContext defined; no formal CIS Benchmark validation | HIGH |
| 2.2.2 | Vendor default accounts managed | PARTIAL | Default credentials changed for known services; no formal inventory | HIGH |
| 2.2.3 | All insecure services, protocols, daemons prohibited | PARTIAL | No formal inventory of all running services/ports on CDE nodes | HIGH |
| 2.2.4 | Only necessary functionality enabled (hardening) | PARTIAL | Container images not validated against hardening standards (CIS Docker Benchmark) | HIGH |
| 2.2.5 | Insecure services documented with business justification | GAP | No documented justification process | MEDIUM |
| 2.2.6 | System security parameters prevent misuse | PARTIAL | Security contexts set in Helm; not all parameters formally validated | MEDIUM |
| 2.2.7 | All non-console admin access encrypted | COMPLIANT | SSH via bastion with TLS; SSM Session Manager used | — |

### 2.3 Wireless environments are configured and managed securely.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 2.3.1 | Wireless access points use strong encryption | N/A | AWS-hosted; no wireless infrastructure owned by ForgePay in CDE | — |
| 2.3.2 | All wireless vendor defaults changed | N/A | Same justification | — |

**Req 2 Summary — Key Gaps:**
- No CIS Benchmark validation for container images or Kubernetes node configurations
- No formal inventory of all services, protocols, and ports on CDE components
- Vendor default account management not formally documented

---

## Requirement 3: Protect Stored Account Data

### 3.1 Processes and mechanisms for protecting stored account data are defined and understood.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 3.1.1 | All security policies for Req 3 documented | PARTIAL | Vault architecture documented; no formal data retention policy | MEDIUM |
| 3.1.2 | Roles and responsibilities defined | PARTIAL | Not formally assigned | MEDIUM |

### 3.2 Storage of account data is kept to a minimum.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 3.2.1 | Data retention and disposal policies implemented | GAP | No formal data retention schedule or disposal procedure for payment records | HIGH |
| 3.2.2 | SAD not retained after authorization | COMPLIANT | Hyperswitch PCI vault does not retain CVV/CVV2; SAD cleared after auth | — |
| 3.2.3 | SAD not stored on magnetic stripe/chip | COMPLIANT | No physical card reading capability; CNP transactions only | — |

### 3.3 Sensitive authentication data (SAD) is not stored after authorization.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 3.3.1 | SAD (full track data, card verification codes, PINs) not retained after authorization | COMPLIANT | Hyperswitch architecture ensures this | — |
| 3.3.2 | SAD encrypted if stored before authorization completion | COMPLIANT | Hyperswitch handles in-flight encryption | — |
| 3.3.3 | Encryption keys protecting SAD managed per Req 3.7 | COMPLIANT | Vault keys in AWS Secrets Manager | — |

### 3.4 Access to displays of full PAN and ability to copy PAN are restricted.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 3.4.1 | PAN masked when displayed | COMPLIANT | Hyperswitch displays truncated PAN only (first 6 + last 4) | — |
| 3.4.2 | Technical controls prevent copying/relaying of PAN | PARTIAL | Controls in place in vault; audit log of all PAN access not verified | MEDIUM |

### 3.5 Primary account number (PAN) is secured wherever it is stored.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 3.5.1 | PAN stored in unreadable form (hashing, truncation, encryption) | COMPLIANT | PAN encrypted with AES-256 in Hyperswitch vault; payment-engine stores tokens only | — |
| 3.5.1.1 | Hashed PANs use keyed cryptographic hash | N/A | PANs encrypted, not hashed | — |
| 3.5.1.2 | If disk-level encryption used, logical access managed separately | COMPLIANT | RDS encryption at rest + separate key management | — |
| 3.5.1.3 | Disk-level encryption not used as sole PAN protection | COMPLIANT | Application-level encryption in vault is primary | — |

### 3.6 Cryptographic keys protecting stored account data are secured.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 3.6.1 | Key management procedures and processes documented | PARTIAL | AWS Secrets Manager rotation configured; key management policy not formally documented | HIGH |
| 3.6.1.1 | Additional requirement: secret shares, dual control | PARTIAL | AWS KMS CMK used; not formally validated for dual control | HIGH |
| 3.6.1.2 | Secret keys stored securely | COMPLIANT | Vault master keys in AWS Secrets Manager/KMS | — |
| 3.6.1.3 | Cryptographic key minimum lengths/algorithms | PARTIAL | AES-256 in use; not formally inventoried for all keys | MEDIUM |
| 3.6.1.4 | Cryptographic key changes at the end of cryptoperiod | GAP | No defined cryptoperiod or key rotation schedule | HIGH |

**Req 3 Summary — Key Gaps:**
- No formal data retention schedule or disposal procedure
- Key management policy not documented (rotation schedule, cryptoperiods, dual control)

---

## Requirement 4: Protect Cardholder Data with Strong Cryptography During Transmission

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 4.2.1 | Strong cryptography used for CHD in transit | COMPLIANT | TLS 1.2+ enforced; TLS 1.3 preferred; certificates from ACM | — |
| 4.2.1.1 | Certificate inventory maintained | PARTIAL | ACM manages certs; no formal inventory with expiry tracking | MEDIUM |
| 4.2.1.2 | Only trusted keys/certs accepted | PARTIAL | Certificate pinning not implemented; mTLS validates server certs | MEDIUM |
| 4.2.2 | PANs protected with strong cryptography when sent via messaging | N/A | ForgePay does not send PANs via email/messaging | — |

**Req 4 Summary:** Strong position. Minor gaps in certificate inventory management.

---

## Requirement 5: Protect All Systems and Networks from Malicious Software

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 5.2.1 | Anti-malware solution deployed on all applicable system components | GAP | No AV/EDR on container hosts or EKS nodes in CDE | CRITICAL |
| 5.2.2 | Anti-malware solution capable of detecting all types of malware | GAP | Same — no solution in place | CRITICAL |
| 5.2.3 | Anti-malware solution for systems not commonly affected by malware evaluated | PARTIAL | Linux containers — assessment not formally documented | HIGH |
| 5.2.3.1 | Evaluation of systems not commonly affected by malware at least every 12 months | GAP | No formal evaluation performed | HIGH |
| 5.3.1 | Anti-malware solution actively running | GAP | No solution deployed | CRITICAL |
| 5.3.2 | Anti-malware solution generates audit logs | GAP | No solution deployed | CRITICAL |
| 5.3.3 | Anti-malware config protected from modification | GAP | No solution deployed | CRITICAL |
| 5.3.4 | Anti-malware solution logs retained per Req 10.7 | GAP | No solution deployed | CRITICAL |
| 5.3.5 | Anti-malware mechanisms cannot be disabled by users | GAP | No solution deployed | CRITICAL |
| 5.4.1 | Phishing protection mechanisms implemented | PARTIAL | Email filtering in place; no anti-phishing controls for admin console access | HIGH |

**Req 5 Summary — CRITICAL:** No anti-malware/EDR solution deployed on CDE nodes. This is a critical gap that must be resolved before QSA engagement. Options: Falco (open source, Kubernetes-native), AWS GuardDuty (node-level threat detection), or commercial EDR (CrowdStrike Falcon, SentinelOne).

---

## Requirement 6: Develop and Maintain Secure Systems and Software

### 6.2 Bespoke and custom software is developed securely.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 6.2.1 | Bespoke and custom software developed per secure coding guidelines | PARTIAL | No formal secure coding standard documented; developers not formally trained | HIGH |
| 6.2.2 | Software development personnel trained on secure coding | GAP | No formal secure coding training program | HIGH |
| 6.2.3 | Bespoke/custom software reviewed prior to release to detect vulnerabilities | GAP | No SAST tooling integrated into CI/CD pipeline | CRITICAL |
| 6.2.3.1 | For web-based applications, automated scanning for common vulnerabilities | GAP | No DAST scanning configured | HIGH |
| 6.2.4 | Software engineering techniques to prevent/mitigate common vulnerabilities | PARTIAL | Some secure practices followed but not formally required | MEDIUM |

### 6.3 Security vulnerabilities are identified and addressed.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 6.3.1 | Security vulnerabilities identified using reputable sources | PARTIAL | Ad hoc monitoring; no formal vulnerability intelligence subscription | HIGH |
| 6.3.2 | Software component inventory maintained | GAP | No formal software bill of materials (SBOM) or software composition analysis (SCA) | CRITICAL |
| 6.3.3 | All system components protected from known vulnerabilities | PARTIAL | Manual patching; no formal patch management process | HIGH |

### 6.4 Public-facing web applications are protected against attacks.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 6.4.1 | For public-facing web applications, either WAF or code review addresses vulnerabilities | GAP | Neither WAF nor formal code review process in place | CRITICAL |
| 6.4.2 | For public-facing web applications, automated technical solution detects and prevents attacks | GAP | WAF not configured | CRITICAL |

### 6.5 Changes to all system components are managed securely.

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 6.5.1 | Changes to all system components managed per change management process | PARTIAL | Informal process; no formal change management policy | HIGH |
| 6.5.2 | After change, all PCI DSS requirements verified still in place | GAP | No formal post-change PCI validation process | HIGH |
| 6.5.3 | Pre-production environments separate from production | PARTIAL | Separate staging namespace; not fully documented | MEDIUM |
| 6.5.4 | Roles and responsibilities for change management defined | GAP | Not formally assigned | MEDIUM |
| 6.5.5 | Live PANs not used in pre-production environments | COMPLIANT | Vault architecture ensures this — no raw PANs in any environment | — |
| 6.5.6 | Test data and accounts removed before production | PARTIAL | Not formally validated per deployment | MEDIUM |

**Req 6 Summary — CRITICAL:** WAF missing (affects 6.4.1 and 6.4.2). SAST/SCA missing. No dependency scanning. These are among the highest-priority remediation items.

---

## Requirement 7: Restrict Access to System Components and Cardholder Data by Business Need to Know

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 7.2.1 | All user IDs and authentication factors managed throughout lifecycle | PARTIAL | Lifecycle process exists; not formally documented | MEDIUM |
| 7.2.2 | Access is assigned to users based on job classification and function | PARTIAL | RBAC implemented; least-privilege audit not performed | HIGH |
| 7.2.3 | Required privileges approved by authorized personnel | PARTIAL | Informal approval; no access request system | HIGH |
| 7.2.4 | All user accounts and related access privileges reviewed every 6 months | GAP | No formal access review cadence | HIGH |
| 7.2.5 | All application and system accounts and related access privileges assigned per least privilege | PARTIAL | Service accounts exist; not formally audited for least privilege | HIGH |
| 7.2.5.1 | All access by application/system accounts managed by policies that include least privilege | GAP | No formal policy for service accounts | HIGH |
| 7.2.6 | All access to query repositories of account data governed by least privilege | PARTIAL | PostgreSQL RBAC in place; not formally audited | HIGH |
| 7.3.1 | Access control system controls all access to system components | COMPLIANT | Kubernetes RBAC + AWS IAM + PostgreSQL roles | — |
| 7.3.2 | Access control system configured to enforce deny-all unless explicitly allowed | COMPLIANT | NetworkPolicy default-deny; IAM deny-all by default | — |
| 7.3.3 | Access control system is current and reviewed at least every 6 months | GAP | No review cadence established | HIGH |

**Req 7 Summary:** RBAC is implemented but not formally audited or documented. Least-privilege audit needed for all service accounts and user accounts.

---

## Requirement 8: Identify Users and Authenticate Access to System Components

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 8.2.1 | All users assigned unique ID | COMPLIANT | No shared user accounts; each engineer has unique identity | — |
| 8.2.2 | Group, shared, or generic accounts managed | PARTIAL | Policy against shared accounts exists; formal enforcement not documented | MEDIUM |
| 8.2.3 | Additional requirement: all user IDs, auth factors for non-consumer users reviewed at least every 12 months | GAP | No formal review process | HIGH |
| 8.2.4 | Additions, deletions, modifications managed throughout account lifecycle | PARTIAL | Informal offboarding; no formal account lifecycle management | HIGH |
| 8.2.5 | Access for terminated users immediately revoked | PARTIAL | Informal process; no SLA for revocation | HIGH |
| 8.2.6 | Inactive user accounts removed or disabled within 90 days | GAP | No automated detection or process for inactive accounts | HIGH |
| 8.2.7 | Accounts used by third parties managed | PARTIAL | Third-party access granted ad hoc; no formal policy | HIGH |
| 8.2.8 | Users inactive for >15 minutes required to re-authenticate | PARTIAL | Session timeout configured in some systems; not uniformly applied | MEDIUM |
| 8.3.4 | Invalid authentication attempts locked out after max 10 attempts | PARTIAL | JWT auth has lockout; not confirmed for all system access paths | HIGH |
| 8.3.6 | Passwords/passphrases minimum 12 characters (v4.0 requirement) | PARTIAL | Password policy exists; minimum length not confirmed as 12 | HIGH |
| 8.3.9 | Passwords/passphrases changed at least every 90 days | PARTIAL | Policy exists; enforcement not confirmed for all systems | MEDIUM |
| 8.4.2 | MFA for all access to CDE | COMPLIANT | JWT + MFA implemented for admin access | — |
| 8.4.3 | MFA for all remote network access | COMPLIANT | MFA required for VPN/bastion access | — |
| 8.6.1 | System/application accounts managed with interactive login restrictions | PARTIAL | Service accounts in Kubernetes; interactive login capabilities not formally restricted | MEDIUM |
| 8.6.2 | Passwords for interactive application/system accounts not hard-coded | COMPLIANT | Secrets in AWS Secrets Manager; not hardcoded | — |
| 8.6.3 | Passwords for application/system accounts protected against misuse | PARTIAL | Rotation configured; formal policy not documented | MEDIUM |

**Req 8 Summary:** MFA is in place (strong). Key gaps: inactive account management, formal account lifecycle, offboarding SLA.

---

## Requirement 9: Restrict Physical Access to Cardholder Data

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 9.1.1 | Security policies for Req 9 documented | PARTIAL | Inherited AWS controls; no ForgePay physical security policy | MEDIUM |
| 9.2.x | Physical access controls to sensitive areas | COMPLIANT | AWS data centers handle this; ForgePay inherits AWS SOC 2 physical controls | — |
| 9.3.x | Physical access for personnel and visitors | COMPLIANT | AWS responsibility; confirmed via AWS Artifact SOC reports | — |
| 9.4.x | Media with cardholder data secured | N/A | No physical media; all data in AWS managed storage | — |
| 9.5.x | Point-of-interaction (POI) devices protected | N/A | ForgePay is card-not-present only; no POI devices | — |

**Req 9 Summary:** AWS handles physical security. ForgePay must obtain and maintain AWS SOC 2 reports to evidence inherited controls. Gaps: formal policy documenting the inherited controls model.

---

## Requirement 10: Log and Monitor All Access to System Components and Cardholder Data

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 10.2.1 | Audit logs capture all user access to CHD | PARTIAL | OTEL logging in place; coverage of all CHD access not formally validated | HIGH |
| 10.2.1.1 | Audit logs for all individual user access to CHD | PARTIAL | Not confirmed for all access paths (e.g., direct DB access) | HIGH |
| 10.2.1.2 | Audit logs for all actions by root/admin | PARTIAL | CloudTrail captures AWS admin actions; Kubernetes audit logs not confirmed | HIGH |
| 10.2.1.3 | Audit logs for all access to audit logs | GAP | Log access not audited | HIGH |
| 10.2.1.4 | Audit logs for invalid access attempts | PARTIAL | Auth failures logged; not confirmed for all systems | MEDIUM |
| 10.2.1.5 | Audit logs for use of privilege escalation mechanisms | PARTIAL | Not formally validated | HIGH |
| 10.2.1.6 | Audit logs for use of identity/authentication mechanisms | PARTIAL | JWT issuance logged; not all auth mechanisms confirmed | MEDIUM |
| 10.2.1.7 | Audit logs for creation/deletion of system-level objects | PARTIAL | Kubernetes audit log not confirmed enabled for CDE namespaces | HIGH |
| 10.2.2 | Audit logs record specific data elements | PARTIAL | OTEL captures most fields; not formally validated against PCI requirements | HIGH |
| 10.3.1 | Read access to audit logs limited to those with job-related need | PARTIAL | PostgreSQL log access controls; not formally reviewed | MEDIUM |
| 10.3.2 | Audit log files protected against modifications | GAP | Logs stored in PostgreSQL; no immutable log store (e.g., S3 with Object Lock) | CRITICAL |
| 10.3.3 | Audit log files backed up promptly to different media | GAP | No separate backup of audit logs confirmed | HIGH |
| 10.3.4 | File integrity monitoring on audit logs | GAP | No FIM implemented | HIGH |
| 10.4.1 | Automated audit log reviews for all system components | GAP | No SIEM or automated log review system | CRITICAL |
| 10.4.1.1 | Automated mechanisms used for audit log reviews | GAP | Manual only; no automated alerting | CRITICAL |
| 10.4.2 | Reviews of all other system components at least every 12 months | GAP | No review cadence | HIGH |
| 10.4.2.1 | Reviews completed using automated analysis | GAP | No SIEM | CRITICAL |
| 10.4.3 | Exceptions and anomalies identified during review addressed | GAP | No process defined | HIGH |
| 10.5.1 | Retain audit logs for at least 12 months; 3 months online | PARTIAL | Retention period not formally configured | HIGH |
| 10.6.1 | System clocks synchronized using NTP | PARTIAL | AWS NTP used; not formally documented | LOW |
| 10.7.1 | Failures of critical security controls detected and reported | GAP | No automated alerting on security control failures | HIGH |
| 10.7.2 | Failures of critical security controls responded to promptly | GAP | No process defined | HIGH |

**Req 10 Summary — CRITICAL:** No SIEM or automated log review. Audit log integrity not protected (no immutable log store). These are critical gaps for PCI DSS compliance.

---

## Requirement 11: Test Security of Systems and Networks Regularly

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 11.2.1 | Wireless access point scanning at least every 3 months | N/A | No wireless in CDE; AWS-hosted | — |
| 11.3.1 | Internal vulnerability scans run at least every 3 months | GAP | No internal vulnerability scanning configured | CRITICAL |
| 11.3.1.1 | Internal scans conducted by qualified personnel | GAP | No process in place | CRITICAL |
| 11.3.1.2 | Internal scans performed after significant changes | GAP | No process in place | HIGH |
| 11.3.1.3 | Internal vulnerability scans using authenticated scanning | GAP | No scanning configured | CRITICAL |
| 11.3.2 | External vulnerability scans run at least every 3 months by ASV | GAP | No ASV scans configured | CRITICAL |
| 11.3.2.1 | External scans repeated until no high vulnerabilities | GAP | No scans performed | CRITICAL |
| 11.4.1 | Penetration testing methodology defined | GAP | No methodology defined or documented | CRITICAL |
| 11.4.2 | Internal penetration test at least every 12 months | GAP | No pen test performed | CRITICAL |
| 11.4.3 | External penetration test at least every 12 months | GAP | No pen test performed | CRITICAL |
| 11.4.4 | Exploitable vulnerabilities from pen test corrected; re-test performed | GAP | No pen test performed | CRITICAL |
| 11.4.5 | Network segmentation tested at least every 6 months | GAP | Kubernetes NetworkPolicy exists but not validated by pen test | CRITICAL |
| 11.4.6 | For service providers: pen test every 6 months | GAP | No pen test performed | CRITICAL |
| 11.5.1 | IDS/IPS deployed to monitor all traffic in CDE | GAP | No IDS/IPS deployed | CRITICAL |
| 11.5.1.1 | IDS/IPS detects, alerts, prevents covert communications | GAP | No IDS/IPS | CRITICAL |
| 11.5.2 | FIM deployed to alert on unauthorized changes | GAP | No FIM deployed | HIGH |
| 11.6.1 | Change and tamper detection mechanism for payment pages | PARTIAL | Server-side controls in place; client-side change detection not implemented | HIGH |

**Req 11 Summary — CRITICAL:** This requirement has the most critical gaps. No ASV scanning, no penetration testing, no IDS/IPS, no FIM. This is the largest remediation effort required.

---

## Requirement 12: Support Information Security with Organizational Policies and Programs

| Sub-Req | Description | Status | Finding | Priority |
|---------|-------------|--------|---------|----------|
| 12.1.1 | Overall information security policy established and published | GAP | No formal InfoSec policy document | CRITICAL |
| 12.1.2 | InfoSec policy reviewed at least once every 12 months | GAP | No policy; no review process | HIGH |
| 12.1.3 | InfoSec policy defines roles and responsibilities | GAP | Not documented | HIGH |
| 12.1.4 | CISO or equivalent assigned | PARTIAL | Role exists; formal charter not documented | MEDIUM |
| 12.2.1 | Acceptable use policies defined and implemented | GAP | No AUP documented | HIGH |
| 12.3.1 | Risk assessment process defined, performed at least annually | GAP | No formal risk assessment process | HIGH |
| 12.3.2 | Targeted risk analysis for customized implementation | GAP | Not performed | HIGH |
| 12.3.3 | All cryptographic suites and protocols reviewed at least every 12 months | GAP | No review process | MEDIUM |
| 12.3.4 | Hardware and software technologies reviewed at least every 12 months | GAP | No review process | MEDIUM |
| 12.4.1 | For service providers: executive management responsibility defined | PARTIAL | Informal; not formally documented | HIGH |
| 12.5.1 | Inventory of all hardware and software in PCI DSS scope maintained | GAP | No formal asset inventory for CDE | CRITICAL |
| 12.5.2 | PCI DSS scope documented and confirmed at least every 12 months | PARTIAL | This document addresses it; not yet a formal process | HIGH |
| 12.5.3 | Significant changes to PCI DSS scope documented and communicated | GAP | No process | HIGH |
| 12.6.1 | Security awareness program in place | GAP | No formal security awareness program | HIGH |
| 12.6.2 | Security awareness program reviewed at least once every 12 months | GAP | No program | HIGH |
| 12.6.3 | Personnel receive security awareness training at hire and annually | GAP | No formal security training | HIGH |
| 12.6.3.1 | Training includes phishing and social engineering awareness | GAP | Not implemented | HIGH |
| 12.6.3.2 | Training acknowledges understanding of acceptable use policies | GAP | No AUP or training | HIGH |
| 12.7.1 | Potential personnel risks assessed prior to employment | PARTIAL | Background checks performed informally; not documented | MEDIUM |
| 12.8.x | Risk associated with third parties managed | PARTIAL | Third-party risk assessment process not formalized | HIGH |
| 12.9.x | Third-party service providers support customers' PCI compliance | PARTIAL | AWS compliance confirmed; Hyperswitch upstream compliance not formally evaluated | HIGH |
| 12.10.1 | Incident response plan exists and is ready to execute | GAP | No formal incident response plan | CRITICAL |
| 12.10.2 | IR plan tested at least once every 12 months | GAP | No plan; no test | HIGH |
| 12.10.3 | Specific personnel designated 24/7 for incident response | GAP | No formal designations | HIGH |
| 12.10.4 | IR personnel trained | GAP | No training | HIGH |
| 12.10.5 | Alerts from security monitoring included in IR plan | GAP | No plan; no alerting | HIGH |
| 12.10.6 | IR plan modified as needed | GAP | No plan | HIGH |
| 12.10.7 | IR procedures for payment page skimming defined | GAP | No procedures | HIGH |

**Req 12 Summary — CRITICAL:** Multiple foundational policy gaps. No InfoSec policy, no incident response plan, no security awareness training, no asset inventory, no risk assessment process. These must be the first remediation priority.

---

## Executive Gap Summary

| Requirement | Status | Critical Gaps | Priority |
|-------------|--------|--------------|----------|
| Req 1 — Network Security Controls | PARTIAL | WAF missing | HIGH |
| Req 2 — Secure Configurations | PARTIAL | No CIS Benchmark validation | HIGH |
| Req 3 — Protect Stored Data | PARTIAL | Key management policy, data retention | HIGH |
| Req 4 — Data in Transit | PARTIAL | Certificate inventory | MEDIUM |
| Req 5 — Anti-Malware | GAP | No AV/EDR on CDE nodes | CRITICAL |
| Req 6 — Secure Software | GAP | No SAST, SCA, WAF | CRITICAL |
| Req 7 — Restrict Access | PARTIAL | Least-privilege audit needed | HIGH |
| Req 8 — Identify Users | PARTIAL | Account lifecycle management | HIGH |
| Req 9 — Physical Security | COMPLIANT | None (AWS inherited) | LOW |
| Req 10 — Logging and Monitoring | GAP | No SIEM, log integrity | CRITICAL |
| Req 11 — Test Security | GAP | No ASV, pen test, IDS/IPS, FIM | CRITICAL |
| Req 12 — InfoSec Policies | GAP | No policies, no IR plan | CRITICAL |

**Overall Compliance Readiness: ~35% — Significant remediation required before QSA engagement.**

---

*Document Owner: CISO / Head of Compliance*
*Classification: Confidential — Internal Use Only*
*Last Updated: 2026-06-25*
*Review Cadence: After each significant change; minimum quarterly during remediation*
