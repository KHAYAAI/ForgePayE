# PCI DSS Scope Definition — ForgePay

## Document Purpose

This document defines the Cardholder Data Environment (CDE) boundary for ForgePay's PCI DSS Level 1 assessment. Accurate scoping is the most critical step in a PCI DSS engagement — both under-scoping (missing in-scope systems) and over-scoping (including systems that are truly isolated) create risk and cost.

**PCI DSS v4.0 Reference:** Requirements 1.2, 2.2, 3.1, 11.4, 12.5

---

## 1. Cardholder Data Flow

Understanding data flow is mandatory before defining scope. The following describes how cardholder data (CHD) moves through ForgePay:

```
Customer Browser / Mobile App
        │
        │ HTTPS (TLS 1.3)
        ▼
[AWS ALB / WAF] ← in-scope
        │
        │ Internal mTLS
        ▼
[Hyperswitch payment-engine] ← in-scope (CDE)
        │
        ├──► [Hyperswitch PCI Vault] ← in-scope (CDE) — raw PANs tokenized HERE
        │         │ Token (not PAN) returned
        │         │
        │    PANs encrypted at rest (AES-256), never leave vault
        │
        ├──► [Payment network (Visa/Mastercard)] — external, out of scope
        │
        └──► [PostgreSQL — payment-engine DB] ← in-scope (CDE) — stores tokens only
```

**Critical design fact:** Raw Primary Account Numbers (PANs) are tokenized by the Hyperswitch PCI vault at the point of entry. No other ForgePay service ever receives, stores, or transmits raw PANs. This is the primary scoping control for all other ForgePay services.

---

## 2. Cardholder Data Environment (CDE) — In-Scope Systems

The CDE includes all systems that store, process, or transmit CHD/SAD, and all systems that could affect the security of those systems (connected-to systems and security-providing systems).

### 2.1 Systems That Store, Process, or Transmit CHD

| System | Location | CHD/SAD Handled | Justification |
|--------|----------|-----------------|---------------|
| Hyperswitch payment-engine | EKS namespace: `payment-engine` | Processes card data in memory during transaction | Receives tokenization requests; routes payments |
| Hyperswitch PCI vault | EKS namespace: `pci-vault` | Stores encrypted PANs (AES-256), issues tokens | Core vault component — highest sensitivity |
| payment-engine PostgreSQL | RDS in CDE subnet | Stores payment tokens, transaction records | Contains tokenized card references |
| AWS ALB (payment-engine ingress) | CDE subnet | Terminates TLS from cardholder-facing connections | Receives encrypted CHD in transit |

### 2.2 Connected-To Systems (In-Scope by Connectivity)

| System | Location | Why In-Scope | Risk |
|--------|----------|--------------|------|
| EKS control plane (CDE node groups) | AWS EKS | Manages pod scheduling in CDE namespace | Compromise could affect CDE pods |
| AWS Secrets Manager (CDE secrets) | AWS account | Stores vault encryption keys, DB credentials | Key compromise = CHD exposure |
| HashiCorp Vault (if used for CDE secrets) | EKS `vault` namespace | Same as Secrets Manager | Key compromise = CHD exposure |
| Kubernetes NetworkPolicy controller | EKS | Enforces segmentation — security-providing system | Misconfiguration = CDE exposure |
| CI/CD pipeline (CDE deployments only) | GitHub Actions / ArgoCD | Deploys code to CDE components | Supply chain risk |
| Monitoring agents on CDE nodes | OTEL collectors | Access to CDE system logs | Log data could contain CHD fragments |
| Bastion / jump host for CDE access | EC2 or SSM Session Manager | Administrative access to CDE systems | Privileged access path |

### 2.3 Security-Providing Systems (In-Scope)

| System | Purpose |
|--------|---------|
| AWS WAF | Protects payment-engine ingress (required — currently a gap) |
| IDS/IPS (when implemented) | Monitors CDE network traffic |
| SIEM (when implemented) | Aggregates and correlates CDE security logs |
| IAM / RBAC system | Controls access to CDE systems |

---

## 3. Out-of-Scope Systems

The following ForgePay services are **out of scope** because they have no connectivity to CHD/SAD and are segmented from the CDE by Kubernetes NetworkPolicy.

### 3.1 Out-of-Scope ForgePay Services

| Service | Directory | Why Out of Scope |
|---------|-----------|-----------------|
| Marketing site | `forgepay/apps/web` | Static Next.js app; no payment processing; no connection to CDE namespace |
| Merchant dashboard | `forgepay/apps/dashboard` | Merchant-facing UI; accesses payment tokens only via API (never raw CHD) |
| Unified router | `forgepay/services/unified-router` | Webhook normalizer; receives payment events with tokens only, never raw PANs |
| MoR/tax/checkout layer | `forgepay/services/mor-layer` | Handles tax calculation and checkout flow; passes tokens, not raw PANs |
| Billing engine | `forgepay/services/billing-engine` | Subscription management; uses stored payment method tokens only |
| Stablecoin gateway | `forgepay/services/stablecoin-gateway` | USDC/USDT payments; completely separate payment rail, no card data |
| Crypto gateway | `forgepay/services/crypto-gateway` | Crypto payments; no card data handled |

### 3.2 Conditions for Out-of-Scope Classification

For each out-of-scope service, ALL of the following must be true and validated:

1. **No CHD/SAD in transit:** The service never receives raw PANs, CVVs, or track data — only tokens and non-sensitive payment metadata.
2. **No CHD/SAD at rest:** No database, cache, or log file contains raw CHD/SAD.
3. **Network segmentation enforced:** Kubernetes NetworkPolicy blocks direct pod-to-pod communication between out-of-scope namespaces and the CDE namespace (except via defined API endpoints through the ingress).
4. **Segmentation tested annually:** Network segmentation is validated by penetration testing (see `06_penetration_testing_scope.md`).

### 3.3 Segmentation Validation Requirements

Per PCI DSS v4.0 Requirement 11.4.5, segmentation controls must be tested:
- At least once every 6 months by a penetration tester
- After any changes to segmentation controls

For ForgePay, this means testing that pods in out-of-scope namespaces (e.g., `unified-router`, `mor-layer`) **cannot** reach pods or services in the `payment-engine` or `pci-vault` namespaces directly, and that Kubernetes NetworkPolicy is correctly enforced.

---

## 4. Network Segmentation Architecture

### 4.1 Kubernetes Namespace Structure

```
EKS Cluster
├── pci-vault (CDE)           ← Highest restriction
│     NetworkPolicy: deny-all ingress except payment-engine
├── payment-engine (CDE)      ← High restriction
│     NetworkPolicy: deny-all except from ALB + pci-vault egress
├── payment-engine-db (CDE)   ← RDS VPC subnet, no direct pod access
└── [Non-CDE Namespaces]      ← No ingress/egress to CDE namespaces
      ├── unified-router
      ├── mor-layer
      ├── dashboard
      ├── stablecoin-gateway
      └── crypto-gateway
```

### 4.2 NetworkPolicy Controls

**payment-engine namespace — ingress policy:**
```yaml
# Applied to: namespace payment-engine
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: payment-engine-ingress
  namespace: payment-engine
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx  # ALB ingress controller only
      ports:
        - protocol: TCP
          port: 8080
```

**pci-vault namespace — strict deny:**
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: pci-vault-deny-all-except-payment-engine
  namespace: pci-vault
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: payment-engine
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: payment-engine
    - to:  # Allow DNS
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
```

### 4.3 AWS VPC Segmentation

Beyond Kubernetes NetworkPolicy, AWS VPC security groups and subnet routing provide a second layer of network segmentation:

| Subnet | CIDR (example) | Systems | Internet Access |
|--------|---------------|---------|----------------|
| CDE Private Subnet A | 10.0.1.0/24 | payment-engine pods, pci-vault pods | No (NAT only) |
| CDE Private Subnet B | 10.0.2.0/24 | payment-engine RDS | No |
| Non-CDE Subnet | 10.0.10.0/24 | All other services | No (NAT only) |
| Public Subnet | 10.0.100.0/24 | ALB, NAT Gateway | Yes |

---

## 5. Data Flow Diagrams

### 5.1 New Payment — Card Entry to Token

```
1. Customer enters card on checkout page (forgepay/apps/web or merchant SDK)
2. Card data transmitted via HTTPS (TLS 1.3) to AWS ALB
3. ALB forwards to Hyperswitch payment-engine (internal mTLS)
4. payment-engine sends PAN + CVV to Hyperswitch PCI vault via internal API
5. PCI vault:
   a. Validates Luhn checksum
   b. Encrypts PAN with AES-256 under vault master key (stored in AWS Secrets Manager)
   c. Generates random token (16-digit, non-reversible without vault key)
   d. Returns token to payment-engine
6. payment-engine uses token for all downstream processing
7. payment-engine sends token + transaction data to card networks (Visa/Mastercard) via mTLS
8. Card networks authorize/decline
9. payment-engine stores token + authorization result in PostgreSQL (no raw PAN stored)
10. payment-engine returns payment result to caller
```

**Raw PAN exists only at steps 2–5. It is never persisted. All ForgePay services downstream of step 6 are out of scope.**

---

## 6. SAQ vs. ROC Decision Tree

```
Does ForgePay process >6M Visa OR >6M Mastercard transactions/year?
    YES ──► Level 1 ROC by QSA (this document)
    NO ──►  Does any card brand designate ForgePay as Level 1?
                YES ──► Level 1 ROC by QSA
                NO ──►  Is ForgePay a payment facilitator or service provider?
                            YES ──► Likely SAQ D (Service Provider) or Level 1 ROC
                            NO ──►  Determine SAQ type based on card acceptance method

Current ForgePay status: Level 1 ROC required (payment facilitator, scale target >6M/year)
```

### SAQ Types (Reference Only)

| SAQ Type | Applicable If |
|----------|--------------|
| SAQ A | Card-not-present; fully outsourced; no electronic CHD storage |
| SAQ A-EP | E-commerce; page elements hosted by third party |
| SAQ D (Merchant) | All other merchants not covered by A/A-EP/B/B-IP/C/C-VT |
| SAQ D (Service Provider) | Service providers not eligible for other SAQs |

---

## 7. Annual Scope Review Requirements

Per PCI DSS v4.0 Requirement 12.5.2, the scope of the PCI DSS assessment must be:
- Documented and confirmed by the assessed entity at least once every 12 months
- Confirmed after any significant changes to the cardholder data environment

**Triggers for immediate scope re-evaluation:**
- New payment method or channel added
- New third-party integration that touches payment data
- Changes to network segmentation architecture
- Addition of new AWS accounts or VPCs
- Changes to Kubernetes cluster structure
- Acquisition or merger
- New service that potentially handles CHD

---

*Document Owner: CISO / Head of Compliance*
*Classification: Confidential — Internal Use Only*
*Last Updated: 2026-06-25*
*Review Cadence: Annual minimum; immediately after significant changes*
