output "deposit_key_arn" {
  value       = one(aws_kms_key.deposit[*].arn)
  description = "Set the gateway's KEY_WRAP_KMS_KEY_ID to this ARN (an alias can be repointed, an ARN cannot)."
}

output "deposit_key_alias" {
  value = one(aws_kms_alias.deposit[*].name)
}

output "deposit_key_iam_policy_json" {
  value       = one(data.aws_iam_policy_document.deposit_use[*].json)
  description = "Least-privilege policy for the gateway role (same shape as openfireblocks/deploy/aws/kms-policy.example.json)."
}

output "deposit_key_iam_policy_arn" {
  value = one(aws_iam_policy.deposit_use[*].arn)
}

output "mpc_seal_key_arns" {
  value       = { for k, v in aws_kms_key.seal : k => v.arn }
  description = "Node id -> key ARN. Set MPC_KMS_KEY_ID (mpc-node chart: seal.awskms.keyId) to the ARN."
}

output "mpc_seal_key_aliases" {
  value = { for k, v in aws_kms_alias.seal : k => v.name }
}

output "mpc_seal_iam_policy_json" {
  value       = { for k, v in data.aws_iam_policy_document.seal_use : k => v.json }
  description = "Node id -> least-privilege policy for that node's IRSA role."
}

output "mpc_seal_iam_policy_arns" {
  value = { for k, v in aws_iam_policy.seal_use : k => v.arn }
}
