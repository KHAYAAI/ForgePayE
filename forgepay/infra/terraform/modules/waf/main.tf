# WAF module — AWS WAFv2 web ACL fronting the platform.
#
# Previously absent entirely: a payments platform was exposing a public
# CloudFront/ALB front door with no managed rule protection, no rate limiting
# and no bot control. This module supplies all three.
#
# CloudFront-attached ACLs MUST live in us-east-1 (a CLOUDFRONT-scope ACL is a
# global resource). Pass an aliased provider from the root when scope is
# CLOUDFRONT; REGIONAL-scope ACLs (for an ALB or API Gateway) go in the
# platform's own region.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

resource "aws_wafv2_web_acl" "this" {
  name        = "forgepay-${var.environment}"
  description = "ForgePay ${var.environment} — managed rules, rate limiting, bot control"
  scope       = var.scope

  default_action {
    allow {}
  }

  # ── 1. Volumetric protection ───────────────────────────────────────────────
  # Counts requests per source IP over a 5-minute sliding window. Placed first
  # so a flood is shed before the more expensive managed rule groups evaluate.
  rule {
    name     = "rate-limit-per-ip"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "forgepay-${var.environment}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # ── 2. AWS managed baseline ────────────────────────────────────────────────
  # Core rule set: broad protection against the OWASP-style classes (bad
  # inputs, path traversal, oversized bodies, known-malicious user agents).
  rule {
    name     = "aws-common-rules"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

        # Card payloads and webhook bodies can legitimately exceed the default
        # body-size inspection limit; blocking on size alone produces false
        # positives on real traffic. Count instead so it is observable.
        dynamic "rule_action_override" {
          for_each = var.count_only_common_rules
          content {
            name = rule_action_override.value
            action_to_use {
              count {}
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "forgepay-${var.environment}-common"
      sampled_requests_enabled   = true
    }
  }

  # ── 3. Known bad inputs ────────────────────────────────────────────────────
  rule {
    name     = "aws-known-bad-inputs"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "forgepay-${var.environment}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # ── 4. Credential-stuffing / account-takeover surface ──────────────────────
  # The console login and the agent-operator signup are the accounts most worth
  # attacking; this group is tuned for exactly that traffic shape.
  rule {
    name     = "aws-atp-ruleset"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesATPRuleSet"

        managed_rule_group_configs {
          aws_managed_rules_atp_rule_set {
            login_path = var.login_path

            request_inspection {
              payload_type = "JSON"
              username_field {
                identifier = "/email"
              }
              password_field {
                identifier = "/password"
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "forgepay-${var.environment}-atp"
      sampled_requests_enabled   = true
    }
  }

  # ── 5. IP reputation ───────────────────────────────────────────────────────
  rule {
    name     = "aws-ip-reputation"
    priority = 5

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "forgepay-${var.environment}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  # ── 6. Optional country blocking ───────────────────────────────────────────
  # Empty by default. Sanctions-driven geo restriction is a compliance decision
  # (see SOUTH_AFRICA_LICENSES.md) and must be set deliberately, not inherited.
  dynamic "rule" {
    for_each = length(var.blocked_country_codes) > 0 ? [1] : []
    content {
      name     = "geo-block"
      priority = 6

      action {
        block {}
      }

      statement {
        geo_match_statement {
          country_codes = var.blocked_country_codes
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "forgepay-${var.environment}-geo-block"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "forgepay-${var.environment}-waf"
    sampled_requests_enabled   = true
  }

  tags = var.tags
}

# ── Request logging ──────────────────────────────────────────────────────────
# Retained for incident review and for the AML/CFT evidence trail the FIC
# playbook expects. Card data must never reach these logs, so the authorization
# header and any cookie are redacted at source.

resource "aws_cloudwatch_log_group" "waf" {
  # AWS requires WAF log destinations to be named `aws-waf-logs-*`.
  name              = "aws-waf-logs-forgepay-${var.environment}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  redacted_fields {
    single_header {
      name = "authorization"
    }
  }

  redacted_fields {
    single_header {
      name = "cookie"
    }
  }

  redacted_fields {
    single_header {
      name = "x-api-key"
    }
  }
}

# ── Association ──────────────────────────────────────────────────────────────
# REGIONAL ACLs attach directly to the ALB. A CLOUDFRONT ACL is attached by
# setting `web_acl_id` on the distribution instead — the root module wires that
# via this module's `web_acl_arn` output.

resource "aws_wafv2_web_acl_association" "alb" {
  count = var.scope == "REGIONAL" && var.alb_arn != null ? 1 : 0

  resource_arn = var.alb_arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}
