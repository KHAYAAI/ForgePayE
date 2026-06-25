# =============================================================================
# Terraform Variables — us-east-1 (N. Virginia) Staging
# =============================================================================
# Usage:
#   terraform -chdir=forgepay/infra/terraform \
#     init -backend-config="region=us-east-1" \
#          -backend-config="bucket=forgepay-terraform-state-us-east-1" \
#          -backend-config="key=forgepay/staging/us-east-1/terraform.tfstate" \
#          -backend-config="dynamodb_table=forgepay-terraform-locks-us-east-1"
#   terraform apply -var-file="../../staging/terraform/us-east-1.tfvars"

# ── Region & Environment ─────────────────────────────────────────────────────
aws_region  = "us-east-1"
environment = "staging"

# ── Networking ───────────────────────────────────────────────────────────────
vpc_cidr = "10.20.0.0/16"   # Different CIDR from af-south-1 to allow future VPC peering

# us-east-1 has 6 AZs; use 3 for staging
availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]

# Cost saving: single NAT gateway instead of one per AZ
enable_nat_gateway = true
single_nat_gateway = true

# ── EKS Cluster ──────────────────────────────────────────────────────────────
kubernetes_version = "1.29"

eks_node_instance_types = ["t3.xlarge"]

eks_node_desired_size = 3
eks_node_min_size     = 2
eks_node_max_size     = 5

# ── RDS PostgreSQL ───────────────────────────────────────────────────────────
db_instance_class        = "db.t3.large"
db_allocated_storage     = 50
db_backup_retention_days = 7
db_multi_az              = false   # staging — single AZ to save cost

# db_username / db_password injected via TF_VAR_ env vars at apply time.

# ── Redis (ElastiCache) ───────────────────────────────────────────────────────
redis_engine_version       = "7.0"
redis_node_type            = "cache.t3.medium"
redis_num_nodes            = 1
redis_parameter_group_name = "default.redis7"
redis_automatic_failover   = false

# ── Vault ────────────────────────────────────────────────────────────────────
vault_namespace = "forgepay-staging"
vault_addr      = "https://vault.staging.forgepay.io"

# ── S3 / State ───────────────────────────────────────────────────────────────
tf_state_bucket = "forgepay-terraform-state-us-east-1"
tf_locks_table  = "forgepay-terraform-locks-us-east-1"

# ── CloudFront / ACM ─────────────────────────────────────────────────────────
# CloudFront requires ACM certs to be in us-east-1 regardless of stack region.
acm_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERT_ID"

cloudfront_allowed_origins = [
  "staging.us.forgepay.io",
  "api.staging.us.forgepay.io",
  "checkout.staging.us.forgepay.io",
  "dashboard.staging.us.forgepay.io",
]

# ── Monitoring ────────────────────────────────────────────────────────────────
log_retention_days = 14
alert_email        = "devops@forgepay.io"
