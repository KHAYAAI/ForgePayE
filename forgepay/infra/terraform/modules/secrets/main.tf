# Secrets module — AWS Secrets Manager for platform secrets.
#
# EXTERNAL_DEPENDENCIES.md lists Secrets Manager as 🔴 required for MVP, but no
# Terraform provisioned it: the secrets it describes had nowhere to live except
# Helm values, which CLAUDE.md explicitly forbids.
#
# Design notes:
#  - Secret VALUES are never set here. Terraform state is not a secret store —
#    anything passed through a `.tf` variable ends up in plaintext in state.
#    This module creates the containers, their KMS key, their rotation policy
#    and the IRSA role that lets pods read them. Values are written once,
#    out-of-band, with `aws secretsmanager put-secret-value`.
#  - `JWT_SECRET` is included deliberately. The console falls back to a
#    hardcoded development secret when it is unset, so it must exist before
#    any environment is exposed (see apps/platform/lib/jwt-secret.ts, which now
#    refuses to boot in production without it).

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

# ── Encryption ───────────────────────────────────────────────────────────────

resource "aws_kms_key" "secrets" {
  description             = "ForgePay ${var.environment} — Secrets Manager encryption"
  enable_key_rotation     = true
  deletion_window_in_days = var.environment == "production" ? 30 : 7
  tags                    = var.tags
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/forgepay-${var.environment}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

# ── Secret containers ────────────────────────────────────────────────────────

locals {
  # Harvested from services/*/.env.example and EXTERNAL_DEPENDENCIES.md.
  # Self-generated (openssl rand -hex 32) — not third-party credentials.
  platform_secrets = {
    "jwt-secret"              = "Console session signing key. Console refuses to boot in production without it."
    "encryption-key"          = "Application-level field encryption key."
    "internal-webhook-secret" = "HMAC-SHA256 secret for service-to-service webhooks."
    "console-secret"          = "Console server-side session secret."
    "signer-private-key"      = "Custody/settlement signer. Prefer an HSM or KMS-backed signer in production."
  }

  # Third-party credentials — created empty, populated when each vendor
  # contract is signed. See EXTERNAL_DEPENDENCIES.md for provisioning.
  vendor_secrets = {
    "stripe-api-key"             = "Card acquiring via Hyperswitch."
    "circle-api-key"             = "USDC mint/redeem and payouts."
    "alchemy-api-key"            = "EVM RPC across Ethereum, Base, Polygon, Arbitrum."
    "chainalysis-api-key"        = "Crypto AML and wallet screening."
    "kyc-vendor-api-key"         = "Merchant and agent-operator KYC. Vendor not yet selected."
    "hyperswitch-webhook-secret" = "Inbound webhook signature verification."
  }

  # Threshold-custody / stablecoin-gateway secrets (see docs/DEPLOYING_THRESHOLD_CUSTODY.md). Containers only:
  # values are written out-of-band. Names are grouped under stablecoin/, openfireblocks/ and mpc/ so IAM can
  # scope on the prefix. Each description says which env var / file consumes it.
  custody_secrets = var.custody_secrets_enabled ? {
    "stablecoin/payout-signer-key"      = "Hot payout wallet private key. Mounted as a file: gateway PAYOUT_SIGNER_KEY_FILE. Prefer the threshold signer; this is the single-key signer."
    "stablecoin/sweep-gas-key"          = "Separate wallet that pays gas for deposit sweeps. Mounted as a file: gateway SWEEP_GAS_KEY_FILE."
    "stablecoin/treasury-operating-key" = "Treasury operating (warm) wallet key. Mounted as a file: gateway TREASURY_WARM_KEY_FILE."
    "stablecoin/key-wrap-vault-approle" = "JSON {\"role_id\":..., \"secret_id\":...} for the gateway's Vault AppRole (KEY_WRAP_PROVIDER=vault): VAULT_ROLE_ID / VAULT_SECRET_ID. Unused with awskms."
    "stablecoin/admin-api-keys"         = "Comma-separated admin/operator API keys, each at least 32 chars: gateway VALID_API_KEYS."
    "stablecoin/merchant-api-keys"      = "Comma-separated merchantId:key pairs: gateway MERCHANT_API_KEYS."
    "stablecoin/postgres-password"      = "Gateway database password: POSTGRES_PASSWORD (or use the RDS-managed secret)."
    "openfireblocks/admin-api-key"      = "api-gateway ADMIN_API_KEY (customer provisioning and /admin/custody/*)."
    "openfireblocks/database-url"       = "api-gateway DATABASE_URL (postgresql://...)."
    "mpc/coordinator-key"               = "Coordinator ed25519 private key file (mpc-node coordinator-key): MPC_COORDINATOR_KEY_FILE on the mpc-signer."
    "mpc/coordinator-tls"               = "Coordinator mTLS client certificate bundle (cert.pem, key.pem, ca.pem) if not issued by cert-manager."
  } : {}

  all_secrets = merge(local.platform_secrets, local.vendor_secrets, local.custody_secrets)
}

# The treasury's cold address is a public address, not a secret, so it lives in Parameter Store as a plain String.
# The value is a deliberate non-address placeholder: an unset parameter makes the gateway refuse to start instead of
# sending surplus to a burn address. Set the real one with `aws ssm put-parameter --overwrite`; Terraform ignores it.
resource "aws_ssm_parameter" "treasury_cold_address" {
  count = var.custody_secrets_enabled ? 1 : 0

  name        = "/forgepay/${var.environment}/stablecoin/treasury-cold-address"
  description = "Gateway TREASURY_COLD_ADDRESS: where surplus above TREASURY_WARM_MAX_USD is sent. The gateway holds no key for it."
  type        = "String"
  value       = "UNSET-set-with-aws-ssm-put-parameter"
  tags        = merge(var.tags, { Environment = var.environment })

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_secretsmanager_secret" "this" {
  for_each = local.all_secrets

  name        = "forgepay/${var.environment}/${each.key}"
  description = each.value
  kms_key_id  = aws_kms_key.secrets.arn

  # Production keeps a recovery window so a mistaken destroy is reversible.
  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = merge(var.tags, {
    Environment = var.environment
    Secret      = each.key
  })
}

# ── Pod access (IRSA) ────────────────────────────────────────────────────────

data "aws_iam_policy_document" "assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.eks_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(var.eks_oidc_provider_arn, "/^arn:${data.aws_partition.current.partition}:iam::[0-9]+:oidc-provider\\//", "")}:sub"
      values   = ["system:serviceaccount:${var.service_account_namespace}:${var.service_account_name}"]
    }
  }
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [for s in aws_secretsmanager_secret.this : s.arn]
  }

  # The (non-secret) treasury cold address parameter, so the same reader can sync it.
  dynamic "statement" {
    for_each = var.custody_secrets_enabled ? [1] : []
    content {
      effect    = "Allow"
      actions   = ["ssm:GetParameter"]
      resources = [aws_ssm_parameter.treasury_cold_address[0].arn]
    }
  }

  # Needed to decrypt the values above; scoped to this module's key only.
  statement {
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.secrets.arn]
  }
}

resource "aws_iam_role" "secrets_reader" {
  name               = "forgepay-${var.environment}-secrets-reader"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy" "secrets_reader" {
  name   = "read-platform-secrets"
  role   = aws_iam_role.secrets_reader.id
  policy = data.aws_iam_policy_document.read_secrets.json
}
