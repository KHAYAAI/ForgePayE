# Example composition: AWS-side pieces of a threshold-custody deployment.
#
# Three MPC nodes, each in a DIFFERENT AWS account (a different trust domain), plus the platform account that
# runs the stablecoin-gateway. Every account gets its own provider alias; the kms-keys and mpc-backup-bucket
# modules are instantiated once per node with that alias, so no account ever holds another node's seal key or
# share backups. Nothing here contains a secret value.
#
#   terraform init && terraform plan -var-file=example.tfvars
#
# Backups: docs/disaster-recovery.md recommends a bucket in a DIFFERENT account from the node's own, so losing the
# node's account does not lose its backups. Both node buckets below therefore use the `backup` provider alias (a
# dedicated backup account); the node roles write to it cross-account. The backups are encrypted to the recovery
# keys before they get there, so the backup account's administrators see only ciphertext. To keep a node's bucket in the
# node's own account instead, point that module's `providers` at the node's alias.
#
# Node 3 in the Helm examples uses Vault instead of KMS (values-node3.yaml); it needs no KMS key here and is
# left out of the node map on purpose. Adapt the maps to your own topology.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

# Platform account: EKS, the gateway, alerts, secrets.
provider "aws" {
  region = var.platform_region
  default_tags {
    tags = { Project = "ForgePay", Environment = var.environment, ManagedBy = "Terraform" }
  }
}

# Backup account (see above).
provider "aws" {
  alias   = "backup"
  region  = var.backup_region
  profile = var.backup_profile
  default_tags {
    tags = { Project = "ForgePay", Environment = var.environment, ManagedBy = "Terraform", Purpose = "mpc-share-backups" }
  }
}

# Node accounts. Credentials come from the usual AWS config (profiles / assume-role), one per operator.
provider "aws" {
  alias   = "node1"
  region  = var.node1_region
  profile = var.node1_profile
  default_tags {
    tags = { Project = "ForgePay", Environment = var.environment, ManagedBy = "Terraform", MpcNode = "node1" }
  }
}

provider "aws" {
  alias   = "node2"
  region  = var.node2_region
  profile = var.node2_profile
  default_tags {
    tags = { Project = "ForgePay", Environment = var.environment, ManagedBy = "Terraform", MpcNode = "node2" }
  }
}

# ── Platform account ─────────────────────────────────────────────────────────

# Deposit-key wrapping key for the stablecoin-gateway. Gateway role = the IRSA role of its service account.
module "kms_platform" {
  source = "../../modules/kms-keys"

  environment           = var.environment
  deposit_key_enabled   = true
  deposit_key_user_arns = [var.gateway_role_arn]
  key_admin_arns        = var.platform_key_admin_arns
  tags                  = { Module = "KMS" }
}

module "alerts" {
  source = "../../modules/alerts"

  environment            = var.environment
  subscriptions          = var.alert_subscriptions
  gateway_role_arn       = var.gateway_role_arn
  gateway_role_name      = var.gateway_role_name
  gateway_log_group_name = var.gateway_log_group_name
  tags                   = { Module = "Alerts" }
}

# ── Node 1 (account A): KMS seal key; backup bucket in the backup account ────

module "kms_node1" {
  source    = "../../modules/kms-keys"
  providers = { aws = aws.node1 }

  environment         = var.environment
  deposit_key_enabled = false
  mpc_node_ids        = ["node1"]
  mpc_node_user_arns  = { node1 = [var.node1_role_arn] }
  key_admin_arns      = var.node1_key_admin_arns
  tags                = { Module = "KMS", MpcNode = "node1" }
}

module "backup_node1" {
  source    = "../../modules/mpc-backup-bucket"
  providers = { aws = aws.backup }

  environment            = var.environment
  node_id                = "node1"
  bucket_name            = var.node1_backup_bucket
  writer_role_arns       = [var.node1_role_arn]
  backup_pruner_role_arn = var.node1_pruner_role_arn # the node prunes its own old backups, so normally == node1_role_arn
  tags                   = { Module = "MpcBackup", MpcNode = "node1" }
}

# ── Node 2 (account B): KMS seal key; backup bucket in the backup account ────

module "kms_node2" {
  source    = "../../modules/kms-keys"
  providers = { aws = aws.node2 }

  environment         = var.environment
  deposit_key_enabled = false
  mpc_node_ids        = ["node2"]
  mpc_node_user_arns  = { node2 = [var.node2_role_arn] }
  key_admin_arns      = var.node2_key_admin_arns
  tags                = { Module = "KMS", MpcNode = "node2" }
}

module "backup_node2" {
  source    = "../../modules/mpc-backup-bucket"
  providers = { aws = aws.backup }

  environment            = var.environment
  node_id                = "node2"
  bucket_name            = var.node2_backup_bucket
  writer_role_arns       = [var.node2_role_arn]
  backup_pruner_role_arn = var.node2_pruner_role_arn
  # Object lock is OFF by default; read the trade-off on the variable before turning it on.
  object_lock_enabled = false
  tags                = { Module = "MpcBackup", MpcNode = "node2" }
}
