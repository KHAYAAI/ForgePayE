# ForgePay — IT Systems and Operational Controls Documentation

**Document Classification:** Confidential — Regulatory Submission
**Version:** 1.0
**Date:** 2026-06-25
**Prepared By:** Chief Technology Officer
**Reviewed By:** Chief Compliance Officer
**Approved By:** Board of Directors

---

## 1. Executive Summary

ForgePay operates its payment platform on a cloud-native infrastructure hosted exclusively on Amazon Web Services (AWS) in the `af-south-1` (Cape Town) region. The platform is built on a Hyperswitch open-source payment router (Apache 2.0 licence, Rust/Actix-Web), extended with ForgePay proprietary services for merchant orchestration, stablecoin settlement, crypto payments, and AI agent (x402) payments.

This document describes the technical controls implemented to protect cardholder data, merchant funds, and personal information in compliance with:
- PCI DSS v4.0 (Payment Card Industry Data Security Standard)
- ISO 27001 principles (target certification: Year 2)
- POPIA (Protection of Personal Information Act 4 of 2013)
- FSCA IT and operational control requirements
- OWASP Top 10 (secure software development)

---

## 2. Infrastructure Architecture

### 2.1 Cloud Environment

| Parameter | Value |
|---|---|
| Cloud Provider | Amazon Web Services (AWS) |
| Primary Region | af-south-1 (Cape Town, South Africa) |
| Backup / DR Region | eu-west-1 (Ireland) — used only for encrypted backup storage, not live data processing |
| Orchestration | Amazon EKS (Elastic Kubernetes Service) |
| Container Runtime | containerd |
| Infrastructure as Code | Terraform (all resources version-controlled in Git) |
| Data Residency | All primary data storage and processing: af-south-1 only (POPIA compliant) |

**Note on data residency:** ForgePay's POPIA Data Protection Officer has confirmed that all cardholder data, personal information, and transaction records are processed and stored in af-south-1. No personal data is processed in or transferred to the DR region (eu-west-1) except as encrypted backup archives. Cross-border transfer restrictions under POPIA Section 72 have been assessed and backup transfers to eu-west-1 are covered by the POPIA adequacy framework for EU-based storage.

### 2.2 Service Architecture

| Service | Language | Repository Path | Function |
|---|---|---|---|
| Hyperswitch Router | Rust / Actix-Web | `crates/router` | Core payment routing engine; PCI vault |
| Unified Router | TypeScript / Fastify | `forgepay/services/unified-router` | Webhook normalisation; event bus |
| MoR Layer | Python / FastAPI | `forgepay/services/mor-layer` | Merchant of Record; tax; checkout |
| Billing Engine | Java / Kill Bill | `forgepay/services/billing-engine` | Subscriptions; recurring billing |
| Stablecoin Gateway | TypeScript | `forgepay/services/stablecoin-gateway` | USDC/USDT; x402 protocol |
| Crypto Gateway | TypeScript | `forgepay/services/crypto-gateway` | BTC/ETH/LTC/XMR |
| Merchant Dashboard | Next.js 14 | `forgepay/apps/dashboard` | Merchant portal |
| Marketing Site | Next.js 14 | `forgepay/apps/web` | Public website |

### 2.3 Network Architecture

```
Internet
    |
[AWS WAF + Shield Standard]
    |
[Application Load Balancer — af-south-1]
    |
[Kubernetes Ingress (NGINX)]
    |
[VPC: forgepay-prod]
├── Public subnets (Load Balancer only — no compute)
├── Private subnets (Kubernetes node groups — af-south-1a, af-south-1b, af-south-1c)
│   ├── EKS Node Group: payment-critical (Hyperswitch, Unified Router, MoR)
│   ├── EKS Node Group: gateway-services (Stablecoin, Crypto)
│   └── EKS Node Group: dashboard (Merchant Dashboard, Web)
└── Data subnets (RDS PostgreSQL, ElastiCache Redis, Secrets Manager)
    ├── RDS Aurora PostgreSQL (Multi-AZ, encrypted, af-south-1)
    ├── ElastiCache Redis (session cache; ephemeral only)
    └── AWS Secrets Manager (all secrets; no hardcoded credentials)
```

**VPC segmentation:** Payment-critical services are isolated in separate Kubernetes namespaces with NetworkPolicy rules restricting inter-namespace communication. The Hyperswitch router (cardholder data environment) has the most restrictive ingress/egress rules.

---

## 3. PCI DSS Compliance and Card Tokenization

### 3.1 Cardholder Data Environment (CDE)

ForgePay's Cardholder Data Environment is limited to the Hyperswitch router service (`crates/router`) running in the `payment-critical` EKS node group. The CDE boundary is defined as:

- **In scope:** Hyperswitch router pods; RDS PostgreSQL vault schema; Secrets Manager entries for card vault keys
- **Out of scope:** All other ForgePay services, including unified-router, mor-layer, stablecoin-gateway, crypto-gateway, and merchant dashboard — none of these services receive, store, or process plain-text PANs

### 3.2 Tokenization Architecture

ForgePay never stores primary account numbers (PANs) in plain text. The tokenization flow is:

```
Consumer browser / mobile app
    |
[TLS 1.3 encrypted channel]
    |
Hyperswitch JavaScript SDK (collects card data in isolated iframe)
    |
[TLS 1.3 — direct to Hyperswitch router, bypasses merchant servers]
    |
Hyperswitch Router — CDE
    |
[PAN received] → [Luhn validation] → [Vault encryption: AES-256-GCM]
    |
[Vault stores encrypted PAN + token mapping]
    |
[Token returned to merchant — FPT_xxxxxxxxxxxxxxxx format]
    |
All subsequent operations use token only — PAN never transmitted again
```

**Key management:**
- AES-256-GCM encryption for vault storage
- Encryption keys stored in AWS Secrets Manager (not in application code or config files)
- Key rotation: quarterly automated rotation via AWS KMS
- Dual-control key access: requires two authorised personnel to access raw vault keys

### 3.3 PCI DSS Assessment Status

| Item | Status | Notes |
|---|---|---|
| Current PCI DSS version | v4.0 | |
| Assessment type | SAQ-D (target) | Will engage QSA for external ROC in Year 1 |
| Scope reduction | Tokenization reduces CDE scope to Hyperswitch router only | |
| Network segmentation | Confirmed — CDE isolated by VPC subnet and Kubernetes NetworkPolicy | |
| Penetration test | Scheduled — see Section 9 | |
| Vulnerability scanning | Automated via Trivy (container images) + Amazon Inspector | Weekly |

---

## 4. Encryption Standards

### 4.1 Data in Transit

| Connection | Protocol | Cipher Suite |
|---|---|---|
| Consumer to ForgePay API | TLS 1.3 (preferred) / TLS 1.2 (minimum) | ECDHE-RSA-AES256-GCM-SHA384; ECDHE-RSA-CHACHA20-POLY1305 |
| Service-to-service (internal, Kubernetes) | TLS 1.2+ via mutual TLS (mTLS, Istio service mesh — target) | ECDHE-based; certificate rotation via cert-manager |
| ForgePay to acquirer / card network | TLS 1.2+ (acquirer mandated) | Per acquirer specification |
| ForgePay to AWS services | AWS SDK with HTTPS; VPC Endpoints where available | AWS managed |
| ForgePay to blockchain nodes | HTTPS / WSS TLS 1.2+ | Provider managed |
| Admin SSH access | SSH key-pair (no password auth); Bastion host via AWS SSM Session Manager | SSM preferred; SSH disabled |

**TLS 1.0 and 1.1 are explicitly disabled on all ForgePay endpoints.**

### 4.2 Data at Rest

| Data Type | Storage | Encryption |
|---|---|---|
| Transaction records | RDS Aurora PostgreSQL | AES-256 (AWS managed key via KMS); storage-level encryption |
| Cardholder tokens and vault | RDS PostgreSQL (CDE schema) | AES-256-GCM (application-level) + AES-256 (storage-level) — double encrypted |
| Audit logs | PostgreSQL + S3 | AES-256 (S3 SSE-KMS); PostgreSQL storage encryption |
| KYC documents (ID scans, etc.) | S3 af-south-1 | SSE-KMS (AES-256); S3 Object Lock (WORM) for record retention |
| Secrets (API keys, DB passwords) | AWS Secrets Manager | AES-256 (AWS managed); versioned; audit logged |
| Kubernetes etcd | AWS EKS managed | AES-256 (EKS envelope encryption via KMS) |
| Backups | S3 af-south-1 (primary) + eu-west-1 (encrypted archive) | SSE-KMS; cross-region replication encrypted |

---

## 5. Access Controls

### 5.1 Identity and Access Management (IAM)

**Authentication:**
- All human access to ForgePay systems requires Multi-Factor Authentication (MFA)
- AWS console access: IAM Identity Center (SSO) with MFA enforced
- Kubernetes cluster access: kubeconfig with OIDC authentication; MFA via Identity Center
- Internal admin tools: SAML SSO via [IdP provider]; MFA enforced
- SSH / bastion: Disabled in favour of AWS SSM Session Manager; SSM access requires MFA

**Authorisation (RBAC):**

| Role | AWS Permissions | Kubernetes Permissions | Database Access |
|---|---|---|---|
| Platform Engineer | Limited S3, CloudWatch, EKS (read + deploy) | Developer namespace only | Application credentials (no direct DB) |
| SRE / Ops | EC2, EKS, RDS (ops tasks), CloudWatch | All namespaces (no delete production) | Read-only; break-glass for write |
| Security Engineer | Security Hub, GuardDuty, Inspector, IAM (read) | Read-only all namespaces | Read-only audit tables |
| Compliance Officer | CloudTrail, Config, S3 audit buckets (read) | Read-only | Read-only compliance tables |
| Database Administrator | RDS console (limited) | None | Full DB access (break-glass, dual control) |
| CTO | Defined set per least-privilege policy | Full cluster admin | Break-glass only |

**Break-glass access:** Any break-glass (elevated access) usage requires prior approval in the security ticket system, is time-limited (4-hour maximum), is fully logged to CloudTrail, and triggers an automatic alert to the CTO and CCO.

**Privileged Access Management (PAM):**
- All privileged access (production DB write, vault key access) requires dual-control approval
- PAM sessions are recorded via [PAM tool — e.g., HashiCorp Boundary or AWS Systems Manager]
- Privileged session recordings are retained for 2 years

### 5.2 Kubernetes RBAC

ForgePay enforces Kubernetes RBAC with least-privilege namespace assignments:

```yaml
# Example: payment-critical namespace RBAC
# No developer roles can access payment-critical namespace
# Only payment-critical-service-account for Hyperswitch pods
# CDE access requires separate approval workflow
```

- Pod Security Standards (Restricted profile) enforced via admission webhook
- Network Policies restrict inter-namespace traffic to defined API ports only
- Image pull restricted to internal ECR registry (no Docker Hub or public registries in production)
- All container images built in CI with provenance attestation (Sigstore / cosign — target)

### 5.3 Secrets Management

- Zero hardcoded secrets in code or container images (enforced via pre-commit hook and Gitleaks in CI)
- All secrets injected at runtime from AWS Secrets Manager via External Secrets Operator
- Secrets rotation: automated via AWS Secrets Manager rotation Lambda for DB credentials (30-day cycle); API keys rotated on change or quarterly
- Emergency secret rotation procedure: <4 hours from detection to rotation for compromised credentials

---

## 6. Incident Response

### 6.1 Incident Response Plan

ForgePay maintains an Incident Response Plan (IRP) that is tested annually via tabletop exercises.

**Incident Classification:**

| Severity | Definition | Response Time | Examples |
|---|---|---|---|
| P1 — Critical | Data breach; system-wide outage; regulatory incident | Immediate (15 min escalation) | PAN exposure; OFAC sanctions breach; complete outage |
| P2 — High | Partial service disruption; suspected breach; fraud spike | 30 minutes | Single service down; elevated chargeback rate; suspicious admin access |
| P3 — Medium | Degraded performance; isolated security alert | 4 hours | Failed login attempts; non-critical CVE; minor API errors |
| P4 — Low | Non-impactful anomalies; informational alerts | Next business day | Routine monitoring alerts; minor configuration issues |

**Incident Response Phases:**

1. **Detection:** Automated alerts via AWS GuardDuty, CloudTrail anomaly detection, Kubernetes audit logs, OTEL metrics anomalies
2. **Containment:** Isolate affected systems (Kubernetes network policy update; IAM policy deny); revoke compromised credentials
3. **Investigation:** Forensic review of CloudTrail, VPC Flow Logs, OTEL traces, PostgreSQL audit logs
4. **Eradication:** Patch or remove root cause; rescan for indicators of compromise
5. **Recovery:** Restore from clean backup or redeploy from Git (immutable infrastructure); verify integrity
6. **Post-Incident Review:** RCA document within 5 business days; lessons learned; policy update if required

### 6.2 Data Breach Notification

**POPIA 72-hour rule:** In the event of a breach of personal information, ForgePay will:
1. Notify the Information Regulator within 72 hours of becoming aware of the breach (Section 22, POPIA)
2. Notify affected data subjects without undue delay where the breach poses a high risk to their rights and freedoms
3. Notify FSCA within the timeframe required by license conditions (typically immediately for material breaches)
4. Document all notifications in the incident record

**Notification contact:** Information Regulator (South Africa) — inforeg@justice.gov.za / +27 12 406 4818

### 6.3 Card Data Breach Procedure

In the event of a confirmed or suspected card data breach:
1. Immediately contain: isolate CDE; disable compromised credentials
2. Notify card schemes (Visa, Mastercard) within timeframes specified in scheme rules (typically 24–72 hours)
3. Engage PCI Forensic Investigator (PFI) within 24 hours
4. Notify acquiring bank
5. Preserve all forensic evidence; do not alter logs or systems without PFI instruction
6. Notify FSCA and SARB as applicable

---

## 7. Business Continuity and Disaster Recovery

### 7.1 Business Continuity Plan (BCP)

**Recovery Time Objective (RTO):** 4 hours for payment-critical services
**Recovery Point Objective (RPO):** 15 minutes (RDS Multi-AZ; continuous backup)

**BCP Scenarios Covered:**
- AWS Availability Zone failure (single AZ): automatic failover via EKS Multi-AZ node groups and RDS Multi-AZ — near-zero downtime
- AWS Region partial degradation: failover to cached static responses for non-critical paths; payment processing degrades gracefully via acquirer failover
- Complete af-south-1 regional outage: Recovery from encrypted backups in eu-west-1 — RTO 4 hours; RPO 15 minutes
- Key person unavailability: Documented runbooks; minimum 2 engineers trained on each critical system

### 7.2 Database Backup

| Backup Type | Frequency | Retention | Storage |
|---|---|---|---|
| RDS Aurora automated backup | Continuous (WAL streaming) | 35 days (Point-in-Time Recovery) | S3 af-south-1 (managed by RDS) |
| RDS Aurora snapshot (manual) | Daily (automated via Lambda) | 90 days | S3 af-south-1 |
| Encrypted backup archive | Weekly (full) | 7 years (compliance retention) | S3 eu-west-1 (encrypted, no live access) |

**Backup restoration testing:** Monthly automated restoration test to isolated environment; results logged to compliance dashboard.

### 7.3 High Availability Architecture

- **EKS:** 3 Availability Zones (af-south-1a, af-south-1b, af-south-1c); pod anti-affinity rules ensure payment-critical pods spread across AZs
- **RDS:** Aurora Multi-AZ with read replica; automatic failover < 60 seconds
- **Load Balancer:** AWS ALB with health checks; unhealthy target groups removed automatically
- **DNS failover:** Route 53 health check-based routing; TTL 60 seconds for rapid failover

---

## 8. Data Residency and POPIA Compliance

### 8.1 Data Residency Mapping

| Data Category | Primary Storage | Backup Storage | Processing Location |
|---|---|---|---|
| Transaction records | RDS PostgreSQL — af-south-1 | S3 af-south-1 | EKS — af-south-1 |
| Cardholder tokens | RDS PostgreSQL (vault) — af-south-1 | Encrypted backup — af-south-1 | EKS — af-south-1 (CDE) |
| KYC / Personal information | S3 af-south-1 (encrypted) | S3 af-south-1 | EKS — af-south-1 |
| Audit logs | PostgreSQL + S3 — af-south-1 | S3 eu-west-1 (encrypted archive) | EKS — af-south-1 |
| Application logs (OTEL) | CloudWatch — af-south-1 | None | af-south-1 |
| Analytics / BI | [TBD — must be af-south-1 or approved transfer] | | |

**No personal data is stored or processed on non-South African servers except:** Encrypted compliance archive backups in eu-west-1, which are stored exclusively as AES-256 encrypted archives and cannot be processed without key material held in af-south-1 (key material does not leave af-south-1). This arrangement has been assessed as compliant with POPIA Section 72 given the encryption controls in place.

### 8.2 Sub-Processor Data Flows

All sub-processors receiving South African personal data are contractually bound via Data Processing Agreements (DPAs) compliant with POPIA. Key sub-processors:
- AWS (infrastructure): Standard Contractual Clauses; POPIA addendum
- KYC/eKYC vendor: Data processed in af-south-1 (or POPIA-compliant jurisdiction with DPA)
- Blockchain analytics provider: Transaction hashes only (not personal data); no DPA required
- Card scheme (Visa, Mastercard): Covered under card scheme rules and POPIA DPA

---

## 9. Penetration Testing Schedule

### 9.1 External Penetration Testing

| Test Type | Frequency | Provider | Scope | Last Completed |
|---|---|---|---|---|
| External network penetration test | Annual | CREST-accredited third party | Internet-facing APIs; AWS perimeter | [Date — TBD: Year 1 pre-launch] |
| Web application penetration test | Annual | CREST-accredited third party | Merchant Dashboard; API endpoints | [Date — TBD: Year 1 pre-launch] |
| PCI DSS penetration test (segmentation test) | Annual + after significant change | QSA-approved tester | CDE boundary; network segmentation | [Date — TBD: Year 1] |
| Social engineering / phishing simulation | Annual | Third-party | All staff | [Date — TBD] |

### 9.2 Internal Security Testing

| Test Type | Frequency | Owner | Tool |
|---|---|---|---|
| Container image vulnerability scan | Every CI build | Security Engineer | Trivy |
| Dependency vulnerability scan | Every CI build | Security Engineer | cargo-audit (Rust), npm audit (Node.js), pip-audit (Python), OWASP Dependency-Check (Java) |
| Infrastructure misconfiguration scan | Weekly | Security Engineer | Prowler (AWS); kube-bench (Kubernetes CIS benchmark) |
| Secret scanning | Every commit | All engineers (pre-commit + CI) | Gitleaks |
| SAST (Static Application Security Testing) | Every CI build | Security Engineer | Semgrep |
| DAST (Dynamic Application Security Testing) | Monthly | Security Engineer | OWASP ZAP |

### 9.3 Vulnerability Remediation SLA

| CVSS Severity | Remediation SLA |
|---|---|
| Critical (9.0–10.0) | 24 hours |
| High (7.0–8.9) | 7 days |
| Medium (4.0–6.9) | 30 days |
| Low (0.1–3.9) | 90 days |
| Informational | Best effort |

All vulnerabilities are tracked in the security ticket system (Jira / equivalent). Unresolved critical/high findings are reported to the CTO and CCO weekly.

---

## 10. Audit Logging

### 10.1 Audit Log Architecture

ForgePay uses OpenTelemetry (OTEL) for distributed tracing and structured logging across all services:

```
Payment Event
    |
OTEL SDK (instrumented in each service)
    |
OTEL Collector (Kubernetes DaemonSet) — af-south-1
    |
├── Jaeger / Tempo — distributed trace storage
├── CloudWatch Logs — operational log retention
└── PostgreSQL audit_events table — compliance audit records
        |
        S3 af-south-1 — long-term retention (5 years)
        S3 eu-west-1 — encrypted archive (7 years)
```

### 10.2 Events Logged

**Payment events (PostgreSQL `audit_events`):**
- Payment intent created: timestamp, merchant_id, amount, currency, payment_method_type
- Payment authorised / declined: timestamp, processor_response, risk_score
- Tokenization event: timestamp, token_id (no PAN logged), vault_operation
- Settlement: timestamp, merchant_id, amount, bank_account_hash
- Dispute/chargeback created: timestamp, merchant_id, amount, reason_code
- AML alert triggered: timestamp, rule_id, customer_id, disposition
- Sanctions match: timestamp, entity_id, list_name, resolution

**Access events (CloudTrail + Kubernetes audit):**
- AWS console login (success/failure, MFA status, source IP)
- IAM policy changes
- RDS access (query-level logging for sensitive schemas)
- Kubernetes API server requests (CRUD on production namespaces)
- Break-glass access activation and activity during session

**Immutability controls:**
- PostgreSQL audit tables use triggers preventing UPDATE and DELETE operations on audit records
- S3 audit buckets use Object Lock (Compliance mode) — records cannot be deleted or modified for retention period
- CloudTrail log file validation enabled — cryptographic hash chain prevents tampering

### 10.3 Log Retention

| Log Type | Retention | Storage |
|---|---|---|
| PostgreSQL audit_events | 5 years | RDS (hot) → S3 (cold archive after 90 days) |
| CloudWatch application logs | 90 days hot; archived to S3 | S3 af-south-1 |
| CloudTrail (API activity) | 7 years | S3 af-south-1 with Object Lock |
| Kubernetes audit logs | 90 days hot | CloudWatch → S3 |
| VPC Flow Logs | 90 days | S3 af-south-1 |
| WAF logs | 90 days | S3 af-south-1 |

---

## 11. Software Development Lifecycle (SDLC)

### 11.1 Secure Development Practices

- **Separation of environments:** Production, staging, and development environments are fully isolated — no production data in development or staging
- **Code review:** All changes require a minimum of 1 peer review (payment-critical: 2 reviewers including a senior engineer) before merging
- **Branch protection:** Main and release branches require passing CI, code review, and no force-push
- **Dependency management:** Dependencies are pinned to specific versions; Dependabot / Renovate for automated security updates
- **Secret scanning in CI:** Gitleaks blocks commits containing secrets before they reach Git history
- **SAST in CI:** Semgrep runs on every pull request; critical findings block merge

### 11.2 CI/CD Security

- GitHub Actions (or equivalent) runs in isolated runners with no production access
- Production deployments require a separate approval step from a senior engineer or CTO
- Container images are signed (Sigstore cosign — target) and verified at deploy time
- Infrastructure changes (Terraform) require separate plan-and-approve workflow; apply by CTO or SRE only

### 11.3 Dependency and Open-Source Management

Given ForgePay's use of the Hyperswitch open-source core (`crates/router`), special attention is paid to upstream Hyperswitch supply chain:
- Hyperswitch is pinned to a specific commit SHA (ref: `forgepay/config/base/pinned-upstreams.yaml`)
- SHA is verified on every build against the upstream Apache 2.0 repository
- Any upgrade of the Hyperswitch pin requires security review and testing in staging before production
- ForgePay-specific changes to `crates/` are tracked separately and do not touch `forgepay/` directory (separation of upstream and proprietary code)

---

## 12. Third-Party and Vendor Risk Management

### 12.1 Critical Vendor Register

| Vendor | Service | Data Accessed | PCI Scope | POPIA DPA | Review Frequency |
|---|---|---|---|---|---|
| AWS | Cloud infrastructure (EKS, RDS, S3, KMS, etc.) | All data (encrypted) | Yes (partial) | Yes (AWS DPA) | Annual |
| Card Acquirer (TBD) | Card payment processing | Tokens (no PANs) | Yes | Yes | Annual |
| Visa / Mastercard | Card scheme | Token metadata | Yes | Scheme rules | Annual |
| Circle (USDC) | Stablecoin issuance and redemption | Wallet addresses; no personal data | No | DPA if personal data flows | Annual |
| Blockchain analytics vendor (TBD) | Crypto wallet risk scoring | Wallet addresses (pseudonymous) | No | Assessment required | Annual |
| KYC vendor (TBD) | Identity verification (eKYC) | Personal data, ID images | No | Yes — critical | Annual |
| Chainalysis / equivalent | AML blockchain analytics | Transaction hashes | No | Assessment required | Annual |
| GoCardless / Peach / similar | Bank transfer (EFT) | Bank account numbers | No | Yes | Annual |

### 12.2 Vendor Security Assessment

All new vendors handling personal data or accessing ForgePay systems undergo a security assessment before onboarding:
- ISO 27001 / SOC 2 certificate review
- POPIA compliance questionnaire
- Penetration test report review
- Data processing agreement execution
- Annual review and certification refresh

---

## Sign-Off

| Role | Name | Signature | Date |
|---|---|---|---|
| Chief Technology Officer | | | |
| Chief Compliance Officer | | | |
| Chief Executive Officer | | | |
| Board Chairperson | | | |
