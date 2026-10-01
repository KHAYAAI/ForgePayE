# Backup bucket for ONE MPC node's encrypted share backups.
#
# The node encrypts each backup to MPC_BACKUP_RECIPIENTS before it leaves the node; this bucket is the second
# layer: versioned, SSE-KMS, private, deletion locked down to a single named pruner role. Instantiate once per
# node (never one bucket for the whole cluster). Put it in an AWS account that is NOT the node's own cluster account,
# so losing that account does not lose its backups (docs/disaster-recovery.md): the writer/pruner roles may be
# cross-account, the bucket policy and key policy below admit them explicitly.

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
  create_key = var.kms_key_arn == null
  kms_arn    = local.create_key ? aws_kms_key.backup[0].arn : var.kms_key_arn
  partition  = data.aws_partition.current.partition
  account_id = data.aws_caller_identity.current.account_id
}

# ── Encryption key (optional) ────────────────────────────────────────────────

data "aws_iam_policy_document" "key" {
  count = local.create_key ? 1 : 0

  statement {
    sid       = "AccountRootKeepsControl"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  statement {
    sid       = "WriterAndPrunerUseViaS3Only"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = distinct(concat(var.writer_role_arns, [var.backup_pruner_role_arn]))
    }
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${data.aws_region.current.name}.amazonaws.com"]
    }
  }
}

data "aws_region" "current" {}

resource "aws_kms_key" "backup" {
  count = local.create_key ? 1 : 0

  description             = "ForgePay ${var.environment} — MPC node ${var.node_id} share-backup bucket"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.key[0].json
  tags                    = merge(var.tags, { Name = "${var.name_prefix}-${var.environment}-mpc-backup-${var.node_id}" })
}

resource "aws_kms_alias" "backup" {
  count = local.create_key ? 1 : 0

  name          = "alias/${var.name_prefix}-${var.environment}-mpc-backup-${var.node_id}"
  target_key_id = aws_kms_key.backup[0].key_id
}

# ── Bucket ───────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "this" {
  bucket              = var.bucket_name
  force_destroy       = var.force_destroy
  object_lock_enabled = var.object_lock_enabled
  tags                = merge(var.tags, { Name = var.bucket_name, Purpose = "mpc-share-backup", MpcNode = var.node_id })
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = local.kms_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  # Versioning must exist before lifecycle rules that reference noncurrent versions.
  depends_on = [aws_s3_bucket_versioning.this]

  rule {
    id     = "expire-noncurrent-and-clean-up"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = var.abort_incomplete_multipart_days
    }
  }

  rule {
    id     = "remove-orphaned-delete-markers"
    status = "Enabled"

    filter {}

    expiration {
      expired_object_delete_marker = true
    }
  }
}

resource "aws_s3_bucket_object_lock_configuration" "this" {
  count  = var.object_lock_enabled ? 1 : 0
  bucket = aws_s3_bucket.this.id

  rule {
    default_retention {
      mode = var.object_lock_mode
      days = var.object_lock_retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}

# ── Bucket policy ────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  # Explicit allows, so the bucket also works when the node's role lives in a DIFFERENT account (which is what
  # docs/disaster-recovery.md recommends: losing the node's account must not lose its backups). In that case the role's
  # own identity policy (the writer / pruner IAM policies below) must allow the same actions.
  statement {
    sid       = "WritersWriteAndReadBackups"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.this.arn}/*"]
    principals {
      type        = "AWS"
      identifiers = var.writer_role_arns
    }
  }

  statement {
    sid       = "WritersListBackups"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.this.arn]
    principals {
      type        = "AWS"
      identifiers = distinct(concat(var.writer_role_arns, [var.backup_pruner_role_arn]))
    }
  }

  statement {
    sid       = "PrunerDeletesBackups"
    effect    = "Allow"
    actions   = ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:GetObjectVersion", "s3:ListBucketVersions"]
    resources = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
    principals {
      type        = "AWS"
      identifiers = [var.backup_pruner_role_arn]
    }
  }

  # Deletion is the one operation that destroys a backup, so only the named pruner may do it. Lifecycle
  # expiration is performed by the S3 service itself and is not affected by this statement.
  statement {
    sid       = "DenyDeleteExceptBackupPruner"
    effect    = "Deny"
    actions   = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
    resources = ["${aws_s3_bucket.this.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [var.backup_pruner_role_arn]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = data.aws_iam_policy_document.bucket.json

  depends_on = [aws_s3_bucket_public_access_block.this]
}

# ── IAM policies for the roles that use the bucket ───────────────────────────

data "aws_iam_policy_document" "writer" {
  statement {
    sid       = "WriteAndReadBackups"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.this.arn}/*"]
  }
  statement {
    sid       = "ListBackups"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.this.arn]
  }
  statement {
    sid       = "UseBackupKey"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [local.kms_arn]
  }
}

data "aws_iam_policy_document" "pruner" {
  statement {
    sid       = "ListAndReadToChooseWhatToPrune"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:ListBucketVersions", "s3:GetObject", "s3:GetObjectVersion"]
    resources = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
  }
  statement {
    sid       = "DeleteBackups"
    effect    = "Allow"
    actions   = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
    resources = ["${aws_s3_bucket.this.arn}/*"]
  }
  statement {
    sid       = "UseBackupKey"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [local.kms_arn]
  }
}

resource "aws_iam_policy" "writer" {
  count = var.create_iam_policies ? 1 : 0

  name        = "${var.name_prefix}-${var.environment}-mpc-backup-write-${var.node_id}"
  description = "MPC node ${var.node_id}: write share backups to ${var.bucket_name} (no delete)."
  policy      = data.aws_iam_policy_document.writer.json
  tags        = var.tags
}

resource "aws_iam_policy" "pruner" {
  count = var.create_iam_policies ? 1 : 0

  name        = "${var.name_prefix}-${var.environment}-mpc-backup-prune-${var.node_id}"
  description = "Backup pruner for ${var.bucket_name}: the only principal allowed to delete objects."
  policy      = data.aws_iam_policy_document.pruner.json
  tags        = var.tags
}
