# S3 module — backups, logs, and build artifacts buckets.

locals {
  buckets = {
    backup    = var.backup_bucket_name
    logs      = var.logs_bucket_name
    artifacts = var.artifacts_bucket_name
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets
  bucket   = each.value
  tags     = merge(var.tags, { Name = each.value, Purpose = each.key })
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = var.enable_versioning ? local.buckets : {}
  bucket   = aws_s3_bucket.this[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = local.buckets
  bucket                  = aws_s3_bucket.this[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
