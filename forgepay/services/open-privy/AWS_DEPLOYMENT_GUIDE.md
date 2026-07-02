# AWS Deployment Guide for OpenPrivy

**Version:** 1.0
**Last Updated:** June 30, 2026
**Status:** Production Ready

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start (30 minutes)](#quick-start-30-minutes)
4. [Detailed Deployment](#detailed-deployment)
5. [Post-Deployment Configuration](#post-deployment-configuration)
6. [Monitoring & Maintenance](#monitoring--maintenance)
7. [Troubleshooting](#troubleshooting)
8. [Cost Optimization](#cost-optimization)
9. [Disaster Recovery](#disaster-recovery)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
└────────────────────────┬────────────────────────────────────┘
                         │
                    Route 53 (DNS)
                         │
            ┌────────────┴────────────┐
            │                         │
        AWS WAF                   Application
    (DDoS Protection)         Load Balancer (ALB)
            │                         │
            └────────────┬────────────┘
                         │
            ┌────────────┴────────────┐
            │                         │
        VPC (10.0.0.0/16)            │
        │                            │
        ├─ Public Subnets (ALB)      │
        │  ├─ 10.0.1.0/24           │
        │  └─ 10.0.2.0/24           │
        │                            │
        ├─ Private Subnets (EKS)    │
        │  ├─ 10.0.11.0/24          │
        │  └─ 10.0.12.0/24          │
        │                            │
        ├─ EKS Cluster              │
        │  ├─ 3 Master Nodes        │
        │  ├─ 3-10 Worker Nodes     │
        │  │  └─ Backend Pods (1-10)
        │  ├─ Prometheus (monitoring)
        │  └─ Network Policies      │
        │                            │
        ├─ RDS PostgreSQL (Multi-AZ)
        │  ├─ Encryption at Rest    │
        │  ├─ 30-day backups        │
        │  └─ Automated failover    │
        │                            │
        └─ ElastiCache Redis        │
           ├─ Multi-node cluster    │
           ├─ Encryption in transit │
           └─ Auto failover         │
            │
        ├─ S3 Buckets               │
        │  ├─ Backups               │
        │  ├─ Logs                  │
        │  └─ Assets                │
        │
        └─ Secrets Manager          │
           ├─ DB credentials        │
           ├─ API keys              │
           └─ Encryption keys       │
```

---

## Prerequisites

### AWS Account Setup

1. **Create AWS Account**
   ```bash
   # Visit https://aws.amazon.com/free/
   # Create account with business email
   ```

2. **Set up IAM User for Deployments**
   ```bash
   # In AWS Console:
   # IAM → Users → Create User
   # Attach policies:
   # - CloudFormationFullAccess
   # - EC2FullAccess
   # - RDSFullAccess
   # - ElastiCacheFullAccess
   # - EKSFullAccess
   # - VPCFullAccess
   # - IAMFullAccess (for roles)
   # - SecretsManagerFullAccess
   # - S3FullAccess
   # - CloudWatchFullAccess
   ```

3. **Create Access Keys**
   ```bash
   # IAM → Users → Security Credentials
   # Create Access Key (command line / programmatic access)
   # Download and save securely
   ```

### Local Tools Installation

```bash
# AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
aws --version

# kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
kubectl version --client

# Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
helm version

# Docker (for local testing)
# Visit https://docs.docker.com/get-docker/

# jq (JSON processing)
sudo apt-get install jq

# openssl (certificate generation)
sudo apt-get install openssl
```

### Environment Variables

```bash
# Create ~/.aws/credentials
export AWS_ACCESS_KEY_ID="your_access_key"
export AWS_SECRET_ACCESS_KEY="your_secret_key"
export AWS_REGION="us-east-1"
export AWS_PROFILE="default"

# OpenPrivy config
export CLUSTER_NAME="openprivy-prod"
export ENVIRONMENT="production"
```

---

## Quick Start (30 minutes)

### 1. Clone Repository

```bash
git clone https://github.com/khayaai/open-privy.git
cd open-privy
```

### 2. Configure AWS Credentials

```bash
aws configure
# Enter AWS Access Key ID
# Enter AWS Secret Access Key
# Region: us-east-1
# Output format: json

# Verify credentials
aws sts get-caller-identity
```

### 3. Deploy Infrastructure

```bash
# Make deploy script executable
chmod +x aws/deploy-aws.sh

# Set variables
export CLUSTER_NAME="openprivy-prod"
export AWS_REGION="us-east-1"
export AWS_PROFILE="default"
export ENVIRONMENT="production"

# Generate secure password for database
export DB_MASTER_PASSWORD=$(openssl rand -base64 32)

# Run deployment (this takes ~20 minutes)
./aws/deploy-aws.sh
```

### 4. Verify Deployment

```bash
# Check cluster
kubectl cluster-info

# Check nodes
kubectl get nodes

# Check pods
kubectl get pods -n openprivy

# Check services
kubectl get svc -n openprivy

# Get ALB DNS
kubectl get svc backend-alb -n openprivy -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

### 5. Configure DNS

```bash
# In Route 53 or your DNS provider:
# Create A record: openprivy.io → ALB_ENDPOINT
# Create A record: api.openprivy.io → ALB_ENDPOINT

# Verify DNS
nslookup openprivy.io
nslookup api.openprivy.io
```

---

## Detailed Deployment

### Step 1: VPC and EKS Cluster

The CloudFormation template creates:
- VPC with CIDR 10.0.0.0/16
- 2 Public subnets (for ALB/NAT)
- 2 Private subnets (for EKS nodes)
- EKS cluster with 3 master nodes
- Auto-scaling node group (3-10 nodes, t3.large)

```bash
# Deploy
aws cloudformation deploy \
  --template-file aws/cloudformation-vpc-eks.yaml \
  --stack-name openprivy-prod-vpc-eks \
  --capabilities CAPABILITY_IAM \
  --region us-east-1

# Verify
aws cloudformation describe-stacks \
  --stack-name openprivy-prod-vpc-eks \
  --region us-east-1 | jq '.Stacks[0].StackStatus'

# Should show: CREATE_COMPLETE
```

**Estimated Time:** 15-20 minutes
**Cost:** ~$200/month (3 nodes × t3.large)

### Step 2: RDS PostgreSQL

The CloudFormation template creates:
- Multi-AZ RDS instance (db.t3.medium)
- 100GB storage (gp3)
- Encryption at rest (KMS)
- Automated backups (30-day retention)
- Enhanced monitoring

```bash
# Deploy
aws cloudformation deploy \
  --template-file aws/cloudformation-databases.yaml \
  --stack-name openprivy-prod-databases \
  --parameter-overrides \
    ClusterName="openprivy-prod" \
    DBMasterPassword="$DB_MASTER_PASSWORD" \
    VpcId="vpc-xxxxx" \
    PrivateSubnet1="subnet-xxxxx" \
    PrivateSubnet2="subnet-xxxxx" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1

# Verify
aws cloudformation describe-stacks \
  --stack-name openprivy-prod-databases \
  --region us-east-1 | jq '.Stacks[0].Outputs'
```

**Estimated Time:** 10-15 minutes
**Cost:** ~$150/month

### Step 3: Configure kubectl

```bash
# Update kubeconfig
aws eks update-kubeconfig \
  --name openprivy-prod \
  --region us-east-1

# Verify
kubectl cluster-info

# Check nodes
kubectl get nodes
# Should show 3 nodes

# Wait for nodes to be ready
kubectl wait --for=condition=ready node --all --timeout=5m
```

### Step 4: Create Kubernetes Namespaces

```bash
# Create namespaces
kubectl create namespace openprivy
kubectl create namespace monitoring
kubectl create namespace ingress-nginx

# Verify
kubectl get namespaces
```

### Step 5: Create Secrets

```bash
# Database credentials
kubectl create secret generic db-credentials \
  --from-literal=DATABASE_URL="postgresql://admin:${DB_MASTER_PASSWORD}@rds-endpoint:5432/openprivy" \
  -n openprivy

# Redis URL
kubectl create secret generic redis-credentials \
  --from-literal=REDIS_URL="redis://redis-endpoint:6379/0" \
  -n openprivy

# JWT and encryption keys
kubectl create secret generic app-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -base64 32)" \
  --from-literal=ENCRYPTION_KEY="$(openssl rand -c 32)" \
  -n openprivy

# API keys (update with real values)
kubectl create secret generic external-apis \
  --from-literal=ALCHEMY_API_KEY="pk_..." \
  --from-literal=PIMLICO_API_KEY="pk_..." \
  -n openprivy

# Verify
kubectl get secrets -n openprivy
```

### Step 6: Deploy ECR and Push Image

```bash
# Create ECR repository
aws ecr create-repository \
  --repository-name openprivy-backend \
  --region us-east-1 \
  --image-scan-on-push \
  --encryption-configuration encryptionType=KMS

# Build Docker image
docker build \
  -t openprivy-backend:latest \
  -f services/backend/Dockerfile \
  .

# Tag for ECR
docker tag openprivy-backend:latest \
  $(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/openprivy-backend:latest

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  $(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com

# Push image
docker push $(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/openprivy-backend:latest

# Verify
aws ecr describe-images \
  --repository-name openprivy-backend \
  --region us-east-1
```

### Step 7: Deploy Backend to EKS

```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/backend.yaml -n openprivy
kubectl apply -f k8s/prometheus.yaml -n openprivy
kubectl apply -f k8s/prometheus-rules.yaml -n openprivy

# Wait for deployment
kubectl wait --for=condition=available \
  deployment/backend \
  -n openprivy \
  --timeout=300s

# Verify
kubectl get pods -n openprivy
kubectl get svc -n openprivy

# Check logs
kubectl logs -n openprivy -l app=backend
```

### Step 8: Create Load Balancer and DNS

```bash
# Create ALB service
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: backend-alb
  namespace: openprivy
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: nlb
    service.beta.kubernetes.io/aws-load-balancer-scheme: internet-facing
spec:
  type: LoadBalancer
  ports:
    - port: 80
      targetPort: 3001
      protocol: TCP
  selector:
    app: backend
EOF

# Wait for ALB to be provisioned
sleep 60

# Get ALB DNS
ALB_DNS=$(kubectl get svc backend-alb -n openprivy \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "ALB DNS: $ALB_DNS"

# Create Route 53 records
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [
      {
        "Action": "CREATE",
        "ResourceRecordSet": {
          "Name": "api.openprivy.io",
          "Type": "CNAME",
          "TTL": 300,
          "ResourceRecords": [{"Value": "'$ALB_DNS'"}]
        }
      }
    ]
  }'
```

---

## Post-Deployment Configuration

### 1. SSL/TLS Certificates

```bash
# Request certificate in ACM
aws acm request-certificate \
  --domain-name openprivy.io \
  --subject-alternative-names "*.openprivy.io" \
  --validation-method DNS \
  --region us-east-1

# Validate DNS ownership (follow AWS Console instructions)

# Update ALB to use certificate
# In AWS Console: EC2 → Load Balancers → backend-alb → Listeners
# Add HTTPS (443) listener with certificate
```

### 2. WAF Configuration

```bash
# Create WAF Web ACL
aws wafv2 create-web-acl \
  --name openprivy-waf \
  --scope CLOUDFRONT \
  --default-action Allow={} \
  --rules file://waf-rules.json \
  --region us-east-1

# Attach to ALB
aws wafv2 associate-web-acl \
  --resource-arn arn:aws:elasticloadbalancing:... \
  --web-acl-arn arn:aws:wafv2:... \
  --region us-east-1
```

### 3. CloudWatch Dashboards

```bash
# Create monitoring dashboard
aws cloudwatch put-dashboard \
  --dashboard-name openprivy-prod \
  --dashboard-body file://cloudwatch-dashboard.json
```

### 4. SNS Alerts

```bash
# Create SNS topic
aws sns create-topic --name openprivy-alerts

# Subscribe to topic
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:...:openprivy-alerts \
  --protocol email \
  --notification-endpoint ops@openprivy.io
```

### 5. Database Initialization

```bash
# Port-forward to database
kubectl exec -it postgres-0 -n openprivy -- \
  psql -U admin -d openprivy

# Run migrations
kubectl exec -it backend-abc123 -n openprivy -- \
  npm run migrate:prod

# Seed test data
kubectl exec -it backend-abc123 -n openprivy -- \
  npm run seed:prod
```

---

## Monitoring & Maintenance

### Access Prometheus

```bash
# Port-forward
kubectl port-forward -n monitoring svc/prometheus 9090:9090

# Visit http://localhost:9090

# Key queries:
# - rate(openprivy_requests_total[5m])
# - rate(openprivy_errors_total[5m]) / rate(openprivy_requests_total[5m])
# - histogram_quantile(0.95, rate(openprivy_request_duration_seconds_bucket[5m]))
```

### Access Grafana

```bash
# Port-forward
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80

# Visit http://localhost:3000
# Default credentials: admin / prom-operator

# Import dashboards
# Dashboards → Import → 6417 (Kubernetes Cluster Monitoring)
```

### View Logs

```bash
# Backend logs
kubectl logs -n openprivy -l app=backend -f

# RDS logs
aws rds describe-db-log-files \
  --db-instance-identifier openprivy-prod-db

# ElastiCache logs
aws elasticache describe-events \
  --source-type cluster
```

### Scale Cluster

```bash
# Manually scale
kubectl scale deployment backend --replicas=5 -n openprivy

# Check HPA status
kubectl get hpa -n openprivy

# Update HPA if needed
kubectl patch hpa backend-hpa \
  -n openprivy \
  -p '{"spec":{"maxReplicas":20}}'
```

### Database Backups

```bash
# Create manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier openprivy-prod-db \
  --db-snapshot-identifier openprivy-backup-$(date +%Y%m%d)

# List snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier openprivy-prod-db

# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier openprivy-prod-restored \
  --db-snapshot-identifier openprivy-backup-20260630
```

---

## Troubleshooting

### Pods Crashing

```bash
# Check pod status
kubectl describe pod <pod-name> -n openprivy

# Check logs
kubectl logs <pod-name> -n openprivy --previous

# Check resource limits
kubectl top pods -n openprivy

# Check events
kubectl get events -n openprivy --sort-by='.lastTimestamp'
```

### Database Connection Issues

```bash
# Test database connectivity
kubectl exec -it backend-abc123 -n openprivy -- \
  psql -h $RDS_ENDPOINT -U admin -d openprivy -c "SELECT 1"

# Check database logs
aws rds describe-db-log-files \
  --db-instance-identifier openprivy-prod-db \
  --filters Name=filename,Values=postgresql.log

# Check security groups
aws ec2 describe-security-groups \
  --filters "Name=tag:Name,Values=openprivy*"
```

### High Latency

```bash
# Check slow queries
kubectl exec -it postgres-0 -n openprivy -- psql -U admin -d openprivy << EOF
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
EOF

# Check Redis performance
redis-cli --stat

# Check pod resource usage
kubectl top pods -n openprivy
```

### Deployment Failures

```bash
# Rollback deployment
kubectl rollout undo deployment/backend -n openprivy

# Check rollout history
kubectl rollout history deployment/backend -n openprivy

# View specific revision
kubectl rollout history deployment/backend -n openprivy --revision=2
```

---

## Cost Optimization

### 1. Use Spot Instances for Dev

```bash
# Create spot instance node group
aws eks create-nodegroup \
  --cluster-name openprivy-prod \
  --nodegroup-name spot-nodes \
  --capacity-type SPOT \
  --instance-types t3.large t3.xlarge \
  --scaling-config minSize=1,maxSize=5,desiredSize=1
```

### 2. Optimize RDS

```bash
# Use smaller instance for dev
aws rds modify-db-instance \
  --db-instance-identifier openprivy-dev-db \
  --db-instance-class db.t3.small \
  --apply-immediately

# Enable performance insights
aws rds modify-db-instance \
  --db-instance-identifier openprivy-prod-db \
  --enable-performance-insights-kms-key-id arn:aws:kms:...
```

### 3. Set up Cost Alerts

```bash
# Budget alert
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget file://budget.json \
  --notifications-with-subscribers file://notifications.json
```

---

## Disaster Recovery

### RTO: < 1 hour, RPO: < 15 minutes

### Backup Strategy

```bash
# Daily database snapshots (automatic)
# Weekly export to S3 (manual)
# Continuous replication to standby

# Export database
aws rds start-export-task \
  --export-task-identifier openprivy-backup-$(date +%s) \
  --source-arn arn:aws:rds:us-east-1:...:db:openprivy-prod-db \
  --s3-bucket-name openprivy-backups \
  --s3-prefix backups/ \
  --iam-role-arn arn:aws:iam::...:role/rds-export-role
```

### Recovery Steps

```bash
# 1. Restore database
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier openprivy-prod-recovered \
  --db-snapshot-identifier openprivy-backup-20260630

# 2. Update backend secrets
kubectl patch secret db-credentials \
  --type merge -p '{"data":{"DATABASE_URL":"'$(echo -n "new-url" | base64)'"}}'

# 3. Redeploy backend
kubectl rollout restart deployment/backend -n openprivy

# 4. Verify
kubectl get pods -n openprivy
```

---

## Contact & Support

**Issues?** Check:
- AWS CloudFormation Events: `aws cloudformation describe-stack-events --stack-name openprivy-prod-vpc-eks`
- EKS Cluster Logs: `kubectl get events -n openprivy`
- Application Logs: `kubectl logs -n openprivy -l app=backend`

**Need Help?**
- Docs: https://docs.openprivy.io
- Discord: https://discord.gg/openprivy
- Email: ops@openprivy.io

---

**OpenPrivy is now deployed on AWS and ready for production!**
