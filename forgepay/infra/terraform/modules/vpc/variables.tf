variable "environment" {
  type        = string
  description = "Environment name"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC"
}

variable "availability_zones" {
  type        = list(string)
  description = "AZs to spread subnets across"
}

variable "tags" {
  type        = map(string)
  description = "Extra tags"
  default     = {}
}
