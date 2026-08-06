variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones for multi-AZ deployment"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

# EKS Configuration
variable "kubernetes_version" {
  description = "Kubernetes version for EKS"
  type        = string
  default     = "1.29"
}

variable "eks_node_desired_size" {
  description = "Desired number of EKS worker nodes"
  type        = number
  default     = 3
}

variable "eks_node_min_size" {
  description = "Minimum number of EKS worker nodes"
  type        = number
  default     = 2
}

variable "eks_node_max_size" {
  description = "Maximum number of EKS worker nodes"
  type        = number
  default     = 10
}

variable "eks_node_instance_types" {
  description = "EC2 instance types for EKS worker nodes"
  type        = list(string)
  default     = ["t3.xlarge", "t3.2xlarge"]
}

# RDS Configuration
variable "db_username" {
  description = "RDS master username"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "RDS master password (use AWS Secrets Manager in production)"
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance type"
  type        = string
  default     = "db.r6i.2xlarge"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
  default     = 500
}

variable "db_backup_retention_days" {
  description = "Backup retention period"
  type        = number
  default     = 30
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment"
  type        = bool
  default     = true
}

# Redis Configuration
variable "redis_engine_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.0"
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.r6g.xlarge"
}

variable "redis_num_nodes" {
  description = "Number of Redis nodes"
  type        = number
  default     = 3
}

variable "redis_parameter_group_name" {
  description = "Redis parameter group name"
  type        = string
  default     = "default.redis7"
}

variable "redis_automatic_failover" {
  description = "Enable Redis automatic failover"
  type        = bool
  default     = true
}

# Vault Configuration
variable "vault_namespace" {
  description = "Vault namespace for ForgePay"
  type        = string
  default     = "forgepay"
}

variable "vault_addr" {
  description = "Vault server address"
  type        = string
  default     = "https://vault.example.com"
}

# CloudFront Configuration
variable "acm_certificate_arn" {
  description = "ACM certificate ARN for CloudFront"
  type        = string
}

variable "cloudfront_allowed_origins" {
  description = "Allowed origins for CloudFront"
  type        = list(string)
  default     = ["api.forgepay.io", "checkout.forgepay.io"]
}

# Monitoring Configuration
variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "alert_email" {
  description = "Email for CloudWatch alerts"
  type        = string
}

variable "tf_state_bucket" {
  description = "S3 bucket name for Terraform remote state"
  type        = string
  default     = "forgepay-terraform-state"
}

variable "tf_locks_table" {
  description = "DynamoDB table name for Terraform state locking"
  type        = string
  default     = "forgepay-terraform-locks"
}

# ── WAF ───────────────────────────────────────────────────────────────────────

variable "waf_rate_limit_per_5min" {
  type        = number
  default     = 2000
  description = "Requests per source IP per 5-minute window before WAF blocks."
}

variable "waf_blocked_country_codes" {
  type        = list(string)
  default     = []
  description = "ISO 3166-1 alpha-2 codes to block at the edge. Empty by default — a sanctions/compliance decision, not a default."
}
