output "web_acl_arn" {
  value       = aws_wafv2_web_acl.this.arn
  description = "Set as `web_acl_id` on a CloudFront distribution, or used for a REGIONAL association."
}

output "web_acl_id" {
  value = aws_wafv2_web_acl.this.id
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.waf.name
}
