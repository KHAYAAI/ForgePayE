variable "environment" { type = string }
variable "eks_cluster_name" { type = string }
variable "eks_oidc_provider_arn" { type = string }
variable "vault_namespace" {
  type    = string
  default = "forgepay"
}
variable "vault_addr" {
  type    = string
  default = ""
}
variable "tags" {
  type    = map(string)
  default = {}
}
