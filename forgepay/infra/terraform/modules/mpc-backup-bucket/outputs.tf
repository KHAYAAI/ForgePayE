output "bucket_name" {
  value       = aws_s3_bucket.this.bucket
  description = "The node's MPC_BACKUP_S3_BUCKET."
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}

output "kms_key_arn" {
  value = local.kms_arn
}

output "writer_iam_policy_json" {
  value = data.aws_iam_policy_document.writer.json
}

output "writer_iam_policy_arn" {
  value = one(aws_iam_policy.writer[*].arn)
}

output "pruner_iam_policy_json" {
  value = data.aws_iam_policy_document.pruner.json
}

output "pruner_iam_policy_arn" {
  value = one(aws_iam_policy.pruner[*].arn)
}

output "object_lock_enabled" {
  value = var.object_lock_enabled
}
