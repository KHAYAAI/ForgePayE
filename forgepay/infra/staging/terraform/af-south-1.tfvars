# =============================================================================
# Terraform Variables — af-south-1 (Cape Town) Staging
# =============================================================================
# Usage:
#   terraform -chdir=forgepay/infra/terraform \
#     init -backend-config="region=af-south-1" \
#          -backend-config="bucket=forgepay-terraform-state-af-south-1" \
#          -backend-config="key=forgepay/staging/af-south-1/terraform.tfstate" \
#          -backend-config="dynamodb_table=forgepay-terraform-locks-af-south-1"
#   terraform apply -var-file="../../staging/terraform/af-south-1.tfvars"

# ── Region & Environment ─────────────────────────────────────────────────────
aws_region  = "af-south-1"
environment = "staging"

# ── Networking ───────────────────────────────────────────────────────────────
vpc_cidr = "10.10.0.0/16"

# af-south-1 has three AZs
availability_zones = ["af-south-1a", "af-south-1b", "af-south-1c"]

# Cost saving: single NAT gateway instead of one per AZ
# Set to false + remove single_nat_gateway for production HA
enable_nat_gateway = true
single_nat_gateway = true

# ── EKS Cluster ──────────────────────────────────────────────────────────────
kubernetes_version = "1.29"

# Staging uses t3.xlarge (4 vCPU / 16 GB) — sufficient for all 21 services at 1 replica each
eks_node_instance_types = ["t3.xlarge"]

eks_node_desired_size = 3
eks_node_min_size     = 2
eks_node_max_size     = 5

# ── RDS PostgreSQL ───────────────────────────────────────────────────────────
# db.t3.large: 2 vCPU / 8 GB — adequate for staging load
db_instance_class        = "db.t3.large"
db_allocated_storage     = 50   # GB — staging; production uses 500
db_backup_retention_days = 7    # staging: 7 days (production: 30)
db_multi_az              = false # staging — single AZ to save cost

# db_username and db_password are NOT set here — they come from AWS Secrets Manager.
# The deploy-staging.sh script injects them at apply time via TF_VAR_db_username /
# TF_VAR_db_password environment variables, sourced from AWS Secrets Manager.

# ── Redis (ElastiCache) ───────────────────────────────────────────────────────
redis_engine_version       = "7.0"
redis_node_type            = "cache.t3.medium"
redis_num_nodes            = 1          # staging: single node, no failover
redis_parameter_group_name = "default.redis7"
redis_automatic_failover   = false      # requires >= 2 nodes; disabled for staging

# ── Vault ────────────────────────────────────────────────────────────────────
vault_namespace = "forgepay-staging"
vault_addr      = "https://vault.staging.forgepay.io"

# ── S3 / State ───────────────────────────────────────────────────────────────
tf_state_bucket = "forgepay-terraform-state-af-south-1"
tf_locks_table  = "forgepay-terraform-locks-af-south-1"

# ── CloudFront / ACM ─────────────────────────────────────────────────────────
# Set acm_certificate_arn after running aws-prerequisites.sh (which requests the cert).
# For staging, the certificate covers *.staging.af.forgepay.io
acm_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERT_ID"  # CloudFront requires us-east-1 cert

cloudfront_allowed_origins = [
  "staging.af.forgepay.io",
  "api.staging.af.forgepay.io",
  "checkout.staging.af.forgepay.io",
  "dashboard.staging.af.forgepay.io",
]

# ── Monitoring ────────────────────────────────────────────────────────────────
log_retention_days = 14     # staging: 14 days (production: 90)
alert_email        = "devops@forgepay.io"
