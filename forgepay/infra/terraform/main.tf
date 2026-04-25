# Terraform Root Module for ForgePay Platform
# Provisions entire AWS infrastructure: EKS, RDS, Redis, VPC, CloudFront, secrets

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
  }

  backend "s3" {
    bucket         = "forgepay-terraform-state"
    key            = "forgepay/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "forgepay-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ForgePay"
      Environment = var.environment
      ManagedBy   = "Terraform"
      CreatedAt   = timestamp()
    }
  }
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)
  token                  = module.eks.cluster_token
}

# VPC Module
module "vpc" {
  source = "./modules/vpc"

  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
  tags = {
    Module = "VPC"
  }
}

# EKS Cluster Module
module "eks" {
  source = "./modules/eks"

  environment              = var.environment
  cluster_name             = "forgepay-${var.environment}"
  cluster_version          = var.kubernetes_version
  vpc_id                   = module.vpc.vpc_id
  subnet_ids               = module.vpc.private_subnet_ids
  node_desired_size        = var.eks_node_desired_size
  node_min_size            = var.eks_node_min_size
  node_max_size            = var.eks_node_max_size
  node_instance_types      = var.eks_node_instance_types
  enable_irsa              = true

  tags = {
    Module = "EKS"
  }
}

# RDS PostgreSQL Module
module "rds" {
  source = "./modules/rds"

  environment                 = var.environment
  db_name                     = "forgepay"
  db_username                 = var.db_username
  db_password                 = var.db_password  # Use AWS Secrets Manager in production
  db_instance_class           = var.db_instance_class
  db_allocated_storage        = var.db_allocated_storage
  db_backup_retention_days    = var.db_backup_retention_days
  db_multi_az                 = var.db_multi_az
  vpc_security_group_ids      = [module.vpc.rds_security_group_id]
  db_subnet_group_name        = module.vpc.db_subnet_group_name
  enable_encryption           = true
  enable_enhanced_monitoring  = true

  tags = {
    Module = "RDS"
  }
}

# Redis ElastiCache Module
module "redis" {
  source = "./modules/redis"

  environment              = var.environment
  engine_version           = var.redis_engine_version
  node_type                = var.redis_node_type
  num_cache_nodes          = var.redis_num_nodes
  parameter_group_name     = var.redis_parameter_group_name
  vpc_security_group_ids   = [module.vpc.redis_security_group_id]
  subnet_group_name        = module.vpc.elasticache_subnet_group_name
  automatic_failover       = var.redis_automatic_failover
  enable_encryption_at_rest = true

  tags = {
    Module = "Redis"
  }
}

# Vault Integration Module
module "vault" {
  source = "./modules/vault"

  environment              = var.environment
  eks_cluster_name         = module.eks.cluster_name
  eks_oidc_provider_arn    = module.eks.oidc_provider_arn
  vault_namespace          = var.vault_namespace
  vault_addr               = var.vault_addr

  tags = {
    Module = "Vault"
  }
}

# S3 for backups, artifacts, logging
module "s3" {
  source = "./modules/s3"

  environment          = var.environment
  backup_bucket_name   = "forgepay-backups-${data.aws_caller_identity.current.account_id}"
  logs_bucket_name     = "forgepay-logs-${data.aws_caller_identity.current.account_id}"
  artifacts_bucket_name = "forgepay-artifacts-${data.aws_caller_identity.current.account_id}"
  enable_versioning    = true
  enable_mfa_delete    = var.environment == "production"

  tags = {
    Module = "S3"
  }
}

# CloudFront CDN Module
module "cloudfront" {
  source = "./modules/cloudfront"

  environment        = var.environment
  alb_domain_name    = module.vpc.alb_domain_name
  certificate_arn    = var.acm_certificate_arn
  allowed_origins    = var.cloudfront_allowed_origins

  tags = {
    Module = "CloudFront"
  }
}

# Monitoring & Logging Module
module "monitoring" {
  source = "./modules/monitoring"

  environment           = var.environment
  eks_cluster_name      = module.eks.cluster_name
  rds_instance_id       = module.rds.db_instance_id
  redis_cluster_id      = module.redis.cluster_id
  log_retention_days    = var.log_retention_days
  alert_email           = var.alert_email

  tags = {
    Module = "Monitoring"
  }
}

# Data source for AWS account
data "aws_caller_identity" "current" {}

# Outputs
output "eks_cluster_endpoint" {
  value       = module.eks.cluster_endpoint
  description = "EKS cluster endpoint"
}

output "eks_cluster_name" {
  value       = module.eks.cluster_name
  description = "EKS cluster name"
}

output "rds_endpoint" {
  value       = module.rds.db_endpoint
  description = "RDS PostgreSQL endpoint"
}

output "redis_endpoint" {
  value       = module.redis.cluster_endpoint
  description = "Redis endpoint"
}

output "s3_backup_bucket" {
  value       = module.s3.backup_bucket_name
  description = "S3 backup bucket name"
}

output "cloudfront_domain_name" {
  value       = module.cloudfront.domain_name
  description = "CloudFront distribution domain"
}
