# Monitoring module — CloudWatch log group, SNS alert topic, and baseline
# alarms for the EKS/RDS/Redis data plane.

resource "aws_cloudwatch_log_group" "cluster" {
  name              = "/forgepay/${var.environment}/cluster"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_sns_topic" "alerts" {
  name = "forgepay-${var.environment}-alerts"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "forgepay-${var.environment}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU above 80% for 15 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "forgepay-${var.environment}-redis-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "EngineCPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Redis CPU above 80% for 15 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions = {
    CacheClusterId = var.redis_cluster_id
  }
  tags = var.tags
}
