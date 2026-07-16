output "backup_bucket_name" {
  value = aws_s3_bucket.this["backup"].bucket
}

output "logs_bucket_name" {
  value = aws_s3_bucket.this["logs"].bucket
}

output "artifacts_bucket_name" {
  value = aws_s3_bucket.this["artifacts"].bucket
}
