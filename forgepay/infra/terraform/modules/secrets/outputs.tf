output "secret_arns" {
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
  description = "Secret name → ARN. Values are populated out-of-band, never by Terraform."
}

output "secret_names" {
  value = [for s in aws_secretsmanager_secret.this : s.name]
}

output "kms_key_arn" {
  value = aws_kms_key.secrets.arn
}

output "secrets_reader_role_arn" {
  value       = aws_iam_role.secrets_reader.arn
  description = "Annotate the Kubernetes service account with this for IRSA."
}

output "treasury_cold_address_parameter" {
  value       = one(aws_ssm_parameter.treasury_cold_address[*].name)
  description = "SSM parameter holding TREASURY_COLD_ADDRESS (public address; set out-of-band)."
}
