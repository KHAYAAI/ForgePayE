variable "environment" { type = string }
variable "db_name" { type = string }
variable "db_username" {
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
  type = string
  # Major version only: AWS picks its current default 16.x minor, and minor upgrades are applied in the maintenance window.
  # A pinned minor (this used to say "16.4") stops working when AWS deprecates it: a new database cannot be created on it.
  default = "16"
}
variable "tags" {
  type    = map(string)
  default = {}
}
