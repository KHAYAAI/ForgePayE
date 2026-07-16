# ForgePay Terraform Modules

Local modules consumed by `infra/terraform/main.tf`. Each matches the exact
input/output contract the root expects and uses native AWS resources (no
external module registry dependency).

| Module | Provisions | Key outputs |
|---|---|---|
| `vpc` | VPC, public/private subnets across the AZs, IGW + per-AZ NAT gateways, route tables, RDS/Redis security groups, DB + ElastiCache subnet groups | `vpc_id`, `private_subnet_ids`, `rds_security_group_id`, `redis_security_group_id`, `db_subnet_group_name`, `elasticache_subnet_group_name`, `alb_domain_name` |
| `eks` | EKS control plane, managed node group, cluster + node IAM roles, OIDC/IRSA provider | `cluster_endpoint`, `cluster_ca_certificate`, `cluster_token` (sensitive), `cluster_name`, `oidc_provider_arn` |
| `rds` | Encrypted PostgreSQL (optionally Multi-AZ), enhanced monitoring role, Performance Insights | `db_endpoint`, `db_instance_id`, `db_address` |
| `redis` | ElastiCache replication group, encryption at rest + in transit, automatic failover | `cluster_endpoint`, `cluster_id` |
| `vault` | KMS auto-unseal key + IRSA role for the in-cluster Vault service account | `unseal_key_arn`, `vault_role_arn` |
| `s3` | Backups / logs / artifacts buckets with versioning, SSE, public-access block | `backup_bucket_name`, `logs_bucket_name`, `artifacts_bucket_name` |
| `cloudfront` | CloudFront distribution fronting the ALB origin, ACM viewer cert | `domain_name`, `distribution_id` |
| `monitoring` | CloudWatch log group, SNS alert topic (+ email sub), RDS/Redis CPU alarms | `alerts_topic_arn`, `log_group_name` |

## Apply

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in required vars
terraform init                                  # needs registry.terraform.io reachable
terraform plan
terraform apply
```

`alb_domain_name` is a placeholder: the ALB is created in-cluster by the AWS
Load Balancer Controller after the EKS cluster is up, so its DNS name is not
known at plan time. Set `module.cloudfront.alb_domain_name` to the real
ingress hostname on a second apply, or wire it from a data source once the
controller has reconciled.

> Note: these modules were authored and `terraform fmt`-verified in an
> environment that blocks the provider registry, so `terraform validate`
> (which requires provider download) must be run in your own environment
> before first apply.
