variable "environment" { type = string }
variable "alb_domain_name" { type = string }
variable "certificate_arn" { type = string }
variable "allowed_origins" {
  type    = list(string)
  default = []
}
variable "tags" {
  type    = map(string)
  default = {}
}
