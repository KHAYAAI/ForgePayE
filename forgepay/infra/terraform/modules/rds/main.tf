# RDS module — encrypted, optionally Multi-AZ PostgreSQL for ForgePay.
#
# The master password is RDS-managed (`manage_master_user_password`), not a
# Terraform variable: RDS generates it and stores it in Secrets Manager
# directly, so the plaintext never passes through a `.tf` variable or lands
# in Terraform state — the same guarantee `modules/secrets` already makes for
# every other platform credential. Services read it from
# `aws_db_instance.this.master_user_secret[0].secret_arn` (exposed below),
# not from an env var baked at apply time.

data "aws_iam_policy_document" "monitoring_assume" {
  count = var.enable_enhanced_monitoring ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  count              = var.enable_enhanced_monitoring ? 1 : 0
  name               = "forgepay-${var.environment}-rds-monitoring"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  count      = var.enable_enhanced_monitoring ? 1 : 0
  role       = aws_iam_role.monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "this" {
  identifier     = "forgepay-${var.environment}"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.db_instance_class

  db_name  = var.db_name
  username = var.db_username

  manage_master_user_password = true

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 2
  storage_type          = "gp3"
  storage_encrypted     = var.enable_encryption

  multi_az                = var.db_multi_az
  db_subnet_group_name    = var.db_subnet_group_name
  vpc_security_group_ids  = var.vpc_security_group_ids
  backup_retention_period = var.db_backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:30-sun:05:30"

  monitoring_interval = var.enable_enhanced_monitoring ? 60 : 0
  monitoring_role_arn = var.enable_enhanced_monitoring ? aws_iam_role.monitoring[0].arn : null

  performance_insights_enabled = true
  deletion_protection          = var.environment == "production"
  skip_final_snapshot          = var.environment != "production"
  final_snapshot_identifier    = var.environment == "production" ? "forgepay-${var.environment}-final" : null
  apply_immediately            = var.environment != "production"

  tags = merge(var.tags, { Name = "forgepay-${var.environment}-postgres" })
}
