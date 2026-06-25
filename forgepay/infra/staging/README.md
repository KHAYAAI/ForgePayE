# ForgePay Staging Deployment Guide

This guide covers deploying ForgePay to a staging environment on AWS. Three regions are
supported: `af-south-1` (primary staging), `us-east-1`, and `eu-west-2`.

---

## Prerequisites

Install and configure the following tools before running any scripts:

| Tool | Version | Purpose |
|---|---|---|
| AWS CLI | >= 2.x | Provision AWS resources, push ECR images |
| kubectl | >= 1.29 | Manage Kubernetes workloads |
| Helm | >= 3.14 | Package and deploy ForgePay services |
| Terraform | >= 1.6 | Provision EKS, RDS, Redis, VPC, and supporting infra |
| Docker | >= 24.x | Build and push service images |
| jq | any | JSON parsing in deploy scripts |
| curl | any | Health checks in smoke tests |

AWS credentials must be configured with sufficient permissions (see `aws-prerequisites.sh` for
the required IAM actions). The simplest approach for a developer is:

```bash
aws configure           # set Access Key ID, Secret Access Key, and default region
aws sts get-caller-identity   # verify credentials are working
```

The Terraform state backend (S3 + DynamoDB) must be bootstrapped before the first `terraform apply`.
Run `aws-prerequisites.sh` once to set that up.

---

## Quick Start — 5 Commands

```bash
# 0. (First time only) Bootstrap AWS prerequisites
./forgepay/infra/staging/aws-prerequisites.sh af-south-1

# 1. Copy and fill in your secrets
cp forgepay/infra/staging/.env.staging.example forgepay/infra/staging/.env.staging
# edit .env.staging — fill in real values for your secrets

# 2. (First time only) Create secrets in AWS Secrets Manager
# See forgepay/infra/staging/SECRETS_SETUP.md

# 3. Deploy everything to af-south-1 staging
./forgepay/infra/staging/deploy-staging.sh af-south-1

# 4. Run smoke tests to verify the deployment
./forgepay/infra/staging/smoke-tests.sh --base-url https://staging.af.forgepay.io

# 5. When done, tear down to stop incurring costs
./forgepay/infra/staging/teardown-staging.sh af-south-1
```

---

## What Gets Deployed

### AWS Infrastructure (via Terraform)

- **VPC** with public/private subnets across 3 AZs
- **EKS cluster** (`forgepay-staging`) — Kubernetes 1.29, 2–5 nodes (`t3.xlarge`)
- **RDS PostgreSQL** — `db.t3.large`, single-AZ (staging cost saving)
- **ElastiCache Redis** — `cache.t3.medium`, single node
- **S3 buckets** — Terraform state, backups, artifacts, logs
- **KMS key** — secrets encryption
- **ECR repositories** — one per ForgePay service

### Kubernetes Workloads (via Helm)

All services run with **1 replica** in staging (vs 2+ in production):

| Service | Port | Description |
|---|---|---|
| payment-engine | 80/443 | Hyperswitch core payment router |
| unified-router | 3000 | Webhook normalizer |
| mor-layer | 8000 | MoR, tax, checkout |
| billing-engine | 8080 | Kill Bill subscriptions & billing |
| stablecoin-gateway | 3001 | USDC/USDT + x402 |
| crypto-gateway | 3002 | Crypto payments (Keagate fork) |
| yield-engine | 3007 | Yield optimization |
| rwa-registry | 3008 | Real-World Asset positions |
| enterprise-treasury | 3012 | Treasury management |
| agent-identity | 3010 | AI agent registry |
| agent-negotiation | 3011 | Agent-to-agent negotiation |
| agent-decision-framework | 3013 | Agent routing decisions |
| agent-credit-lines | 3016 | Agent credit management |
| compliance-monitor | 8001 | AML/compliance checks |
| liquidity-forecaster | 8002 | Liquidity forecasting |
| bank-connectivity | 3003 | Open banking / bank APIs |
| chain-sync | 8040 | EVM contract event listener |
| bank-whitelabel | 3015 | White-label banking |
| accounts-service | 3020 | USD/USDC wallet accounts |
| institutional-reporting | 3021 | Reporting for institutions |
| dashboard | 443 | Merchant dashboard (Next.js) |

---

## Estimated AWS Costs (Staging)

These estimates are for `af-south-1` with the staging-sized resources. Other regions are similar.

| Resource | Size | Est. $/month |
|---|---|---|
| EKS cluster | 3x `t3.xlarge` nodes | ~$200 |
| RDS PostgreSQL | `db.t3.large`, 50 GB | ~$80 |
| ElastiCache Redis | `cache.t3.medium` | ~$35 |
| NAT Gateway | 1x (single AZ) | ~$45 |
| Load Balancer (ALB) | 1x | ~$25 |
| ECR storage | ~20 images | ~$10 |
| S3 + CloudWatch Logs | logging + state | ~$10 |
| **Total** | | **~$405/month** |

> Tear down (`teardown-staging.sh`) when not actively testing to avoid ongoing charges.
> EKS node groups can also be scaled to 0 for temporary pauses: `eksctl scale nodegroup`.

---

## Tear Down

```bash
./forgepay/infra/staging/teardown-staging.sh af-south-1
```

The script asks for explicit confirmation (`yes I want to destroy staging`) before destroying
anything. It runs `helm uninstall` first, then `terraform destroy`.

> ECR repositories and S3 buckets are **not** destroyed automatically (they may contain images
> and state you want to keep). Delete them manually if you want a full clean slate.

---

## Directory Structure

```
forgepay/infra/staging/
├── README.md                     # This file
├── SECRETS_SETUP.md              # How to create secrets in AWS Secrets Manager
├── .env.staging.example          # Template for all service environment variables
├── aws-prerequisites.sh          # One-time AWS bootstrap (S3 state, DynamoDB, KMS, ECR)
├── deploy-staging.sh             # Single-command deploy
├── teardown-staging.sh           # Safe teardown
├── smoke-tests.sh                # Post-deployment smoke tests
├── terraform/
│   ├── af-south-1.tfvars         # Variables for af-south-1 staging
│   ├── us-east-1.tfvars          # Variables for us-east-1 staging
│   └── eu-west-2.tfvars          # Variables for eu-west-2 staging
└── helm/
    ├── af-south-1-values.yaml    # Helm overrides for af-south-1 staging
    ├── us-east-1-values.yaml     # Helm overrides for us-east-1 staging
    └── eu-west-2-values.yaml     # Helm overrides for eu-west-2 staging
```

---

## Troubleshooting

**Terraform init fails — backend not found**
Run `./aws-prerequisites.sh <region>` first to create the S3 bucket and DynamoDB table.

**EKS auth error after apply**
Run: `aws eks update-kubeconfig --region <region> --name forgepay-staging`

**Pods stuck in Pending**
Usually a resource or node issue: `kubectl describe pod <pod> -n forgepay-staging`

**Health checks fail immediately after deploy**
Services need 30–60 s to become ready after Helm reports success. The deploy script
waits up to 10 minutes. If they stay unhealthy check logs:
`kubectl logs -n forgepay-staging deployment/<service> --tail=100`

**Secrets not found**
Verify secrets exist in AWS Secrets Manager: `aws secretsmanager list-secrets --region <region>`.
See `SECRETS_SETUP.md` for the required secret names and format.
