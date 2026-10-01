# KMS keys for threshold custody.
#
#  * deposit key  — wraps the data key the stablecoin-gateway uses to envelope-encrypt one-time deposit keys.
#                   The gateway calls kms:Encrypt / kms:Decrypt with EncryptionContext {purpose = "deposit-keys"}
#                   (services/stablecoin-gateway/src/lib/keystore.ts). Least-privilege policy example:
#                   services/openfireblocks/deploy/aws/kms-policy.example.json.
#  * seal keys    — one per MPC node. The node calls kms:GenerateDataKey (first start) and kms:Decrypt (every start)
#                   with EncryptionContext {mpc-node = "<node id>"} (internal/mpc/sealprovider.go), so a wrapped seal
#                   key will not open for another node id even inside the same account.
#
# TRUST DOMAINS. The point of a threshold cluster is that no single party can reach t+1 shares. Seal keys of
# different nodes therefore belong in different AWS accounts (or at least under different administrators):
# instantiate this module once per node with its own provider alias, as in examples/threshold-custody:
#
#   module "kms_node1" {
#     source        = "../../modules/kms-keys"
#     providers     = { aws = aws.node1 }   # a provider configured for node1's account
#     mpc_node_ids  = ["node1"]
#     ...
#   }
#
# A single call with several ids is only appropriate for development: it places every share's seal key in one account.

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

locals {
  account_root = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"

  seal_contexts = { for id in var.mpc_node_ids : id => (
    var.allow_seal_check_context ? [id, "seal-check"] : [id]
  ) }

  deposit_users = var.deposit_key_enabled ? var.deposit_key_user_arns : []
}

# ── Deposit key ──────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "deposit_key" {
  count = var.deposit_key_enabled ? 1 : 0

  statement {
    sid       = "AccountRootKeepsControl"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.account_root]
    }
  }

  dynamic "statement" {
    for_each = length(var.key_admin_arns) > 0 ? [1] : []
    content {
      sid    = "KeyAdministrationWithoutUse"
      effect = "Allow"
      actions = [
        "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*", "kms:Update*", "kms:Revoke*",
        "kms:Disable*", "kms:Get*", "kms:Delete*", "kms:TagResource", "kms:UntagResource",
        "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
      ]
      resources = ["*"]
      principals {
        type        = "AWS"
        identifiers = var.key_admin_arns
      }
    }
  }

  dynamic "statement" {
    for_each = length(local.deposit_users) > 0 ? [1] : []
    content {
      sid       = "GatewayWrapsAndUnwrapsDepositKeysOnly"
      effect    = "Allow"
      actions   = ["kms:Encrypt", "kms:Decrypt"]
      resources = ["*"]
      principals {
        type        = "AWS"
        identifiers = local.deposit_users
      }
      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:purpose"
        values   = [var.deposit_key_purpose]
      }
    }
  }

  # Everyone else, and any other context, is refused even if an IAM policy in the account would allow it.
  dynamic "statement" {
    for_each = var.enforce_in_key_policy && length(local.deposit_users) > 0 ? [1] : []
    content {
      sid       = "DenyUseByAnyoneElse"
      effect    = "Deny"
      actions   = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"]
      resources = ["*"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "ArnNotEquals"
        variable = "aws:PrincipalArn"
        values   = local.deposit_users
      }
    }
  }

  dynamic "statement" {
    for_each = var.enforce_in_key_policy && length(local.deposit_users) > 0 ? [1] : []
    content {
      sid       = "DenyOtherEncryptionContexts"
      effect    = "Deny"
      actions   = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"]
      resources = ["*"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "StringNotEquals"
        variable = "kms:EncryptionContext:purpose"
        values   = [var.deposit_key_purpose]
      }
    }
  }
}

resource "aws_kms_key" "deposit" {
  count = var.deposit_key_enabled ? 1 : 0

  description             = "ForgePay ${var.environment} — stablecoin-gateway deposit-key wrapping"
  enable_key_rotation     = true
  deletion_window_in_days = var.deletion_window_in_days
  policy                  = data.aws_iam_policy_document.deposit_key[0].json
  tags                    = merge(var.tags, { Name = "${var.name_prefix}-${var.environment}-deposit-keys", Purpose = "deposit-keys" })
}

resource "aws_kms_alias" "deposit" {
  count = var.deposit_key_enabled ? 1 : 0

  name          = "alias/${var.name_prefix}-${var.environment}-deposit-keys"
  target_key_id = aws_kms_key.deposit[0].key_id
}

data "aws_iam_policy_document" "deposit_use" {
  count = var.deposit_key_enabled ? 1 : 0

  statement {
    sid       = "WrapAndUnwrapDepositKeysOnly"
    effect    = "Allow"
    actions   = ["kms:Encrypt", "kms:Decrypt"]
    resources = [aws_kms_key.deposit[0].arn]
    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:purpose"
      values   = [var.deposit_key_purpose]
    }
  }
}

resource "aws_iam_policy" "deposit_use" {
  count = var.deposit_key_enabled && var.create_iam_policies ? 1 : 0

  name        = "${var.name_prefix}-${var.environment}-deposit-keys-wrap"
  description = "Wrap/unwrap stablecoin-gateway deposit keys with the deposit KMS key, purpose=${var.deposit_key_purpose} only."
  policy      = data.aws_iam_policy_document.deposit_use[0].json
  tags        = var.tags
}

# ── MPC node seal keys (one per node id) ─────────────────────────────────────

data "aws_iam_policy_document" "seal_key" {
  for_each = var.mpc_node_ids

  statement {
    sid       = "AccountRootKeepsControl"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.account_root]
    }
  }

  dynamic "statement" {
    for_each = length(var.key_admin_arns) > 0 ? [1] : []
    content {
      sid    = "KeyAdministrationWithoutUse"
      effect = "Allow"
      actions = [
        "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*", "kms:Update*", "kms:Revoke*",
        "kms:Disable*", "kms:Get*", "kms:Delete*", "kms:TagResource", "kms:UntagResource",
        "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
      ]
      resources = ["*"]
      principals {
        type        = "AWS"
        identifiers = var.key_admin_arns
      }
    }
  }

  dynamic "statement" {
    for_each = length(lookup(var.mpc_node_user_arns, each.key, [])) > 0 ? [1] : []
    content {
      sid       = "NodeUsesItsOwnSealKeyOnly"
      effect    = "Allow"
      actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
      resources = ["*"]
      principals {
        type        = "AWS"
        identifiers = var.mpc_node_user_arns[each.key]
      }
      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:mpc-node"
        values   = local.seal_contexts[each.key]
      }
    }
  }

  dynamic "statement" {
    for_each = var.enforce_in_key_policy && length(lookup(var.mpc_node_user_arns, each.key, [])) > 0 ? [1] : []
    content {
      sid       = "DenyUseByAnyoneElse"
      effect    = "Deny"
      actions   = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"]
      resources = ["*"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "ArnNotEquals"
        variable = "aws:PrincipalArn"
        values   = var.mpc_node_user_arns[each.key]
      }
    }
  }

  dynamic "statement" {
    for_each = var.enforce_in_key_policy && length(lookup(var.mpc_node_user_arns, each.key, [])) > 0 ? [1] : []
    content {
      sid       = "DenyOtherEncryptionContexts"
      effect    = "Deny"
      actions   = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"]
      resources = ["*"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "StringNotEquals"
        variable = "kms:EncryptionContext:mpc-node"
        values   = local.seal_contexts[each.key]
      }
    }
  }
}

resource "aws_kms_key" "seal" {
  for_each = var.mpc_node_ids

  description             = "ForgePay ${var.environment} — MPC node ${each.key} seal-key wrapping"
  enable_key_rotation     = true
  deletion_window_in_days = var.deletion_window_in_days
  policy                  = data.aws_iam_policy_document.seal_key[each.key].json
  tags                    = merge(var.tags, { Name = "${var.name_prefix}-${var.environment}-mpc-seal-${each.key}", Purpose = "mpc-seal", MpcNode = each.key })
}

resource "aws_kms_alias" "seal" {
  for_each = var.mpc_node_ids

  name          = "alias/${var.name_prefix}-${var.environment}-mpc-seal-${each.key}"
  target_key_id = aws_kms_key.seal[each.key].key_id
}

data "aws_iam_policy_document" "seal_use" {
  for_each = var.mpc_node_ids

  statement {
    sid       = "NodeWrapsAndUnwrapsItsOwnSealKey"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [aws_kms_key.seal[each.key].arn]
    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:mpc-node"
      values   = local.seal_contexts[each.key]
    }
  }
}

resource "aws_iam_policy" "seal_use" {
  for_each = var.create_iam_policies ? var.mpc_node_ids : toset([])

  name        = "${var.name_prefix}-${var.environment}-mpc-seal-${each.key}"
  description = "MPC node ${each.key}: generate/unwrap its seal key with its own KMS key, mpc-node=${each.key} only."
  policy      = data.aws_iam_policy_document.seal_use[each.key].json
  tags        = var.tags
}
