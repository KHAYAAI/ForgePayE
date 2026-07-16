output "unseal_key_arn" {
  value = aws_kms_key.unseal.arn
}

output "vault_role_arn" {
  value = aws_iam_role.vault.arn
}
