# Access Control Policy

**Document ID:** ISP-002
**Version:** 1.0
**Classification:** Confidential — Internal Use Only
**Effective Date:** [DATE OF EXECUTIVE APPROVAL]
**Next Review Date:** [EFFECTIVE DATE + 12 MONTHS]
**PCI DSS Reference:** Requirements 7.1–7.3, 8.1–8.6

---

## 1. Purpose

This Access Control Policy defines how ForgePay grants, manages, reviews, and revokes access to systems, applications, and data — with particular emphasis on the Cardholder Data Environment (CDE). Proper access control is essential to limit exposure of cardholder data (CHD) to those with a legitimate business need and to satisfy PCI DSS Requirements 7 and 8.

---

## 2. Scope

This Policy applies to all ForgePay personnel, contractors, and third parties who access ForgePay systems, with heightened requirements for any entity accessing CDE systems or CHD.

---

## 3. Foundational Principles

### 3.1 Need-to-Know / Least Privilege
Access is granted based on the minimum permissions required to perform a defined job function. Personnel are not granted access beyond what is strictly necessary for their role. This principle applies to:
- Human users (employees, contractors)
- Service accounts and application identities
- Kubernetes ServiceAccounts and AWS IAM roles for CDE workloads

### 3.2 Explicit Deny
All access to CDE systems is denied by default. Access must be explicitly granted through approved mechanisms:
- Kubernetes RBAC (RoleBindings / ClusterRoleBindings)
- AWS IAM policies (deny-all by default with explicit allow)
- Kubernetes NetworkPolicy (default-deny with explicit allow)
- PostgreSQL role grants

### 3.3 Unique Identification
Every individual accessing ForgePay systems must have a unique identifier. Shared accounts, group accounts, and generic accounts (except technically required service accounts) are prohibited.

---

## 4. Access Classification

### 4.1 Access Types

| Access Type | Description | MFA Required | Review Cadence |
|-------------|-------------|-------------|---------------|
| CDE Administrative | Direct access to payment-engine, pci-vault, or payment DB with elevated privileges | Yes | Every 6 months |
| CDE Read-Only | Read access to CDE logs, dashboards, monitoring data | Yes | Every 6 months |
| Non-CDE Systems | Access to out-of-scope ForgePay services | Yes (for production) | Annually |
| Development/Staging | Access to non-production environments | Yes | Annually |
| Physical/Data Center | Not applicable — AWS-managed | AWS handles | Via AWS Artifact |

### 4.2 User Categories

| Category | Examples | Account Standard |
|----------|---------|-----------------|
| ForgePay Employees | Engineers, ops, compliance | Corporate SSO + MFA |
| Contractors | Consultants, external developers | Contractor account with limited scope; time-boxed |
| Third-Party Vendors | QSA, ASV, pen testers | Temporary access; specific scope; time-limited |
| Service Accounts | Kubernetes ServiceAccounts, CI/CD pipeline | Named service accounts; no interactive login |

---

## 5. Access Request and Approval

### 5.1 Standard Access Request Process

1. **Request:** Personnel submits access request via the access management system (e.g., Jira or internal HR system) specifying: system, access level, business justification, and required duration
2. **Approval:** Access must be approved by:
   - Direct manager (any system)
   - Data Owner or CISO (for CDE access)
3. **Provisioning:** DevSecOps provisions access within 1 business day of approval
4. **Notification:** Requester receives confirmation with access details
5. **Documentation:** All access grants are logged in the access management system

### 5.2 Emergency Access

In emergencies requiring immediate CDE access outside business hours:
1. On-call engineer uses break-glass account (see Section 8)
2. Incident documented in incident tracking system within 24 hours
3. CISO notified by next business day
4. Access revoked immediately after emergency resolved
5. Post-incident review conducted

---

## 6. Password Policy

All ForgePay personnel must adhere to the following password requirements. These apply to all ForgePay-managed accounts.

### 6.1 Password Requirements (PCI DSS v4.0 Req 8.3.6)

| Parameter | Requirement |
|-----------|-------------|
| Minimum length | 12 characters |
| Complexity | At least one uppercase, one lowercase, one digit, one special character |
| History | Must not reuse any of last 4 passwords |
| Maximum age | 90 days (for non-MFA-protected systems); no expiry required for MFA-protected accounts per v4.0 |
| Lockout threshold | Account locked after 10 invalid attempts |
| Lockout duration | Minimum 30 minutes, or until unlocked by administrator |
| Default passwords | All vendor-supplied default passwords must be changed before deployment |

### 6.2 Password Managers

Personnel are strongly encouraged to use an approved password manager (1Password, Bitwarden, or equivalent). Passwords must not be stored in plaintext, shared via email or Slack, or written in code or configuration files.

### 6.3 Password Storage

- All ForgePay systems must store passwords using a strong one-way hash with a unique salt (bcrypt, Argon2, or PBKDF2 — minimum 10,000 iterations for PBKDF2)
- Plaintext password storage is prohibited in all systems

---

## 7. Multi-Factor Authentication (MFA)

### 7.1 MFA Requirements (PCI DSS v4.0 Req 8.4.2, 8.4.3)

MFA is **mandatory** for:
- All access to the CDE (no exceptions)
- All remote access to ForgePay production systems (VPN, bastion, SSM)
- All access to AWS Management Console
- All access to Kubernetes clusters (kubectl)
- All access to CI/CD pipelines that deploy to production
- All access to secrets management systems (AWS Secrets Manager, HashiCorp Vault)
- All administrative access to databases

MFA is **required** (with documented exception process only) for:
- All production system access
- All engineer local development with production credentials

### 7.2 Approved MFA Methods

| Method | Approved | Notes |
|--------|---------|-------|
| TOTP Authenticator (Google Authenticator, Authy, 1Password) | Yes | Preferred |
| Hardware security key (YubiKey, FIDO2) | Yes | Required for privileged access |
| SMS OTP | No | Prohibited for CDE access (SIM swap risk) |
| Email OTP | No | Prohibited for CDE access |
| Push notification (Okta Verify, Duo) | Yes | |

### 7.3 MFA for Service Accounts

Service accounts (Kubernetes ServiceAccounts, IAM roles assumed by workloads) authenticate using:
- Short-lived credentials (AWS STS AssumeRole, IRSA tokens — max 1-hour lifetime)
- Mutual TLS (mTLS) for service-to-service communication in CDE
- Never long-lived static credentials or passwords stored in code

---

## 8. Privileged Access Management

### 8.1 Privileged Accounts

Privileged accounts are those with elevated access to CDE systems, including:
- Kubernetes `cluster-admin` or namespace admin roles in CDE namespaces
- AWS IAM administrator roles
- Database admin (`postgres` superuser)
- HashiCorp Vault root token or admin policy
- AWS root account

### 8.2 Privileged Access Controls

| Control | Requirement |
|---------|-------------|
| Unique accounts | All privileged accounts are unique per person; no shared admin accounts |
| MFA | Hardware security key (FIDO2) required for all privileged accounts |
| Just-in-time (JIT) access | Privileged access granted on-demand for defined sessions; not standing access where technically feasible |
| Session recording | All privileged sessions in CDE systems are recorded (via bastion session recording or SSM Session Manager logging) |
| Separation of duties | Production deployment separate from change approval |

### 8.3 Break-Glass Accounts

Break-glass accounts (emergency access accounts) for CDE systems:
- Credentials stored in a sealed physical envelope in the company safe AND in AWS Secrets Manager under a separate emergency-access KMS key
- Access to break-glass credentials requires dual authorization (two executives)
- Any use of break-glass accounts triggers immediate CISO notification
- Break-glass account activity is audited separately
- Break-glass credentials are rotated after each use

### 8.4 AWS Root Account

- AWS root account is used only for tasks that cannot be performed by IAM users (e.g., billing, account creation)
- AWS root account MFA is enabled with a hardware security key
- Root account credentials are stored in break-glass procedure
- Root access is logged via CloudTrail; any root access triggers an alert

---

## 9. Account Lifecycle Management

### 9.1 New User Provisioning

| Step | Action | Timeframe |
|------|--------|-----------|
| 1 | Access request submitted and approved | Before start date |
| 2 | Corporate SSO account created | Day 1 |
| 3 | MFA enrolled | Day 1 (required for system access) |
| 4 | Role-based access provisioned | Within 1 business day of request approval |
| 5 | User signs Acceptable Use Policy | Day 1 |
| 6 | Security awareness training assigned | Day 1; must complete within 30 days |

### 9.2 Role Changes

When a person changes roles:
1. Access for old role is reviewed within 48 hours
2. Unnecessary access is revoked
3. New access required for new role is requested and approved per Section 5.1
4. Changes documented in access management system

### 9.3 Termination and Offboarding (PCI DSS Req 8.2.5)

| Step | Action | SLA |
|------|--------|-----|
| 1 | HR notifies DevSecOps and CISO | Day of termination |
| 2 | Corporate SSO account disabled | Within 1 hour of notification |
| 3 | All system access revoked | Within 1 hour |
| 4 | All active sessions terminated | Immediately |
| 5 | Authentication credentials invalidated (JWT, API keys, SSH keys) | Within 1 hour |
| 6 | Physical access revoked (office, data center badges) | Day of termination |
| 7 | Company devices collected | Day of termination |
| 8 | Confirmation documented | Within 24 hours |

**The 1-hour SLA for CDE access revocation is non-negotiable. Late revocations must be reported to the CISO.**

### 9.4 Inactive Account Management (PCI DSS Req 8.2.6)

- Accounts with no login activity for 90 days must be disabled or deleted
- DevSecOps runs an automated inactive account report monthly
- Exceptions (e.g., leave of absence) require written approval from CISO
- Service accounts with no activity for 90 days are reviewed for decommissioning

---

## 10. Service Account Management

Service accounts are used by applications, pipelines, and automated systems. They are subject to the following controls:

| Control | Requirement |
|---------|-------------|
| Naming convention | `svc-[service-name]-[purpose]` (e.g., `svc-payment-engine-db`) |
| Unique accounts | Each service has its own service account; no shared service accounts |
| Least privilege | Service accounts granted only the permissions required for the specific function |
| No interactive login | Service accounts must not be usable for interactive human login (no password; use IRSA or mTLS) |
| Credential rotation | Service account credentials (if any) rotated at least every 90 days |
| Inventory | All service accounts maintained in the service account registry |
| Review | Service account permissions reviewed every 6 months |

### 10.1 Kubernetes ServiceAccounts

- All CDE pods must run with a named ServiceAccount (not `default`)
- ServiceAccounts in CDE namespaces follow least-privilege RBAC
- Pod Security Standards (Restricted profile) enforced on CDE namespaces
- `automountServiceAccountToken: false` unless the token is explicitly required

### 10.2 AWS IAM Roles for Service Accounts (IRSA)

- All CDE pods requiring AWS API access use IRSA with a dedicated IAM role
- IAM roles scoped to the minimum required AWS permissions
- IRSA tokens expire in 1 hour; short-lived by design
- No long-lived IAM user access keys in CDE pods

---

## 11. Third-Party and Vendor Access

Third parties granted access to ForgePay systems must:
1. Have a signed agreement including confidentiality and security obligations
2. Be provisioned with a dedicated, time-limited account (not reusing an employee's account)
3. Use MFA for all access
4. Access only the systems and data required for their defined engagement
5. Have access revoked immediately upon engagement completion
6. Be included in ForgePay's Third-Party Risk Management review (ISP-005)

Third-party access to CDE systems requires CISO approval and is logged separately.

---

## 12. Access Review

### 12.1 CDE Access Review (PCI DSS Req 7.2.4, 7.3.3)

- All accounts with CDE access are reviewed every 6 months
- Review confirms: account is still active, access level matches current role, no excessive permissions
- Accounts that fail review must have excess access removed within 5 business days
- Review results documented and stored in compliance evidence folder

### 12.2 Non-CDE Access Review

- All user accounts reviewed at least annually
- Service accounts reviewed every 6 months

### 12.3 Review Process

1. DevSecOps generates access report (list of all accounts and permissions)
2. Data Owner and CISO review report
3. Exceptions, removals, and confirmations documented
4. Changes implemented within 5 business days
5. Review completion documented with date and reviewer names

---

## 13. Remote Access

- All remote access to ForgePay production systems requires MFA
- Remote access is via: corporate VPN with MFA, or AWS Systems Manager Session Manager (no inbound ports required)
- Direct SSH to production instances is prohibited except via bastion host with MFA and session recording
- Split-tunnel VPN is prohibited for CDE-adjacent access — full-tunnel VPN required

---

## 14. Policy Violations

Violations include:
- Sharing passwords or MFA tokens
- Accessing systems or data beyond authorized scope
- Creating unauthorized accounts or service accounts
- Bypassing MFA requirements
- Failing to report account compromise or suspicious activity

Violations are subject to disciplinary action per the Information Security Policy (ISP-001), up to and including termination.

---

## 15. Policy Review

This Policy is reviewed annually or upon significant changes to the access control architecture or PCI DSS requirements.

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-06-25 | CISO | Initial version |

---

*Document Owner: CISO*
*Approved By: [Executive Name, Title]*
*Classification: Confidential — Internal Use Only*
*Distribution: All ForgePay Personnel*
