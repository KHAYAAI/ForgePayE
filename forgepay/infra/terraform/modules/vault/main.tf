# Vault module — KMS auto-unseal key + IRSA role for the in-cluster Vault
# service account. Vault itself runs as a Helm release on EKS; this module
# provisions only the AWS-side primitives it needs.

data "aws_region" "current" {}

resource "aws_kms_key" "unseal" {
  description             = "ForgePay ${var.environment} Vault auto-unseal"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = merge(var.tags, { Name = "forgepay-${var.environment}-vault-unseal" })
}

resource "aws_kms_alias" "unseal" {
  name          = "alias/forgepay-${var.environment}-vault-unseal"
  target_key_id = aws_kms_key.unseal.key_id
}

# IRSA: allow the Vault service account to use the unseal key.
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.eks_oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${replace(var.eks_oidc_provider_arn, "/^arn:aws:iam::[0-9]+:oidc-provider\\//", "")}:sub"
      values   = ["system:serviceaccount:${var.vault_namespace}:vault"]
    }
  }
}

resource "aws_iam_role" "vault" {
  name               = "forgepay-${var.environment}-vault"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "unseal" {
  statement {
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:DescribeKey"]
    resources = [aws_kms_key.unseal.arn]
  }
}

resource "aws_iam_role_policy" "unseal" {
  name   = "vault-unseal"
  role   = aws_iam_role.vault.id
  policy = data.aws_iam_policy_document.unseal.json
}
