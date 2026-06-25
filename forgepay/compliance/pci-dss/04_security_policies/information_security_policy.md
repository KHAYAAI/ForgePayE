# Information Security Policy

**Document ID:** ISP-001
**Version:** 1.0
**Classification:** Confidential — Internal Use Only
**Effective Date:** [DATE OF EXECUTIVE APPROVAL]
**Next Review Date:** [EFFECTIVE DATE + 12 MONTHS]
**PCI DSS Reference:** Requirement 12.1, 12.1.1, 12.1.2, 12.1.3, 12.1.4

---

## 1. Purpose

This Information Security Policy ("Policy") establishes the principles, requirements, and responsibilities for protecting ForgePay's information assets, systems, and data. It is the master policy from which all subordinate security policies, standards, procedures, and guidelines are derived.

ForgePay operates a payment orchestration platform that processes cardholder data (CHD) on behalf of merchants. The confidentiality, integrity, and availability of payment systems and the data they handle are essential to ForgePay's business, merchant relationships, and legal obligations.

---

## 2. Scope

This Policy applies to:

- **All ForgePay personnel:** full-time employees, part-time employees, contractors, consultants, and temporary workers (collectively "personnel")
- **All information assets:** data, systems, applications, infrastructure, and physical assets owned, leased, or operated by ForgePay
- **All third parties:** vendors, service providers, partners, and any external party with access to ForgePay systems or data
- **All environments:** production, staging, development, and disaster recovery
- **All locations:** ForgePay offices, home offices, remote work locations, and cloud environments

This Policy has heightened applicability to the **Cardholder Data Environment (CDE)** as defined in `01_scope_definition.md`. Controls that apply specifically to the CDE are called out where relevant.

---

## 3. Definitions

| Term | Definition |
|------|-----------|
| **Cardholder Data (CHD)** | Primary Account Number (PAN), cardholder name, expiration date, and/or service code |
| **Sensitive Authentication Data (SAD)** | Full track data, card verification codes (CVV/CVV2/CVC), and PINs |
| **Cardholder Data Environment (CDE)** | Systems and network components that store, process, or transmit CHD or SAD, and systems connected to them |
| **Information Asset** | Any data, software, hardware, network, facility, or service that has value to ForgePay |
| **Incident** | Any actual or suspected unauthorized access, use, disclosure, modification, or destruction of information assets |
| **Risk** | The potential for loss or harm related to technical infrastructure or the use of technology |
| **System Component** | Any network component, server, computing device, or application within the CDE or connected to it |

---

## 4. Governance Structure

### 4.1 Roles and Responsibilities

#### Chief Information Security Officer (CISO)
- Owns and is accountable for the information security program
- Reviews and approves this Policy annually or as conditions require
- Reports security program status to executive management and the board at least quarterly
- Chairs the Security Review Committee
- Designates owners for all subordinate policies and security domains
- Maintains awareness of the current threat landscape applicable to ForgePay's operations
- Ensures PCI DSS compliance program is funded, staffed, and operational

#### Data Owner
- A senior business or technology leader designated as responsible for a specific data set or system
- Defines classification of data under their ownership
- Approves access to data and systems they own
- Ensures data is handled in accordance with this Policy

#### Data Custodian
- An operational role (typically within Engineering or DevSecOps) responsible for the technical safeguarding of data
- Implements and maintains technical controls specified by the Data Owner and CISO
- Reports security events affecting assets they manage
- Ensures backups, encryption, and access controls are functioning for assigned systems

#### All Personnel
- Must read, understand, and comply with this Policy and all subordinate policies
- Must complete security awareness training within 30 days of hire and annually thereafter
- Must report suspected security incidents immediately to security@forgepay.com or the designated incident hotline
- Must not circumvent, disable, or undermine security controls
- Must use ForgePay systems and data only for authorized business purposes

#### Engineering Leads
- Responsible for ensuring that all software developed or deployed for ForgePay meets the secure development requirements in the Secure Development Policy (ISP-006)
- Responsible for maintaining security of all systems under their team's purview

#### Third-Party Service Providers
- Must demonstrate compliance with applicable ForgePay security requirements
- Must report security incidents affecting ForgePay data within 24 hours of discovery
- Must cooperate with ForgePay security assessments

### 4.2 Security Review Committee

The Security Review Committee meets at least quarterly and consists of:
- CISO (chair)
- Engineering Lead
- Head of Compliance
- Legal representative
- DevSecOps representative

The committee reviews the security posture, risk assessment findings, incident reports, and policy exceptions.

---

## 5. Core Security Principles

All information security decisions and implementations must be guided by these principles:

### 5.1 Confidentiality
Information must be accessible only to those with an authorized need to know. Cardholder data and sensitive authentication data require the highest level of confidentiality protection. No raw PANs or SAD may be stored, logged, or transmitted outside the Hyperswitch PCI vault.

### 5.2 Integrity
Information must be accurate, complete, and protected from unauthorized modification. Audit logs must be tamper-evident and immutable. Changes to CDE components must follow the formal change management process.

### 5.3 Availability
Systems must be available to authorized users as required for business operations. Availability requirements for payment processing are: 99.9% uptime for payment-engine; recovery time objective (RTO) of 4 hours; recovery point objective (RPO) of 1 hour.

### 5.4 Least Privilege
All access to ForgePay systems and data must be granted based on the minimum permissions required for a person or system to perform their defined function. Access that is no longer needed must be revoked promptly.

### 5.5 Defense in Depth
No single security control is relied upon exclusively. Multiple overlapping controls are implemented so that failure of any one control does not result in a security breach.

### 5.6 Security by Design
Security considerations are incorporated into system design from inception, not added as an afterthought. All new systems and significant changes to existing systems must undergo a security review before deployment.

---

## 6. Information Classification

| Classification | Description | Examples | Handling Requirements |
|---------------|-------------|---------|----------------------|
| **Restricted** | Most sensitive; loss would cause severe harm | Raw PANs, SAD, vault encryption keys, private TLS keys, AWS root credentials | Encrypted at rest and in transit; need-to-know access only; no email; audit all access |
| **Confidential** | Sensitive business information; loss would cause significant harm | Payment tokens, merchant data, PII, security assessments, this document | Encrypted at rest and in transit; authorized personnel only; no unauthorized sharing |
| **Internal** | Internal use only; not for external distribution | Internal communications, code, architecture diagrams | Transmission via secure channels; not posted publicly |
| **Public** | Approved for public consumption | Marketing materials, public API docs | No special controls |

All cardholder data is **Restricted** and subject to the additional requirements of PCI DSS.

---

## 7. Required Security Controls

### 7.1 Access Control
All access to ForgePay systems must be governed by the Access Control Policy (ISP-002). Key requirements:
- Unique user IDs for all personnel — no shared accounts
- Multi-factor authentication (MFA) for all access to the CDE
- MFA required for all remote access regardless of system sensitivity
- Access reviews conducted every 6 months for CDE access; annually for non-CDE systems
- Accounts of terminated personnel revoked within 1 hour of separation

### 7.2 Authentication
- Passwords must meet the requirements in the Access Control Policy (ISP-002)
- All passwords must be stored using a salted cryptographic hash
- Passwords must not be transmitted in cleartext

### 7.3 Cryptography
- All CHD in transit must be protected with TLS 1.2 or higher (TLS 1.3 preferred)
- All CHD at rest must be encrypted with AES-256
- SSL/TLS certificates managed through ACM or an equivalent managed certificate service
- Cryptographic keys must be managed per the Key Management Standard (ISP-007)

### 7.4 Vulnerability Management
- All CDE systems must be scanned for vulnerabilities at least quarterly by an ASV (external) and internal scanning tools
- Critical vulnerabilities (CVSS 9.0+) must be remediated within 48 hours in CDE systems
- High vulnerabilities (CVSS 7.0–8.9) must be remediated within 7 days in CDE systems
- All software developed or deployed by ForgePay must pass SAST scanning before deployment to production

### 7.5 Logging and Monitoring
- All CDE system components must generate audit logs as required by PCI DSS Requirement 10
- Audit logs must be protected from modification (immutable storage)
- Audit logs must be retained for a minimum of 13 months
- Automated log review must generate alerts for anomalous events

### 7.6 Change Management
- All changes to CDE system components must follow the Change Management Procedure (ISP-008)
- No unauthorized changes to CDE systems are permitted
- Changes must be reviewed and approved before deployment to production

### 7.7 Physical Security
- ForgePay's CDE infrastructure is hosted in AWS, which maintains SOC 2 Type II and PCI DSS Level 1 certification for its data centers
- AWS physical security controls are inherited; AWS Artifact reports must be reviewed annually
- Any ForgePay physical office containing systems with access to the CDE must implement appropriate physical access controls

### 7.8 Incident Response
- All security incidents affecting CHD or ForgePay systems must be reported and handled per the Incident Response Policy (ISP-003)
- Personnel must report suspected incidents immediately to security@forgepay.com or the 24/7 incident hotline
- Cardholder data breaches require notification to card brands (Visa, Mastercard) within 72 hours of confirmation

---

## 8. Policy Compliance

### 8.1 Monitoring and Enforcement
Compliance with this Policy is monitored through:
- Technical controls (automated enforcement via RBAC, network policies, etc.)
- Audit logging and SIEM alerting
- Annual risk assessments
- Penetration testing (annual minimum)
- PCI DSS QSA assessments (annual)
- Internal audits

### 8.2 Violations
Violations of this Policy may result in:
- Disciplinary action, up to and including termination of employment or contract
- Legal action where violations constitute criminal activity
- Notification to card brands or regulators where required

### 8.3 Reporting Violations
Personnel must report suspected violations to the CISO or security@forgepay.com. Reports made in good faith will not result in retaliation.

---

## 9. Policy Exceptions

Exceptions to this Policy may be granted only when:
1. A valid business justification exists
2. A risk assessment has been performed by the CISO
3. Compensating controls are in place to mitigate the risk
4. The exception is time-limited and reviewed at least quarterly
5. The exception is documented and approved by the CISO

Exceptions affecting PCI DSS controls require documentation as a compensating control per PCI DSS Appendix B.

Exceptions must be tracked in the exceptions register and reviewed at least every 90 days.

---

## 10. Related Policies and Standards

| Document ID | Title | PCI DSS Req |
|-------------|-------|-------------|
| ISP-002 | Access Control Policy | 7, 8 |
| ISP-003 | Incident Response Policy | 12.10 |
| ISP-004 | Acceptable Use Policy | 12.2 |
| ISP-005 | Third-Party Risk Management Policy | 12.8 |
| ISP-006 | Secure Development Policy | 6 |
| ISP-007 | Key Management Standard | 3.6, 3.7 |
| ISP-008 | Change Management Procedure | 6.5 |
| ISP-009 | Data Classification and Handling Standard | 3 |

---

## 11. Policy Review and Maintenance

This Policy must be reviewed:
- At least once every 12 months
- After any significant change to the business or technical environment
- After a security incident that reveals a policy gap
- When required by a new regulatory or contractual obligation

Reviews are conducted by the CISO and approved by executive management. The date of last review and approver must be recorded in the document revision history below.

---

## 12. Executive Approval

By signing below, executive management acknowledges accountability for the information security program and approves this Policy:

| Name | Title | Signature | Date |
|------|-------|-----------|------|
| | Chief Executive Officer | | |
| | Chief Information Security Officer | | |
| | Chief Technology Officer | | |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-06-25 | CISO | Initial version |

---

*Document Owner: CISO*
*Classification: Confidential — Internal Use Only*
*Distribution: All ForgePay Personnel*
