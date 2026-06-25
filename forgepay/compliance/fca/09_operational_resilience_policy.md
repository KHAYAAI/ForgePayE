# ForgePay — Operational Resilience Policy

**Document type:** FCA PI Application — Section G2 (Operational Resilience) and standalone policy  
**Applicant:** ForgePay Ltd  
**Legal basis:** FCA PS21/3 (Building Operational Resilience); FCA SS1/21; PSR 2017 reg 22; FCA SYSC 4  
**EBA Guidelines:** EBA/GL/2019/04 (ICT and Security Risk Management — referenced as good practice)  
**Prepared:** 25 June 2026  
**Version:** 1.0  
**Policy owner:** CTO / Chief Technology Officer  
**Co-owner:** CEO (governance; impact tolerance approvals)  
**Review frequency:** Annual; following any significant operational incident  

---

## 1. Introduction and Regulatory Context

ForgePay Ltd ("ForgePay") is committed to building and maintaining **operational resilience** — the ability to prevent, adapt to, respond to, recover from, and learn from operational disruptions.

The FCA's **PS21/3: Building Operational Resilience** (effective 31 March 2022, with full self-assessment and testing required by 31 March 2025) requires FCA-authorised firms to:

1. Identify their **important business services** (IBS)
2. Set **impact tolerances** for each IBS
3. **Map** the people, processes, technology, facilities, and third parties that underpin each IBS
4. Conduct **scenario testing** to identify vulnerabilities
5. Remain within impact tolerances as far as possible
6. Produce a **self-assessment** document reviewed by the Board

This policy fulfils ForgePay's PS21/3 obligations and supports the PSR 2017 requirement for adequate business continuity arrangements.

---

## 2. Important Business Services

ForgePay has identified the following **Important Business Services** — services whose disruption would cause **intolerable harm** to merchants, their end-customers, or market integrity:

| IBS ID | Important Business Service | Description |
|---|---|---|
| IBS-01 | Card Payment Processing | Ability for merchants to accept Visa, Mastercard, and Amex card payments via ForgePay's API |
| IBS-02 | Stablecoin Payment Processing | Ability for merchants to accept USDC and USDT payments and receive fiat or native stablecoin settlements |
| IBS-03 | Merchant Settlement and Payouts | Ability to remit settlement funds to merchant bank accounts and wallets on the agreed schedule |
| IBS-04 | Safeguarding Reconciliation | Daily reconciliation of relevant funds in the safeguarding account (regulatory obligation) |
| IBS-05 | Merchant Dashboard and Reporting | Ability for merchants to access transaction data, dispute management, and payout information |
| IBS-06 | AML Transaction Monitoring | Real-time screening and monitoring of transactions for ML/TF risk |

### 2.1 Rationale for IBS Selection

Services are classified as important business services where disruption would cause:
- **Financial harm** to merchants (unable to accept payments = revenue loss)
- **Regulatory harm** to ForgePay (safeguarding breach; failure to maintain AML controls)
- **Reputational harm** to ForgePay (loss of merchant trust; adverse FCA attention)
- **Market impact** (concentrated merchant dependency on ForgePay as sole payment processor)

Internal-only services (HR systems, internal reporting) are not IBS as they do not directly impact customers.

---

## 3. Impact Tolerances

An **impact tolerance** is the maximum tolerable duration and level of disruption ForgePay can absorb for each IBS before causing intolerable harm. The Board approves impact tolerances annually.

| IBS | Impact Tolerance (Max Outage) | RTO Target | RPO Target | Rationale |
|---|---|---|---|---|
| IBS-01 Card Payment Processing | 4 hours | 4 hours | 1 hour | Merchants lose card revenue after 2 hours; reputational damage accelerates after 4 hours |
| IBS-02 Stablecoin Processing | 8 hours | 8 hours | 2 hours | Lower time-sensitivity than cards for most use cases; on-chain transactions can be re-initiated |
| IBS-03 Merchant Settlement | 24 hours | 24 hours | 4 hours | Settlement delay beyond 24 hours breaches merchant contracts; PSR 2017 D+1 obligations |
| IBS-04 Safeguarding Reconciliation | 4 hours (end of business day) | 4 hours | 1 hour | Regulatory obligation — daily reconciliation must complete before end of business day |
| IBS-05 Dashboard / Reporting | 24 hours | 24 hours | 4 hours | Merchants can tolerate brief outage; extended outage causes dispute resolution failures |
| IBS-06 AML Monitoring | 1 hour (pause only; queue processes on recovery) | 1 hour | 15 minutes | Cannot halt payment processing but must queue alerts; extended suspension is regulatory breach |

**Definitions:**
- **RTO (Recovery Time Objective):** Maximum acceptable time to restore the IBS to operational status after an incident
- **RPO (Recovery Point Objective):** Maximum acceptable data loss (measured in time) — how far back in time ForgePay can afford to restore from backup

---

## 4. Infrastructure Mapping

### 4.1 Technology Resources

ForgePay's IBS are underpinned by the following technology resources:

| Component | Description | IBS Dependency | Resilience |
|---|---|---|---|
| AWS EKS (eu-west-2) | Kubernetes cluster running all ForgePay services | IBS-01–06 | Multi-AZ (3 AZs); auto-scaling; rolling deployments |
| Hyperswitch Router (crates/router) | Rust/Actix-Web payment router | IBS-01–03, IBS-06 | Kubernetes deployment with ≥ 2 replicas per AZ; HPA configured |
| AWS RDS PostgreSQL (Multi-AZ) | Payment data, merchant records, transaction history | IBS-01–06 | Multi-AZ standby; automatic failover ~60s; automated backups (daily) |
| Unified Router (TypeScript/Fastify) | Webhook normalisation and event streaming | IBS-01–03, IBS-05 | Kubernetes deployment; ≥ 2 replicas |
| Stablecoin Gateway (TypeScript) | USDC/USDT processing and x402 | IBS-02 | Kubernetes; redundant RPC endpoints |
| Crypto Gateway (TypeScript) | BTC/ETH/LTC/XMR processing | IBS-01 (crypto) | Kubernetes; multiple blockchain node providers |
| AML Engine (embedded in router) | Transaction monitoring (8-rule engine) | IBS-06 | Runs in-process with router; alert queue persists in RDS |
| AWS S3 | Document storage, backup, export | IBS-05 | 99.999999999% durability; versioning enabled |
| HashiCorp Vault | Secrets management (API keys, DB credentials) | IBS-01–06 | HA Vault cluster (3 nodes) in separate AZ |
| AWS KMS | Encryption key management | IBS-01–06 | AWS-managed; Regional HA |
| OpenTelemetry / Grafana | Observability (traces, metrics, logs) | IBS-01–06 (monitoring) | AWS CloudWatch as backup; Grafana Cloud secondary |
| AWS API Gateway / ALB | Load balancing and API routing | IBS-01–03 | Multi-AZ; automatic failover |

### 4.2 Multi-AZ Architecture Detail

ForgePay deploys across **three AWS Availability Zones** in eu-west-2 (London):
- `eu-west-2a`: Primary EKS node group, primary RDS instance
- `eu-west-2b`: Secondary EKS node group, RDS Multi-AZ standby
- `eu-west-2c`: Tertiary EKS node group (burst capacity)

The Kubernetes cluster uses:
- **Pod Disruption Budgets (PDB):** Minimum 2 pods available for each critical service during node disruptions
- **Horizontal Pod Autoscaler (HPA):** Scales pods based on CPU/memory metrics; pre-scales before expected load spikes
- **Cluster Autoscaler:** Adds/removes EC2 nodes based on pod scheduling demand
- **Rolling Deployments:** Zero-downtime deployments for all services

A **single AZ failure** will not cause any IBS to breach its impact tolerance — all critical services remain operational with reduced capacity.

### 4.3 External Dependencies (Third Parties)

| Third Party | Service Provided | IBS Dependency | Resilience/Mitigation |
|---|---|---|---|
| AWS (Amazon Web Services) | Cloud infrastructure (EKS, RDS, S3, KMS) | IBS-01–06 | Multi-AZ; AWS SLA 99.9%+; documented exit plan |
| Card acquirer(s) | Card payment authorisation and settlement | IBS-01, IBS-03 | Secondary acquirer on standby; acquirer SLA monitoring |
| Blockchain RPC providers | Access to BTC/ETH/LTC/XMR networks | IBS-02 | Multiple providers (e.g. Alchemy + Infura for ETH); automatic failover |
| Exchange partner(s) | USDC/USDT to fiat conversion | IBS-02, IBS-03 | Secondary exchange partner; FCA-registered only |
| Sanctioned-list data provider | OFAC/HMT sanctions database | IBS-06 | Daily automated download; local cache prevents real-time dependency |
| KYB/Identity verification provider | Merchant onboarding CDD | IBS-06 (onboarding) | Secondary provider on standby; onboarding can be suspended if unavailable |
| Safeguarding bank | Safeguarding account holding | IBS-04 | Single bank (UK credit institution); FSCS protection; change of bank documented in wind-down plan |
| Nominated safeguarding bank | Bank transfers for merchant settlement | IBS-03 | Backup bank account established; Faster Payments direct access via indirect participant |

### 4.4 People Resources

| Function | Role | Backup |
|---|---|---|
| Payment operations | Operations Manager | CTO covers |
| AML monitoring | AML Analyst (×2) | MLRO covers |
| Finance/Treasury | Finance Manager | CFO covers |
| Engineering on-call | Rotating on-call engineer | Secondary on-call defined in runbook |
| Compliance | Compliance Officer | MLRO covers Compliance for PSR |
| MLRO | MLRO | Deputy MLRO designated |

ForgePay maintains a **Minimum Staffing Level** that ensures all IBS can operate. If staffing falls below minimum (e.g., pandemic, mass resignation), the Business Continuity Plan triggers.

### 4.5 Facilities

ForgePay operates as a **cloud-native, remote-first organisation**. There is no single physical data centre. Key facilities:
- **Registered office:** [UK address] — administrative only
- **Staff locations:** Distributed across UK (remote working policy)
- **No single-point-of-presence dependency:** Platform operations are fully cloud-based

If ForgePay establishes a physical office, a facility resilience assessment will be added to this policy.

---

## 5. Scenario Testing

FCA PS21/3 requires firms to test their ability to remain within impact tolerances through **severe but plausible scenarios**. ForgePay conducts annual scenario tests.

### 5.1 Scenario Test Schedule

| Scenario | Type | Frequency | Last Tested | Next Test |
|---|---|---|---|---|
| Single AZ failure (eu-west-2b outage) | Technical failover | Annual | [Date] | [Date + 1 year] |
| RDS primary failure (database failover) | Technical failover | Annual | [Date] | [Date + 1 year] |
| Primary acquirer connection failure | Acquirer failover | Annual | [Date] | [Date + 1 year] |
| DDoS attack on payment API | Security/capacity | Annual | [Date] | [Date + 1 year] |
| Key person unavailability (CTO) | People resilience | Annual | [Date] | [Date + 1 year] |
| Ransomware / destructive cyberattack | Cyber resilience | Biennial | [Date] | [Date + 2 years] |
| Third-party cloud outage (full AWS region) | Cloud resilience | Biennial | [Date] | [Date + 2 years] |
| Safeguarding reconciliation failure | Regulatory resilience | Annual | [Date] | [Date + 1 year] |
| Wind-down simulation | Business resilience | Biennial | [Date] | [Date + 2 years] |

### 5.2 Test Methodology

Each scenario test follows a structured methodology:

1. **Pre-test preparation:** Define test scope, success criteria, and rollback plan
2. **Test execution:** Simulate the scenario in a staging environment (prefer production-equivalent)
3. **Impact measurement:** Measure actual recovery time against IBS impact tolerance
4. **Gap identification:** Document where impact tolerances were breached or nearly breached
5. **Remediation:** Track gaps to resolution in the Risk Register
6. **Board reporting:** Test results presented to Board within 30 days

### 5.3 Key Scenario Details

**Scenario 1: Single AZ Failure**

*Scenario:* eu-west-2b becomes unavailable. All pods and the RDS standby in that AZ are offline.

*Expected behaviour:*
- Kubernetes reschedules pods to eu-west-2a and eu-west-2c within 2–5 minutes
- RDS Multi-AZ automatic failover to eu-west-2a standby within ~60 seconds
- Payment API remains available throughout (brief latency spike expected)

*Success criteria (IBS-01):* Card payment processing remains available; no more than 60 seconds of increased error rate; full recovery within 5 minutes

**Scenario 2: Primary Acquirer Failure**

*Scenario:* Primary card acquirer API becomes unavailable for 2 hours.

*Expected behaviour:*
- ForgePay's routing engine detects acquirer failures after 3 consecutive failed authorisations
- Automatic failover to secondary acquirer within 60 seconds
- Merchants receive increased card-not-present fees (secondary acquirer rate) — merchant communication required

*Success criteria (IBS-01):* Card processing resumed within 10 minutes on secondary acquirer; impact tolerance of 4 hours not breached

**Scenario 4: DDoS Attack on Payment API**

*Scenario:* A volumetric DDoS attack targets ForgePay's API gateway at 10× normal traffic volume.

*Expected behaviour:*
- AWS Shield Standard (included in AWS) absorbs volumetric attack
- AWS WAF rate limiting activates automatically
- HPA scales API gateway pods to absorb legitimate traffic
- Malicious traffic blocked at edge; legitimate payments continue

*Success criteria (IBS-01):* Legitimate payment processing continues with < 500ms additional latency; impact tolerance not breached

---

## 6. Incident Management

### 6.1 Incident Classification

| Severity | Definition | Response SLA |
|---|---|---|
| P1 — Critical | IBS is unavailable or degraded beyond impact tolerance | 15-minute response; all-hands |
| P2 — High | IBS degraded but within impact tolerance; risk of breach | 30-minute response; incident team |
| P3 — Medium | Non-IBS service degraded; monitoring required | 2-hour response; on-call engineer |
| P4 — Low | Minor issue; no customer impact | Next business day |

### 6.2 Incident Response Process

```
Incident detected (OTEL alert / merchant report / internal detection)
        ↓
Incident commander designated (on-call engineer → escalate to CTO for P1)
        ↓
Initial assessment: IBS affected? Impact tolerance breach risk?
        ↓
        P1: All-hands Slack channel opened; CEO, CTO, MLRO notified
        ↓
Root cause investigation (using OTEL traces, logs, metrics in Grafana)
        ↓
Remediation actions (failover, scaling, code rollback via Kubernetes)
        ↓
Recovery confirmed: IBS restored within RTO
        ↓
Customer notification (if IBS impacted beyond 30 minutes):
  - Merchant email notification
  - Dashboard status page update
  - Webhook event (incident type)
        ↓
Post-incident review (within 5 business days):
  - Root cause analysis
  - Timeline reconstruction from OTEL traces
  - Remediation gap identification
  - Board report (for P1 and P2 incidents)
```

### 6.3 FCA Notification

ForgePay notifies the FCA of **major operational incidents** affecting payment services in accordance with FCA expectations under PS21/3 and PSR 2017 reg 29:

| Incident Type | FCA Notification Timing |
|---|---|
| IBS outage exceeding impact tolerance | As soon as practicable; within 4 hours for major outage |
| Cyber attack causing service disruption | Immediately upon confirmation |
| Data breach affecting payment data | Within 72 hours (UK GDPR + FCA notification) |
| Safeguarding account inaccessible | Within 24 hours |
| Acquirer/bank relationship failure | Within 48 hours if not resolved |

Notifications are made via FCA Connect or by telephone to the FCA supervision team, followed by written confirmation.

---

## 7. Business Continuity Plan (BCP)

### 7.1 BCP Trigger

The BCP is activated when:
- A P1 incident occurs and is not resolved within 2 hours
- A scenario arises that threatens ForgePay's ability to maintain any IBS within its impact tolerance for more than 4 hours
- The Wind-Down Plan is activated (see `06_wind_down_plan.md`)

### 7.2 BCP Actions (Immediate)

1. **CEO notified** by CTO within 15 minutes of P1 incident
2. **Incident command centre** established (Slack channel + video call)
3. **Staff call-in:** All technical staff rostered regardless of time zone
4. **Merchant communication:** Status page updated within 30 minutes; email within 60 minutes for extended outages
5. **FCA notified** per Section 6.3 timeline
6. **Alternative processing:** If ForgePay's infrastructure cannot be restored, evaluate manual merchant communication and fund hold procedures

### 7.3 Disaster Recovery (DR)

| DR Capability | Implementation | RTO |
|---|---|---|
| EKS cluster failover (within region) | Multi-AZ; pod rescheduling | < 5 minutes |
| RDS database failover | AWS Multi-AZ automatic failover | < 2 minutes |
| Data restoration from backup | AWS RDS automated backup; Point-in-Time Recovery | < 1 hour |
| Hyperswitch router restart | Kubernetes rolling restart; health checks | < 2 minutes |
| Total infrastructure rebuild (worst case) | Infrastructure-as-Code (Terraform); EKS cluster creation | < 4 hours |

ForgePay uses **Infrastructure-as-Code (Terraform)** for all AWS resource provisioning. In a catastrophic infrastructure failure, ForgePay can rebuild the entire environment from code within 4 hours, satisfying IBS-01's 4-hour impact tolerance.

---

## 8. Change Management

ForgePay manages changes to technology infrastructure through a formal **Change Management Process** to prevent service disruption caused by uncontrolled changes:

- **Standard changes:** Pre-approved, low-risk (e.g., routine security patches) — auto-approval
- **Normal changes:** Reviewed and approved by CTO; deployed in maintenance window (typically Sunday 02:00–06:00 UK time)
- **Emergency changes:** Authorised by CTO and CEO; post-change review required
- **Changes to AML rules:** Additional approval from MLRO required; test results documented
- **Kubernetes deployments:** Rolling deployment strategy; canary deployments for major changes
- **Hyperswitch upstream upgrades:** Tested in staging environment for minimum 2 weeks before production

---

## 9. Operational Resilience Self-Assessment

FCA PS21/3 requires an annual **self-assessment** reviewed by the Board.

### 9.1 Self-Assessment Summary (Template)

| Assessment Area | Status | Evidence |
|---|---|---|
| IBS identified and documented | [Complete / In Progress] | This document |
| Impact tolerances approved by Board | [Complete / In Progress] | Board resolution [date] |
| Mapping completed (people, tech, facilities, 3P) | [Complete / In Progress] | Sections 4.1–4.5 above |
| Scenario testing completed | [Complete / In Progress] | Test results [date] |
| Vulnerabilities identified | [X vulnerabilities] | Risk Register |
| Vulnerabilities remediated | [X / X complete] | Risk Register |
| Can remain within impact tolerances? | [Yes / Partially / No] | Test results |
| Board reviewed self-assessment | [Date] | Board minutes |

### 9.2 Known Vulnerabilities (to be completed upon testing)

| Vulnerability | IBS Affected | Risk Level | Remediation Plan | Target Date |
|---|---|---|---|---|
| Single safeguarding bank concentration risk | IBS-04 | Medium | Establish secondary bank relationship | [Date] |
| No full AWS region failover capability | IBS-01–06 | Medium | Evaluate multi-region deployment (Year 2) | [Date] |
| Blockchain RPC provider dependency | IBS-02 | Low | Additional RPC provider configured | [Date] |

---

## 10. Security Controls

### 10.1 PCI DSS

ForgePay's card payment processing is designed for **PCI DSS v4.0 compliance**:
- Annual QSA assessment before card processing commences
- Hyperswitch Vault handles all card data (PCI CDE out of scope for ForgePay's operational systems)
- Network segmentation between CDE and non-CDE environments

### 10.2 Penetration Testing

| Test Type | Frequency | Scope | Last Conducted | Next Due |
|---|---|---|---|---|
| External penetration test | Annual | Internet-facing API, web applications | [Date] | [Date] |
| Internal penetration test | Annual | Internal network, EKS cluster | [Date] | [Date] |
| Red team exercise | Biennial | Full-scope adversarial simulation | [Date] | [Date] |
| PCI DSS penetration test | Annual (PCI requirement) | CDE scope | [Date] | [Date] |

### 10.3 Vulnerability Management

- All container images scanned for CVEs on build (GitHub Actions + Snyk/Trivy)
- Critical CVEs patched within 24 hours; High CVEs within 7 days
- Monthly review of dependency vulnerabilities across all codebases

---

*Document version: 1.0 — 25 June 2026*  
*Owner: CTO (technology); CEO (governance); Compliance Officer (regulatory)*  
*Board approval required: Yes — impact tolerances and self-assessment*  
*Review: Annual*
