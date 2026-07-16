variable "environment" { type = string }
variable "db_name" { type = string }
variable "db_username" {
  type      = string
  sensitive = true
}
variable "db_password" {
  type      = string
  sensitive = true
}
variable "db_instance_class" { type = string }
variable "db_allocated_storage" { type = number }
variable "db_backup_retention_days" { type = number }
variable "db_multi_az" { type = bool }
variable "vpc_security_group_ids" { type = list(string) }
variable "db_subnet_group_name" { type = string }
variable "enable_encryption" {
  type    = bool
  default = true
}
variable "enable_enhanced_monitoring" {
  type    = bool
  default = true
}
variable "engine_version" {
  type    = string
  default = "16.4"
}
variable "tags" {
  type    = map(string)
  default = {}
}
