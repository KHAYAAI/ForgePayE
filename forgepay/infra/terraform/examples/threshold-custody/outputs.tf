output "gateway_kms_key_arn" {
  value       = module.kms_platform.deposit_key_arn
  description = "Gateway KEY_WRAP_KMS_KEY_ID."
}

output "alert_topic_arn" {
  value = module.alerts.topic_arn
}

output "mpc_seal_key_arns" {
  value = merge(module.kms_node1.mpc_seal_key_arns, module.kms_node2.mpc_seal_key_arns)
}

output "mpc_backup_buckets" {
  value = {
    node1 = module.backup_node1.bucket_name
    node2 = module.backup_node2.bucket_name
  }
}
