# ForgePay Staging — AWS Secrets Manager Setup Guide

All production secrets for ForgePay staging are stored in AWS Secrets Manager.
No secrets should be hard-coded in Helm values, Kubernetes manifests, or `.env` files committed to git.

This guide walks through creating every required secret before the first deploy.

---

## Secret Naming Convention

All staging secrets follow this naming pattern:

```
forgepay/staging/{service}/{key}
```

For example:
- `forgepay/staging/global/jwt-secret`
- `forgepay/staging/payment-engine/stripe-api-key`
- `forgepay/staging/mor-layer/stripe-tax-api-key`

---

## How Secrets are Read at Startup

ForgePay services read secrets at startup via one of two mechanisms:

**1. Kubernetes External Secrets Operator (ESO)**
ESO syncs secrets from AWS Secrets Manager into Kubernetes Secrets automatically.
The `ExternalSecret` CRD references `forgepay/staging/{service}/{key}` and creates
a Kubernetes Secret that the Pod mounts as environment variables.

**2. Direct AWS SDK call (Python / Rust services)**
Some services (e.g., `mor-layer`, `compliance-monitor`) call
`boto3.client('secretsmanager').get_secret_value(SecretId='forgepay/staging/...')`
at startup. These require an IAM role attached to the EKS service account (IRSA).

---

## Rotation Policy

| Secret Type | Rotation Interval | Method |
|---|---|---|
| Database passwords | 30 days | AWS Secrets Manager auto-rotation (Lambda) |
| JWT secrets | 90 days | Manual rotation (requires rolling pod restart) |
| API keys (Stripe, Circle, etc.) | As needed | Manual (rotate in provider dashboard first) |
| Internal HMAC secrets | 90 days | Manual rotation |
| TLS certificates | Managed by cert-manager + Let's Encrypt | Automatic (60-day cert, 30-day renewal) |

---

## Creating All Required Secrets

Run the commands below **once** before deploying. Replace placeholder values with real credentials.

> Prerequisites: `aws` CLI configured with credentials for the staging account and region.

### Global Secrets

```bash
REGION="af-south-1"   # change to your staging region

# JWT signing secret (256-bit random)
aws secretsmanager create-secret \
  --name "forgepay/staging/global/jwt-secret" \
  --description "ForgePay staging JWT signing secret" \
  --secret-string "$(openssl rand -hex 32)" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=global

# Internal webhook HMAC secret
aws secretsmanager create-secret \
  --name "forgepay/staging/global/internal-webhook-secret" \
  --description "ForgePay internal inter-service HMAC secret" \
  --secret-string "$(openssl rand -hex 32)" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging

# AES-256 PII encryption key (32 bytes, base64-encoded)
aws secretsmanager create-secret \
  --name "forgepay/staging/global/encryption-key" \
  --description "ForgePay AES-256 key for PII at-rest encryption" \
  --secret-string "$(openssl rand -base64 32)" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging
```

### Database Credentials

```bash
# PostgreSQL master credentials
# Use the same password you set in your .env.staging file
aws secretsmanager create-secret \
  --name "forgepay/staging/database/master-credentials" \
  --description "ForgePay RDS master credentials" \
  --secret-string '{"username":"forgepay_staging","password":"YOUR_STRONG_PASSWORD_HERE"}' \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=rds

# The Kubernetes secret forgepay-db-credentials maps to this
# deploy-staging.sh creates it from .env.staging automatically
```

### Payment Engine (Hyperswitch)

```bash
# Hyperswitch master encryption key (required for PCI card vault)
# Generate: openssl rand -hex 64
aws secretsmanager create-secret \
  --name "forgepay/staging/payment-engine/master-enc-key" \
  --description "Hyperswitch card vault master encryption key" \
  --secret-string "$(openssl rand -hex 64)" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=payment-engine

# Hyperswitch admin API key
aws secretsmanager create-secret \
  --name "forgepay/staging/payment-engine/admin-api-key" \
  --description "Hyperswitch internal admin API key" \
  --secret-string "$(openssl rand -hex 32)" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=payment-engine

# Hyperswitch webhook secret
aws secretsmanager create-secret \
  --name "forgepay/staging/payment-engine/webhook-secret" \
  --description "Hyperswitch inbound webhook HMAC secret" \
  --secret-string "$(openssl rand -hex 32)" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=payment-engine

# Stripe (test keys — get from https://dashboard.stripe.com/test/apikeys)
aws secretsmanager create-secret \
  --name "forgepay/staging/payment-engine/stripe-api-key" \
  --description "Stripe test API key for staging" \
  --secret-string "sk_test_REPLACE_WITH_STRIPE_TEST_KEY" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=payment-engine

aws secretsmanager create-secret \
  --name "forgepay/staging/payment-engine/stripe-webhook-secret" \
  --description "Stripe test webhook signing secret" \
  --secret-string "whsec_REPLACE_WITH_STRIPE_TEST_WEBHOOK_SECRET" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=payment-engine
```

### Unified Router

```bash
aws secretsmanager create-secret \
  --name "forgepay/staging/unified-router/webhook-secret" \
  --description "Unified Router outgoing webhook HMAC secret" \
  --secret-string "$(openssl rand -hex 32)" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=unified-router
```

### MoR Layer

```bash
aws secretsmanager create-secret \
  --name "forgepay/staging/mor-layer/stripe-tax-api-key" \
  --description "Stripe Tax API key for MoR Layer (staging)" \
  --secret-string "sk_test_REPLACE_WITH_STRIPE_TEST_KEY" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=mor-layer
```

### Billing Engine (Kill Bill)

```bash
aws secretsmanager create-secret \
  --name "forgepay/staging/billing-engine/admin-credentials" \
  --description "Kill Bill admin credentials (staging)" \
  --secret-string '{"username":"admin","password":"REPLACE_WITH_KILLBILL_ADMIN_PASSWORD","api_key":"forgepay_staging","api_secret":"REPLACE_WITH_KILLBILL_API_SECRET"}' \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=billing-engine
```

### Stablecoin Gateway

```bash
# Circle sandbox API key (from https://console.circle.com)
aws secretsmanager create-secret \
  --name "forgepay/staging/stablecoin-gateway/circle-api-key" \
  --description "Circle sandbox API key" \
  --secret-string "REPLACE_WITH_CIRCLE_SANDBOX_KEY" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=stablecoin-gateway

# x402 facilitator wallet private key (testnet only — never use a mainnet key here)
aws secretsmanager create-secret \
  --name "forgepay/staging/stablecoin-gateway/x402-facilitator-key" \
  --description "x402 facilitator testnet wallet private key" \
  --secret-string "REPLACE_WITH_TESTNET_PRIVATE_KEY" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=stablecoin-gateway

# Alchemy API key for Polygon/Ethereum RPC
aws secretsmanager create-secret \
  --name "forgepay/staging/stablecoin-gateway/alchemy-api-key" \
  --description "Alchemy API key for EVM RPC (staging)" \
  --secret-string "REPLACE_WITH_ALCHEMY_KEY" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=stablecoin-gateway
```

### Crypto Gateway

```bash
aws secretsmanager create-secret \
  --name "forgepay/staging/crypto-gateway/webhook-secret" \
  --description "Crypto gateway webhook HMAC secret (Keagate)" \
  --secret-string "$(openssl rand -hex 32)" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=crypto-gateway

aws secretsmanager create-secret \
  --name "forgepay/staging/crypto-gateway/bitcoin-xpub" \
  --description "Bitcoin testnet extended public key" \
  --secret-string "REPLACE_WITH_TESTNET_BITCOIN_XPUB" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=crypto-gateway

aws secretsmanager create-secret \
  --name "forgepay/staging/crypto-gateway/alchemy-api-key" \
  --description "Alchemy API key for crypto gateway EVM RPC" \
  --secret-string "REPLACE_WITH_ALCHEMY_KEY" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=crypto-gateway
```

### Yield Engine

```bash
aws secretsmanager create-secret \
  --name "forgepay/staging/yield-engine/ondo-api-key" \
  --description "Ondo Finance sandbox API key" \
  --secret-string "REPLACE_WITH_ONDO_SANDBOX_KEY" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=yield-engine
```

### Agent Decision Framework

```bash
# Anthropic API key (Claude) for agent routing
aws secretsmanager create-secret \
  --name "forgepay/staging/agent-decision-framework/anthropic-api-key" \
  --description "Anthropic Claude API key for agent decision framework" \
  --secret-string "REPLACE_WITH_ANTHROPIC_API_KEY" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=agent-decision-framework
```

### Agent Identity

```bash
aws secretsmanager create-secret \
  --name "forgepay/staging/agent-identity/signing-key" \
  --description "Ed25519 private key for agent DID signing" \
  --secret-string "REPLACE_WITH_ED25519_PRIVATE_KEY" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=agent-identity
```

### Compliance Monitor

```bash
aws secretsmanager create-secret \
  --name "forgepay/staging/compliance-monitor/onfido-api-key" \
  --description "Onfido sandbox KYC API key" \
  --secret-string "REPLACE_WITH_ONFIDO_SANDBOX_KEY" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=compliance-monitor

aws secretsmanager create-secret \
  --name "forgepay/staging/compliance-monitor/chainalysis-api-key" \
  --description "Chainalysis blockchain risk scoring API key" \
  --secret-string "REPLACE_WITH_CHAINALYSIS_KEY" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=compliance-monitor
```

### Bank Connectivity

```bash
aws secretsmanager create-secret \
  --name "forgepay/staging/bank-connectivity/truelayer-credentials" \
  --description "TrueLayer open banking sandbox credentials" \
  --secret-string '{"client_id":"REPLACE_WITH_TRUELAYER_SANDBOX_CLIENT_ID","client_secret":"REPLACE_WITH_TRUELAYER_SANDBOX_SECRET"}' \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=bank-connectivity

aws secretsmanager create-secret \
  --name "forgepay/staging/bank-connectivity/plaid-credentials" \
  --description "Plaid sandbox credentials" \
  --secret-string '{"client_id":"REPLACE_WITH_PLAID_CLIENT_ID","secret":"REPLACE_WITH_PLAID_SANDBOX_SECRET"}' \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=bank-connectivity
```

### Observability

```bash
aws secretsmanager create-secret \
  --name "forgepay/staging/observability/grafana-admin-password" \
  --description "Grafana admin password for staging observability stack" \
  --secret-string "$(openssl rand -base64 20)" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=observability

# Optional: Slack webhook for alerts
aws secretsmanager create-secret \
  --name "forgepay/staging/observability/slack-webhook-url" \
  --description "Slack webhook URL for deploy and alert notifications" \
  --secret-string "https://hooks.slack.com/services/REPLACE_WITH_SLACK_WEBHOOK" \
  --region "${REGION}" \
  --tags Key=Project,Value=ForgePay Key=Environment,Value=staging Key=Service,Value=observability
```

---

## Verifying Secrets

After creating all secrets, verify they exist:

```bash
REGION="af-south-1"

# List all ForgePay staging secrets
aws secretsmanager list-secrets \
  --region "${REGION}" \
  --filter Key=name,Values=forgepay/staging \
  --query 'SecretList[].Name' \
  --output table

# Retrieve a specific secret value (for debugging)
aws secretsmanager get-secret-value \
  --secret-id "forgepay/staging/global/jwt-secret" \
  --region "${REGION}" \
  --query 'SecretString' \
  --output text
```

---

## Updating a Secret

To rotate or update a secret value:

```bash
aws secretsmanager update-secret \
  --secret-id "forgepay/staging/payment-engine/stripe-api-key" \
  --secret-string "sk_test_NEW_KEY_VALUE" \
  --region "${REGION}"
```

After updating a secret, you need to restart the affected pod(s) to pick up the new value:

```bash
kubectl rollout restart deployment/payment-engine -n forgepay-staging
```

---

## IAM Policy for EKS Service Accounts (IRSA)

Services that read secrets directly via the AWS SDK need an IAM role attached to their
Kubernetes service account. Terraform creates these roles automatically. The policy template is:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:af-south-1:ACCOUNT_ID:secret:forgepay/staging/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ],
      "Resource": "arn:aws:kms:af-south-1:ACCOUNT_ID:key/KMS_KEY_ID"
    }
  ]
}
```

This is applied by Terraform as part of the IRSA configuration in `modules/eks/`.

---

## Secrets NOT Stored in AWS Secrets Manager

The following are managed differently:

| Secret | Location | Why |
|---|---|---|
| TLS certificates | cert-manager + Let's Encrypt | Auto-provisioned from ingress annotations |
| Kubernetes service account tokens | Kubernetes API | Auto-managed by EKS |
| ECR auth tokens | Generated at runtime via `aws ecr get-login-password` | Ephemeral |
| Vault root token | HashiCorp Vault init (stored in K8s Secret) | Vault-specific bootstrap |
