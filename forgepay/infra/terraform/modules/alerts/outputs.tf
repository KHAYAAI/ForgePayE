output "topic_arn" {
  value       = aws_sns_topic.alerts.arn
  description = "The custody alert SNS topic. The gateway's alert code today (src/lib/alerts.ts) speaks webhook and PagerDuty only (ALERT_WEBHOOK_URL, ALERT_PAGERDUTY_ROUTING_KEY) and has no SNS setting; this topic is what an SNS sink or a webhook-to-SNS bridge would publish to, and what the CloudWatch alarms notify."
}

output "publish_policy_arn" {
  value = aws_iam_policy.publish.arn
}

output "publish_policy_json" {
  value = data.aws_iam_policy_document.publish.json
}

output "log_metric_namespace" {
  value = local.namespace
}

output "alarm_arns" {
  value = merge(
    { for k, v in aws_cloudwatch_metric_alarm.log : k => v.arn },
    { for k, v in aws_cloudwatch_metric_alarm.custom : k => v.arn },
  )
}
