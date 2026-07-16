output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}

output "redis_security_group_id" {
  value = aws_security_group.redis.id
}

output "db_subnet_group_name" {
  value = aws_db_subnet_group.this.name
}

output "elasticache_subnet_group_name" {
  value = aws_elasticache_subnet_group.this.name
}

# ALB is provisioned in-cluster by the AWS Load Balancer Controller; its DNS
# name is not known at plan time. Exposed as a placeholder the root passes to
# CloudFront — override cloudfront.alb_domain_name post-provision, or wire the
# ingress hostname in once the controller has reconciled.
output "alb_domain_name" {
  value = "alb.${var.environment}.forgepay.internal"
}
