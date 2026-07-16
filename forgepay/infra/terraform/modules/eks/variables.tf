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
variable "tags" {
  type    = map(string)
  default = {}
}
