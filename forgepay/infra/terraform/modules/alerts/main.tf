# Alerts module — the SNS topic the stablecoin-gateway's alert sink publishes to, an IAM policy that lets the
# gateway role publish, and CloudWatch alarms that notify the same topic.
#
# Separate from modules/monitoring (platform CPU alarms, topic "<env>-alerts") so custody alerts can have their
# own subscribers and their own encryption key.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  topic_name = "${var.name_prefix}-${var.environment}-custody-alerts"
  namespace  = "ForgePay/${var.environment}/StablecoinGateway"
  log_alarms = var.gateway_log_group_name == null ? {} : var.log_alarms
}

resource "aws_sns_topic" "alerts" {
  name              = local.topic_name
  kms_master_key_id = var.kms_master_key_id
  tags              = merge(var.tags, { Name = local.topic_name })
}

data "aws_iam_policy_document" "topic" {
  statement {
    sid       = "AccountOwnerManagesTopic"
    effect    = "Allow"
    actions   = ["sns:Publish", "sns:Subscribe", "sns:GetTopicAttributes", "sns:SetTopicAttributes", "sns:ListSubscriptionsByTopic", "sns:AddPermission", "sns:RemovePermission", "sns:DeleteTopic"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid       = "CloudWatchAlarmsPublish"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  dynamic "statement" {
    for_each = var.gateway_role_arn == null ? [] : [1]
    content {
      sid       = "GatewayPublishes"
      effect    = "Allow"
      actions   = ["sns:Publish"]
      resources = [aws_sns_topic.alerts.arn]
      principals {
        type        = "AWS"
        identifiers = [var.gateway_role_arn]
      }
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.topic.json
}

resource "aws_sns_topic_subscription" "this" {
  for_each = var.subscriptions

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = each.value.protocol
  endpoint  = each.value.endpoint
}

# ── Gateway publish permission ───────────────────────────────────────────────

data "aws_iam_policy_document" "publish" {
  statement {
    sid       = "PublishCustodyAlerts"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
  }

  # Only needed (and only emitted) when the topic is encrypted with a customer-managed key.
  dynamic "statement" {
    for_each = var.kms_master_key_id == null ? [] : [1]
    content {
      sid       = "UseTopicKey"
      effect    = "Allow"
      actions   = ["kms:GenerateDataKey*", "kms:Decrypt"]
      resources = ["*"]
      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["sns.*.amazonaws.com"]
      }
    }
  }
}

resource "aws_iam_policy" "publish" {
  name        = "${var.name_prefix}-${var.environment}-custody-alerts-publish"
  description = "Publish to the ${local.topic_name} SNS topic."
  policy      = data.aws_iam_policy_document.publish.json
  tags        = var.tags
}

resource "aws_iam_role_policy_attachment" "gateway" {
  count = var.gateway_role_name == null ? 0 : 1

  role       = var.gateway_role_name
  policy_arn = aws_iam_policy.publish.arn
}

# ── Log-pattern alarms ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_metric_filter" "this" {
  for_each = local.log_alarms

  name           = "${var.name_prefix}-${var.environment}-${each.key}"
  log_group_name = var.gateway_log_group_name
  pattern        = each.value.pattern

  metric_transformation {
    name          = each.key
    namespace     = local.namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "log" {
  for_each = local.log_alarms

  alarm_name          = "${var.name_prefix}-${var.environment}-gateway-${replace(each.key, "_", "-")}"
  alarm_description   = each.value.description
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = each.key
  namespace           = local.namespace
  period              = each.value.period
  statistic           = "Sum"
  threshold           = each.value.threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = var.tags

  depends_on = [aws_cloudwatch_log_metric_filter.this]
}

# ── Alarms on metrics published by the alert sink ────────────────────────────

resource "aws_cloudwatch_metric_alarm" "custom" {
  for_each = var.custom_metric_alarms

  alarm_name          = "${var.name_prefix}-${var.environment}-gateway-${replace(each.key, "_", "-")}"
  alarm_description   = each.value.description
  comparison_operator = each.value.comparison_operator
  evaluation_periods  = each.value.evaluation_periods
  metric_name         = each.value.metric_name
  namespace           = each.value.namespace
  period              = each.value.period
  statistic           = each.value.statistic
  threshold           = each.value.threshold
  treat_missing_data  = each.value.treat_missing_data
  dimensions          = each.value.dimensions
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = var.tags
}
