variable "environment" { type = string }
variable "backup_bucket_name" { type = string }
variable "logs_bucket_name" { type = string }
variable "artifacts_bucket_name" { type = string }
variable "enable_versioning" {
  type    = bool
  default = true
}
variable "enable_mfa_delete" {
  type    = bool
  default = false
}
variable "tags" {
  type    = map(string)
  default = {}
}
