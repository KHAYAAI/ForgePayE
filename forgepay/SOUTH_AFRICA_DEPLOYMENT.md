# ForgePay South Africa Deployment Guide

## 1. AWS Architecture for South Africa

### Primary & Secondary Regions

**Primary Region:** `af-south-1` (Cape Town, South Africa)  
**Secondary Region:** `eu-west-1` (Ireland) for EU compliance + backup

### Infrastructure Architecture

```
af-south-1 (Cape Town) — Primary
├── EKS Cluster (3 availability zones: sa-east-1a, sa-east-1b, sa-east-1c)
├── RDS Aurora PostgreSQL (Multi-AZ across sa-east-1)
├── ElastiCache Redis (3 shards, 2 replicas each)
├── S3 for reports/backups
├── Route 53 + CloudFront CDN
└── VPC with public/private/isolated subnets

eu-west-1 (Ireland) — Backup/EU compliance
├── RDS Aurora Read Replica (for GDPR compliance)
├── S3 cross-region replication
└── CloudFront edge locations for low-latency EU access
```

### Why Cape Town (af-south-1)?

- **Latency:** 30-50ms to Johannesburg/Pretoria (financial hubs)
- **EU Access:** 60ms to London (EU partnerships)
- **Regulatory:** Supports South African data residency requirements (POPIA § 72)
- **Availability:** All AWS services required for ForgePay available in af-south-1

### AWS Services (South Africa-Specific)

| Service | Purpose | South Africa Consideration |
|---------|---------|---------------------------|
| **EKS** | Kubernetes orchestration | Available in af-south-1 |
| **RDS Aurora** | PostgreSQL (primary in SA) | Automatic backups in S3 (regional) |
| **ElastiCache** | Redis for dedup/sessions | 3 shards for ZA timezone traffic patterns |
| **S3** | Reports, tax statements, backups | Versioning + MFA delete for audit trail |
| **Route 53** | DNS + health checks | Points to af-south-1 EKS primary |
| **CloudFront** | CDN for dashboard | Caching in ZA, EMEA, US for global merchants |
| **Secrets Manager** | API keys, JWT secrets | KMS encryption (regional key) |
| **KMS** | Encryption keys | ZA-region key for sensitive data |
| **VPC Endpoints** | S3, ECR, Secrets Manager access | No internet exposure (security best practice) |
| **Security Hub** | Compliance monitoring | Tracks PCI, POPIA compliance |
| **GuardDuty** | Threat detection | Monitors for unusual API activity |
| **Config** | Infrastructure-as-code drift | Ensures Terraform matches reality |

---

## 2. Monthly AWS Cost Estimate (South Africa)

**Note:** af-south-1 pricing is 15-20% higher than us-east-1 due to limited region competition

| Service | Spec | Monthly (ZAR) | Monthly (USD) |
|---------|------|---------------|---------------|
| EKS cluster | 7 nodes (mixed: c6i.2xl, c6i.xl, t3.lg) | R 25,200 | $1,400 |
| Aurora PostgreSQL | 2-16 ACUs serverless | R 14,400 | $800 |
| ElastiCache Redis | 3 × r6g.large nodes | R 10,800 | $600 |
| ALB + WAF | ~10M requests/month | R 3,600 | $200 |
| S3 + replication to eu-west-1 | 100GB + cross-region | R 1,800 | $100 |
| Secrets Manager | 20 secrets | R 360 | $20 |
| CloudWatch + AMP + AMG | Full observability | R 7,200 | $400 |
| Data transfer | 500GB/month af-south-1 | R 2,700 | $150 |
| Data transfer to EU (backup) | 50GB/month | R 1,800 | $100 |
| NAT Gateway | Single NAT GW in af-south-1 | R 1,800 | $100 |
| **Total Monthly** | | **R 69,660** | **~$3,900** |
| **Annual** | | **R 835,920** | **~$46,800** |

### Cost Scaling

- At R 1M GMV/month: ~R 140k/month (~$7,800 USD)
- At R 10M GMV/month: ~R 350k/month (~$19,500 USD)
- At R 100M GMV/month: ~R 800k/month (~$45k USD)

**South African Tax Note:** These are pre-VAT costs. Add 15% VAT on AWS services billed to SA entity.

---

## 3. Network Architecture (ZA-centric)

```
Internet
  ↓
Route 53 (DNS failover to af-south-1)
  ↓
CloudFront (CDN — caches dashboard/assets)
  ↓
ALB (Application Load Balancer, af-south-1)
  ↓
EKS Ingress Controller
  ↓
ForgePay Services (af-south-1 private subnets)
  ├── router (Hyperswitch payment router)
  ├── unified-router (webhook normalizer)
  ├── mor-layer (tax, checkout, yield)
  ├── billing-engine (subscriptions)
  ├── stablecoin-gateway (USDC/USDT)
  ├── crypto-gateway (Bitcoin, Ethereum)
  └── compliance-monitor (AML/CFT)
  ↓
RDS Aurora + ElastiCache (isolated subnets)

South African Banks
  ↓
SWIFT Gateway (Plaid alternative: Nedbank OpenAPI, FNB API)
  ↓
bank-connectivity service
  ↓
accounts-service, unified-router
```

### South African Payment Rails on ForgePay

| Rail | Technology | Status | Integration |
|------|------------|--------|-------------|
| **EFT (Electronic Funds Transfer)** | SAPO (South African Payments Organization) protocols | ✅ Standard | Via Plaid ZA or direct bank APIs |
| **Local Bank Transfers** | Nedbank, FNB, Absa, Standard Bank APIs | ✅ Ready | Direct via bank OpenBanking portals |
| **SWIFT** | International bank transfers | ✅ Ready | bank-connectivity → SWIFT gateway |
| **Crypto** | Bitcoin, Ethereum (Polygon ZA nodes) | ✅ Ready | crypto-gateway, stablecoin-gateway |
| **Stablecoins** | USDC, USDT on Polygon | ✅ Ready | stablecoin-gateway |
| **RWA Yield** | South African bonds, property tokens | 🔄 Roadmap | rwa-registry (Q2 2026) |

---

## 4. EKS Cluster Configuration (Terraform)

### Minimum Viable Configuration for Launch

```hcl
# forgepay/infra/terraform/aws/south_africa/eks.tf

provider "aws" {
  region = "af-south-1"
  
  default_tags {
    tags = {
      Environment = "production"
      Region      = "south-africa"
      ManagedBy   = "terraform"
    }
  }
}

# EKS Cluster
resource "aws_eks_cluster" "forgepay_sa" {
  name            = "forgepay-sa-prod"
  role_arn        = aws_iam_role.eks_cluster_role.arn
  version         = "1.31"
  
  vpc_config {
    subnet_ids              = concat(
      aws_subnet.public[*].id,
      aws_subnet.private[*].id
    )
    endpoint_private_access = true
    endpoint_public_access  = false
    security_group_ids      = [aws_security_group.eks_cluster.id]
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
  
  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster_AmazonEKSClusterPolicy,
    aws_iam_role_policy_attachment.eks_cluster_AmazonEKSVPCResourceController,
  ]
  
  tags = {
    Name = "forgepay-sa-prod"
  }
}

# Node Groups (mixed instance types for cost efficiency)
resource "aws_eks_node_group" "compute" {
  cluster_name    = aws_eks_cluster.forgepay_sa.name
  node_group_name = "compute"
  node_role_arn   = aws_iam_role.eks_node_role.arn
  subnet_ids      = aws_subnet.private[*].id
  
  scaling_config {
    desired_size = 3
    max_size     = 10
    min_size     = 3
  }

  instance_types = ["c6i.2xl", "c6i.xlarge", "t3.large"]
  
  labels = {
    Environment = "production"
    Tier        = "compute"
  }
  
  depends_on = [
    aws_iam_role_policy_attachment.eks_node_AmazonEKSWorkerNodePolicy,
    aws_iam_role_policy_attachment.eks_node_AmazonEKS_CNI_Policy,
    aws_iam_role_policy_attachment.eks_node_AmazonEC2ContainerRegistryReadOnly,
  ]
}

# RDS Aurora PostgreSQL
resource "aws_rds_cluster" "forgepay_db" {
  cluster_identifier      = "forgepay-sa-prod"
  engine                  = "aurora-postgresql"
  engine_version          = "16.1"
  database_name           = "forgepay"
  master_username         = "forgepay_admin"
  master_password         = random_password.rds_password.result
  
  availability_zones      = ["af-south-1a", "af-south-1b", "af-south-1c"]
  db_subnet_group_name    = aws_db_subnet_group.forgepay.name
  vpc_security_group_ids  = [aws_security_group.rds.id]
  
  backup_retention_period = 30
  preferred_backup_window = "02:00-03:00"
  preferred_maintenance_window = "mon:03:00-mon:04:00"
  
  enabled_cloudwatch_logs_exports = ["postgresql"]
  
  storage_encrypted       = true
  kms_key_id              = aws_kms_key.rds.arn
  
  enable_http_endpoint    = false
  
  tags = {
    Name = "forgepay-sa-prod"
  }
}

# ElastiCache Redis (3 shards)
resource "aws_elasticache_replication_group" "forgepay_redis" {
  replication_group_description = "ForgePay Redis - South Africa"
  engine                        = "redis"
  engine_version                = "7.0"
  node_type                      = "cache.r6g.large"
  
  num_cache_clusters           = 3
  automatic_failover_enabled   = true
  multi_az_enabled             = true
  
  parameter_group_name         = aws_elasticache_parameter_group.forgepay.name
  subnet_group_name            = aws_elasticache_subnet_group.forgepay.name
  security_group_ids           = [aws_security_group.redis.id]
  
  at_rest_encryption_enabled   = true
  auth_token                   = random_password.redis_auth_token.result
  transit_encryption_enabled   = true
  
  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_logs.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
  }
  
  tags = {
    Name = "forgepay-sa-prod"
  }
}

# KMS Key for encryption (South Africa region)
resource "aws_kms_key" "forgepay_sa" {
  description             = "ForgePay South Africa encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  
  tags = {
    Name = "forgepay-sa-kms"
  }
}

# S3 for reports and backups
resource "aws_s3_bucket" "forgepay_reports" {
  bucket = "forgepay-sa-reports-${data.aws_caller_identity.current.account_id}"
  
  tags = {
    Name = "forgepay-sa-reports"
  }
}

resource "aws_s3_bucket_versioning" "forgepay_reports" {
  bucket = aws_s3_bucket.forgepay_reports.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "forgepay_reports" {
  bucket = aws_s3_bucket.forgepay_reports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.forgepay_sa.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "forgepay_reports" {
  bucket = aws_s3_bucket.forgepay_reports.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Cross-region replication to EU (for GDPR)
resource "aws_s3_bucket" "forgepay_reports_eu" {
  provider = aws.eu-west-1
  bucket   = "forgepay-eu-reports-${data.aws_caller_identity.current.account_id}"
  
  tags = {
    Name = "forgepay-eu-reports"
  }
}

resource "aws_s3_bucket_replication_configuration" "forgepay_reports" {
  depends_on = [aws_s3_bucket_versioning.forgepay_reports]
  
  bucket = aws_s3_bucket.forgepay_reports.id
  role   = aws_iam_role.s3_replication.arn

  rule {
    id     = "replicate-to-eu"
    status = "Enabled"

    destination {
      bucket       = aws_s3_bucket.forgepay_reports_eu.arn
      storage_class = "STANDARD_IA"
      
      replication_time {
        status = "Enabled"
        time {
          minutes = 60
        }
      }
    }
  }
}

output "eks_cluster_endpoint" {
  value       = aws_eks_cluster.forgepay_sa.endpoint
  description = "EKS Cluster endpoint"
}

output "rds_endpoint" {
  value       = aws_rds_cluster.forgepay_db.endpoint
  description = "RDS Aurora cluster endpoint"
}

output "redis_endpoint" {
  value       = aws_elasticache_replication_group.forgepay_redis.primary_endpoint_address
  description = "ElastiCache Redis primary endpoint"
}
```

---

## 5. Kubernetes Manifests for South Africa

### Deployment Configuration

```yaml
# forgepay/infra/k8s/south-africa/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: forgepay
  labels:
    name: forgepay
    region: south-africa
```

```yaml
# forgepay/infra/k8s/south-africa/router-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: router
  namespace: forgepay
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: router
      region: south-africa
  template:
    metadata:
      labels:
        app: router
        region: south-africa
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - router
              topologyKey: kubernetes.io/hostname
      containers:
      - name: router
        image: forgepay/router:latest
        imagePullPolicy: Always
        ports:
        - name: http
          containerPort: 8080
        - name: grpc
          containerPort: 50051
        env:
        - name: ENVIRONMENT
          value: "production"
        - name: AWS_REGION
          value: "af-south-1"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: rds-credentials
              key: url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-credentials
              key: url
        - name: LOG_LEVEL
          value: "info"
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 2000m
            memory: 4Gi
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
```

---

## 6. Development & Deployment Checklist

### Pre-Launch (Month 1-2)

- [ ] AWS account created with af-south-1 enabled
- [ ] Terraform infrastructure validated in staging
- [ ] EKS cluster deployed and nodes healthy
- [ ] RDS Aurora cluster accessible
- [ ] ElastiCache Redis replication group online
- [ ] KMS keys created and rotated
- [ ] S3 buckets with versioning + encryption + cross-region replication
- [ ] VPC endpoints for S3, ECR, Secrets Manager
- [ ] Security groups configured (least privilege)
- [ ] CloudWatch log groups created
- [ ] Prometheus + Grafana deployed to EKS
- [ ] AlertManager configured for on-call rotations

### Launch (Month 3-4)

- [ ] Docker images pushed to ECR (af-south-1)
- [ ] Kubernetes manifests deployed
- [ ] Service mesh (Istio) configured for traffic management
- [ ] TLS/mTLS certificates deployed
- [ ] Route 53 health checks active
- [ ] CloudFront distribution online
- [ ] WAF rules active on ALB
- [ ] Backup tested (restore to test RDS)
- [ ] Disaster recovery plan documented
- [ ] On-call runbooks prepared

---

## 7. Performance & Optimization Tips for South Africa

### EKS Optimization

- **Use Spot Instances:** Use 30-50% Spot instances (c6i.large) to reduce costs 70%
- **Pod Disruption Budgets:** Set PDB for critical services (router, compliance-monitor)
- **Node Auto-Scaling:** Use Karpenter or Cluster Autoscaler for dynamic scaling
- **Network Policies:** Restrict traffic between namespaces (security + performance)

### RDS Aurora Optimization

- **Serverless:** Use Aurora Serverless v2 for variable workloads (auto-scale 0.5-16 ACUs)
- **Parameter Groups:** Optimize for throughput (shared_preload_libraries = 'pg_stat_statements')
- **Monitoring:** Enable Performance Insights for slow query analysis
- **Connection Pooling:** Use PgBouncer in EKS (connection pooling → 3x throughput)

### Redis Optimization

- **Cluster Mode:** Enabled for partition tolerance (3 shards = 3 partitions)
- **Eviction Policy:** Set to `allkeys-lru` (evict least recently used when full)
- **Replication:** 2 replicas per shard (7 total nodes) for HA
- **AOF Persistence:** Enabled for durability

### CloudFront & CDN

- **Cache TTLs:** Set based on content type
  - Static assets (CSS, JS): 1 year
  - Dashboard (HTML): 5 minutes
  - API responses: No caching (Cache-Control: no-cache)
- **Compression:** Enable gzip + Brotli for 60% bandwidth savings
- **Geographic Routing:** Route ZA users → af-south-1, EU users → eu-west-1

---

## 8. South Africa-Specific Compliance Integrations

### POPIA Data Residency

Add to all data access policies:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "POPIADataResidency",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": "arn:aws:s3:::forgepay-sa-*/*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": "af-south-1"
        }
      }
    }
  ]
}
```

### FSCA AML/CFT Integration

The `compliance-monitor` service on EKS should:

1. **Monitor all transactions >R 50k** (daily batch job)
2. **Flag suspicious patterns:** rapid transfers, structuring, unusual recipients
3. **Generate SARs for FIC:** Automated report generation
4. **Webhook notifications:** Alert ops team for immediate review
5. **Data retention:** Keep 5-year audit trail in S3 (Glacier after 1 year)

---

## 9. Disaster Recovery Plan (South Africa)

### RTO/RPO Targets

- **RTO (Recovery Time Objective):** 4 hours
- **RPO (Recovery Point Objective):** 1 hour

### Backup Strategy

1. **Hourly snapshots** of RDS Aurora (automated)
2. **Daily S3 backups** to eu-west-1 (cross-region replication)
3. **Weekly restore tests** (restore to test environment, validate data integrity)
4. **Monthly DR drill** (full failover to eu-west-1, back to af-south-1)

### Failover Procedure

```bash
# If af-south-1 is down:
1. Promote RDS Aurora read replica in eu-west-1 to primary
2. Update Route 53 to point to eu-west-1 EKS cluster
3. Update DNS: forgepay.africa → eu-west-1 load balancer IP
4. Sync merchant/transaction data from S3 to eu-west-1 RDS
5. Run smoke tests (payment processing, merchant login)
6. Notify merchants via email/SMS of temporary service in Ireland
7. Once af-south-1 restored: failback to primary region
```

**Estimated failover time:** 30-45 minutes

---

## 10. Monitoring & Observability (South Africa)

### CloudWatch Metrics to Track

```
Payment Processing:
- forgepay_transactions_total (by status: success/failed/pending)
- forgepay_transaction_amount_zar (by merchant, payment method)
- forgepay_payment_latency_ms (p50, p95, p99)
- forgepay_settlement_latency_hours

Compliance:
- forgepay_sar_count (by risk_level: low/medium/high)
- forgepay_merchant_kyc_pending
- forgepay_suspicious_transactions_flagged

Infrastructure:
- eks_node_cpu_utilization (should stay <80%)
- eks_node_memory_utilization (should stay <85%)
- rds_cpu_utilization (should stay <70%)
- rds_connections_active (alert if >500)
- redis_evicted_keys (alert if >0)
- redis_memory_utilization (should stay <80%)

Security:
- waf_blocked_requests_total (by reason)
- guardduty_findings_high (alert immediately)
- unauthorized_api_attempts (by IP/region)
```

### Alerting Rules (PagerDuty Integration)

```yaml
# Critical (page immediately)
- Payment transaction success rate < 95%
- RDS CPU > 90% for > 5 minutes
- EKS cluster autoscaler failures
- FSCA AML/CFT violations detected
- WAF blocking >1000 requests/minute

# High (create ticket)
- Any transaction latency > 5 seconds
- Redis eviction events
- CloudFront errors > 1%
- RDS slowlog entries > 100/minute

# Medium (log only)
- Node scaling events
- Backup completion times
- DNS resolution latency
```

---

## 11. Getting Started: Quick Deploy Guide

### Prerequisites

```bash
# Install tools
brew install terraform aws-cli kubectl helm

# Configure AWS
aws configure --profile forgepay-sa
# Region: af-south-1
# Output: json

# Set environment
export AWS_PROFILE=forgepay-sa
export AWS_REGION=af-south-1
```

### Deploy Infrastructure

```bash
# 1. Initialize Terraform
cd forgepay/infra/terraform/aws/south_africa
terraform init

# 2. Plan deployment
terraform plan -out=tfplan

# 3. Review plan and apply
terraform apply tfplan

# 4. Get kubeconfig
aws eks update-kubeconfig --name forgepay-sa-prod --region af-south-1

# 5. Verify cluster
kubectl get nodes

# 6. Deploy services
kubectl apply -f ../../k8s/south-africa/
kubectl rollout status deployment/router -n forgepay --timeout=5m

# 7. Verify services
kubectl port-forward svc/router 8080:8080 -n forgepay
curl http://localhost:8080/health
```

### Cleanup (if needed)

```bash
# Delete Kubernetes resources
kubectl delete namespace forgepay

# Destroy AWS infrastructure
terraform destroy
```

---

## 12. Cost Optimization Recommendations

### Immediate (Month 1)

- Use Spot instances for non-critical services (30% cost savings)
- Right-size RDS: Start with Aurora Serverless (pay-per-ACU)
- S3 Intelligent-Tiering for automatic cost optimization

### Short-term (Month 3-6)

- Reserved Instances for EKS compute (30% savings if 1-year commitment)
- S3 Glacier transition for backups older than 90 days
- CloudFront cache optimization (reduced origin requests)

### Long-term (Year 1+)

- Migrate to Graviton processors (ARM-based, 20% cheaper)
- Consolidate databases (multi-tenancy for smaller merchants)
- Build private MPLS connection to Nedbank (eliminate NAT costs)

---

## 13. Contact & Support

For issues with this deployment guide:
- **AWS Support:** Use AWS Support console (production support plan recommended)
- **Hyperswitch Docs:** https://hyperswitch.io/docs
- **ForgePay Team:** See FORGEPAY.md for team structure

---

**Last Updated:** June 2026  
**Status:** Ready for Production  
**Maintainer:** ForgePay Infrastructure Team
