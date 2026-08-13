variable "environment" { type = string }
variable "cluster_name" { type = string }
variable "cluster_version" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "node_desired_size" { type = number }
variable "node_min_size" { type = number }
variable "node_max_size" { type = number }
variable "node_instance_types" { type = list(string) }
variable "enable_irsa" {
  type    = bool
  default = true
}
variable "public_access_cidrs" {
  type        = list(string)
  default     = ["0.0.0.0/0"]
  description = <<-EOT
    CIDRs allowed to reach the public Kubernetes API endpoint. Defaults to
    unrestricted so a first apply from any laptop succeeds — restrict this to
    your office/VPN/CI egress ranges before production. `endpoint_private_access`
    is always on, so anything inside the VPC (including CI running in-cluster)
    reaches the API regardless of this setting.
  EOT
}
variable "tags" {
  type    = map(string)
  default = {}
}
