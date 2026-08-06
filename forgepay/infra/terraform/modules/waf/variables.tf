variable "environment" { type = string }

variable "scope" {
  type        = string
  default     = "REGIONAL"
  description = "REGIONAL for ALB/API Gateway, CLOUDFRONT for a distribution (must be created in us-east-1)."
  validation {
    condition     = contains(["REGIONAL", "CLOUDFRONT"], var.scope)
    error_message = "scope must be REGIONAL or CLOUDFRONT."
  }
}

variable "alb_arn" {
  type        = string
  default     = null
  description = "ALB to associate when scope is REGIONAL. Ignored for CLOUDFRONT."
}

variable "rate_limit_per_5min" {
  type        = number
  default     = 2000
  description = "Requests per source IP per 5-minute window before blocking."
  validation {
    condition     = var.rate_limit_per_5min >= 100
    error_message = "AWS WAF requires a rate limit of at least 100."
  }
}

variable "login_path" {
  type        = string
  default     = "/api/auth/login"
  description = "Login route inspected by the account-takeover-prevention rule group."
}

variable "count_only_common_rules" {
  type        = list(string)
  default     = ["SizeRestrictions_BODY"]
  description = "Common-rule-set rules downgraded to count. Card and webhook payloads legitimately exceed the default body inspection size."
}

variable "blocked_country_codes" {
  type        = list(string)
  default     = []
  description = "ISO 3166-1 alpha-2 codes to block. Empty by default — geo blocking is a compliance decision."
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "tags" {
  type    = map(string)
  default = {}
}
