variable "environment" { type = string }
variable "eks_cluster_name" { type = string }
variable "rds_instance_id" { type = string }
variable "redis_cluster_id" { type = string }
variable "log_retention_days" {
  type    = number
  default = 30
}
variable "alert_email" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
