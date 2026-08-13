output "db_endpoint" {
  value = aws_db_instance.this.endpoint
}

output "db_instance_id" {
  value = aws_db_instance.this.id
}

output "db_address" {
  value = aws_db_instance.this.address
}

output "master_user_secret_arn" {
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
  description = "Secrets Manager ARN holding the RDS-generated master password. Grant read access via IRSA (see modules/secrets) rather than copying the value into an env var."
}
