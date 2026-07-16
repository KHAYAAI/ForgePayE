# Redis module — ElastiCache replication group with encryption + failover.

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "forgepay-${var.environment}"
  description          = "ForgePay ${var.environment} Redis"

  engine         = "redis"
  engine_version = var.engine_version
  node_type      = var.node_type
  port           = 6379

  num_cache_clusters         = var.num_cache_nodes
  automatic_failover_enabled = var.automatic_failover && var.num_cache_nodes > 1
  multi_az_enabled           = var.automatic_failover && var.num_cache_nodes > 1

  parameter_group_name = var.parameter_group_name
  subnet_group_name    = var.subnet_group_name
  security_group_ids   = var.vpc_security_group_ids

  at_rest_encryption_enabled = var.enable_encryption_at_rest
  transit_encryption_enabled = true

  snapshot_retention_limit = var.environment == "production" ? 7 : 1
  snapshot_window          = "05:00-06:00"
  maintenance_window       = "sun:06:30-sun:07:30"
  apply_immediately        = var.environment != "production"

  tags = merge(var.tags, { Name = "forgepay-${var.environment}-redis" })
}
