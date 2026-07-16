variable "environment" { type = string }
variable "engine_version" { type = string }
variable "node_type" { type = string }
variable "num_cache_nodes" { type = number }
variable "parameter_group_name" { type = string }
variable "vpc_security_group_ids" { type = list(string) }
variable "subnet_group_name" { type = string }
variable "automatic_failover" { type = bool }
variable "enable_encryption_at_rest" {
  type    = bool
  default = true
}
variable "tags" {
  type    = map(string)
  default = {}
}
