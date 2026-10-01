variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "platform_region" {
  type    = string
  default = "us-east-1"
}

variable "gateway_role_arn" {
  type        = string
  description = "IRSA role ARN of the stablecoin-gateway service account (created with the EKS module / secrets module)."
}

variable "gateway_role_name" {
  type        = string
  description = "Name of that role, so the alert-publish policy can be attached."
}

variable "gateway_log_group_name" {
  type        = string
  default     = null
  description = "Log group receiving the gateway's stdout, to enable the log-pattern alarms."
}

variable "platform_key_admin_arns" {
  type    = list(string)
  default = []
}

variable "alert_subscriptions" {
  type = map(object({
    protocol = string
    endpoint = string
  }))
  default = {}
}

variable "backup_region" {
  type    = string
  default = "us-east-1"
}
variable "backup_profile" {
  type        = string
  default     = null
  description = "AWS profile for the dedicated backup account."
}

# Node 1
variable "node1_region" { type = string }
variable "node1_profile" {
  type        = string
  default     = null
  description = "AWS profile for node1's account (operated by node1's own administrators)."
}
variable "node1_role_arn" {
  type        = string
  description = "IRSA role of node1's pod (service account annotated by the mpc-node chart)."
}
variable "node1_pruner_role_arn" { type = string }
variable "node1_key_admin_arns" {
  type    = list(string)
  default = []
}
variable "node1_backup_bucket" { type = string }

# Node 2
variable "node2_region" { type = string }
variable "node2_profile" {
  type    = string
  default = null
}
variable "node2_role_arn" { type = string }
variable "node2_pruner_role_arn" { type = string }
variable "node2_key_admin_arns" {
  type    = list(string)
  default = []
}
variable "node2_backup_bucket" { type = string }
