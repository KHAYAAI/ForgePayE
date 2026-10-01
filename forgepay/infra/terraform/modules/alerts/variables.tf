variable "environment" { type = string }

variable "name_prefix" {
  type    = string
  default = "forgepay"
}

variable "subscriptions" {
  type = map(object({
    protocol = string
    endpoint = string
  }))
  default     = {}
  description = <<-EOT
    Subscriptions to the alert topic, keyed by a label of your choosing, e.g.
      { oncall_email = { protocol = "email", endpoint = "oncall@example.com" },
        sink         = { protocol = "https", endpoint = "https://alerts.example.com/sns" } }
    Email and HTTPS subscriptions stay "pending confirmation" until the recipient confirms; Terraform cannot do that for them.
    Put endpoints that are personal data (emails) in an untracked tfvars file.
  EOT
  validation {
    condition     = alltrue([for s in values(var.subscriptions) : contains(["email", "email-json", "https", "sqs", "lambda", "sms"], s.protocol)])
    error_message = "protocol must be one of email, email-json, https, sqs, lambda, sms."
  }
}

variable "kms_master_key_id" {
  type        = string
  default     = null
  description = <<-EOT
    Customer-managed KMS key (id, ARN or alias) for SNS server-side encryption. Null leaves the topic unencrypted.
    Do NOT use the AWS-managed alias/aws/sns key: CloudWatch alarms cannot publish to a topic encrypted with it.
    A customer-managed key's policy must allow cloudwatch.amazonaws.com and the gateway role kms:GenerateDataKey* and kms:Decrypt.
  EOT
}

variable "gateway_role_name" {
  type        = string
  default     = null
  description = "Name (not ARN) of the gateway's IRSA role. When set, the sns:Publish policy is attached to it. Leave null to attach the policy output yourself."
}

variable "gateway_role_arn" {
  type        = string
  default     = null
  description = "ARN of the gateway's role, added to the topic policy as an allowed publisher (needed for cross-account roles; optional in-account)."
}

variable "gateway_log_group_name" {
  type        = string
  default     = null
  description = "CloudWatch Logs group that receives the gateway's stdout (e.g. via Fluent Bit). Null skips the log-based alarms."
}

variable "log_alarms" {
  type = map(object({
    pattern     = string
    description = string
    threshold   = optional(number, 0)
    period      = optional(number, 300)
  }))
  description = <<-EOT
    Log-pattern alarms on the gateway's own log lines. The default patterns match the messages the gateway writes
    today (src/lib/*.ts); they are CloudWatch filter syntax and will need updating if those messages change.
    Each creates a metric ForgePay/<env>/StablecoinGateway/<key> and an alarm that fires when its Sum exceeds threshold.
  EOT
  default = {
    process_crash = {
      pattern     = "?\"Uncaught Exception\" ?\"Unhandled Rejection\" ?\"Fatal startup error\""
      description = "The gateway process exited on an unhandled error."
    }
    payout_failed = {
      pattern     = "\"[payout-worker]\" \"failed\""
      description = "A payout failed, or the payout worker could not reconcile one. Money may be in an unknown state: check by hand."
    }
    sweep_failed = {
      pattern     = "\"[sweeper]\" \"failed\""
      description = "A deposit sweep or a sweeper pass failed."
    }
    treasury_shortfall = {
      pattern     = "\"[treasury] SHORTFALL\""
      description = "The treasury could not cover a payout-wallet need (not enough, or the daily cap was reached). Payouts are waiting."
    }
    treasury_error = {
      pattern     = "\"[treasury]\" \"failed\""
      description = "A treasury pass or transfer failed."
    }
    settlement_failed = {
      pattern     = "\"[settlement]\" \"failed\""
      description = "A settlement pass failed for a chain or a deposit (RPC trouble, or a token that no longer verifies)."
    }
    payment_needs_reconciliation = {
      pattern     = "\"reconcile manually\""
      description = "A deposit expired short or received funds after expiry. Needs a person."
    }
    insecure_key_wrap = {
      pattern     = "\"PRODUCTION is wrapping deposit keys with an environment variable\""
      description = "The gateway is running in production with KEY_WRAP_PROVIDER=env."
    }
  }
}

variable "custom_metric_alarms" {
  type = map(object({
    namespace           = string
    metric_name         = string
    statistic           = optional(string, "Sum")
    period              = optional(number, 300)
    evaluation_periods  = optional(number, 1)
    threshold           = number
    comparison_operator = optional(string, "GreaterThanThreshold")
    treat_missing_data  = optional(string, "notBreaching")
    dimensions          = optional(map(string), {})
    description         = string
  }))
  default     = {}
  description = <<-EOT
    Alarms on metrics the gateway's alert sink publishes to CloudWatch, if it does. Empty by default because the
    metric names belong to that sink, not to this module.
  EOT
}

variable "tags" {
  type    = map(string)
  default = {}
}
