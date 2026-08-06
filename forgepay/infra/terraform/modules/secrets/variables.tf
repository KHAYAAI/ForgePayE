variable "environment" { type = string }

variable "eks_oidc_provider_arn" {
  type        = string
  description = "OIDC provider ARN from the EKS module — grants pods IRSA access."
}

variable "service_account_namespace" {
  type    = string
  default = "forgepay"
}

variable "service_account_name" {
  type        = string
  default     = "forgepay-secrets-reader"
  description = "Service account the External Secrets Operator / CSI driver runs as."
}

variable "tags" {
  type    = map(string)
  default = {}
}
