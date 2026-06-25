# =============================================================================
# Terraform Variables — eu-west-2 (London) Staging
# =============================================================================
# Usage:
#   terraform -chdir=forgepay/infra/terraform \
#     init -backend-config="region=eu-west-2" \
#          -backend-config="bucket=forgepay-terraform-state-eu-west-2" \
#          -backend-config="key=forgepay/staging/eu-west-2/terraform.tfstate" \
#          -backend-config="dynamodb_table=forgepay-terraform-locks-eu-west-2"
#   terraform apply -var-file="../../staging/terraform/eu-west-2.tfvars"
#
# GDPR NOTE: eu-west-2 hosts EU/UK merchant data. Ensure S3 buckets have object lock
# and that log retention meets GDPR requirements (update log_retention_days as needed).

# ── Region & Environment ─────────────────────────────────────────────────────
aws_region  = "eu-west-2"
environment = "staging"

# ── Networking ───────────────────────────────────────────────────────────────
vpc_cidr = "10.30.0.0/16"   # Different CIDR from other staging regions

# eu-west-2 has 3 AZs
availability_zones = ["eu-west-2a", "eu-west-2b", "eu-west-2c"]

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
db_multi_az              = false

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
tf_state_bucket = "forgepay-terraform-state-eu-west-2"
tf_locks_table  = "forgepay-terraform-locks-eu-west-2"

# ── CloudFront / ACM ─────────────────────────────────────────────────────────
# CloudFront requires ACM certs to be in us-east-1 regardless of stack region.
acm_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERT_ID"

cloudfront_allowed_origins = [
  "staging.eu.forgepay.io",
  "api.staging.eu.forgepay.io",
  "checkout.staging.eu.forgepay.io",
  "dashboard.staging.eu.forgepay.io",
]

# ── Monitoring ────────────────────────────────────────────────────────────────
# GDPR: consider 30 days minimum for EU compliance audit trails
log_retention_days = 30
alert_email        = "devops@forgepay.io"
