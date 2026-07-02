# OpenPrivy Production Deployment Guide

## Pre-Deployment Checklist

### Security ✅
- [ ] Smart contracts audited by external firm
- [ ] Backend security audit completed
- [ ] Mobile app security review completed
- [ ] Secrets management (Vault/AWS Secrets Manager) configured
- [ ] SSL/TLS certificates generated
- [ ] API rate limiting configured
- [ ] DDoS protection enabled (Cloudflare/AWS Shield)
- [ ] CORS properly configured for production domains only

### Infrastructure ✅
- [ ] Kubernetes cluster provisioned (AWS EKS / GCP GKE / Azure AKS)
- [ ] PostgreSQL production instance (managed service recommended)
- [ ] Redis cluster configured (managed service recommended)
- [ ] VPC and security groups properly configured
- [ ] Backup and disaster recovery tested
- [ ] Load balancer configured with health checks
- [ ] CDN configured for static assets
- [ ] DNS records updated

### Monitoring ✅
- [ ] Prometheus scraping all services
- [ ] Grafana dashboards created
- [ ] Alert rules configured and tested
- [ ] Sentry error tracking integrated
- [ ] Log aggregation (ELK/Loki) set up
- [ ] Distributed tracing (Jaeger) configured
- [ ] On-call escalation policies defined

### Testing ✅
- [ ] E2E tests passing on production-like environment
- [ ] Load testing completed (target: 1000+ RPS)
- [ ] Smoke tests for critical flows
- [ ] Disaster recovery plan tested
- [ ] Rollback procedures tested
- [ ] Database migration tested

### Documentation ✅
- [ ] API documentation (OpenAPI/Swagger) published
- [ ] Runbooks created for common incidents
- [ ] Playbooks for major outages
- [ ] Architecture diagrams updated
- [ ] Deployment procedures documented
- [ ] Support escalation guide created

## Architecture

### High Availability Setup
```
┌─────────────────┐
│   Cloudflare    │ (DDoS protection, CDN)
└────────┬────────┘
         │
┌─────────────────────────┐
│  AWS Application Load    │ (Health checks, SSL termination)
│      Balancer           │
└────────┬────────────────┘
         │
    ┌────┴────┬─────────┬──────────┐
    │          │         │          │
┌───▼──┐  ┌───▼──┐  ┌───▼──┐  ┌───▼──┐
│Pod 1 │  │Pod 2 │  │Pod 3 │  │Pod N │ (Auto-scaled 3-10)
│Back- │  │Back- │  │Back- │  │Back- │
│end   │  │end   │  │end   │  │end   │
└───┬──┘  └───┬──┘  └───┬──┘  └───┬──┘
    │          │         │        │
    └─────┬────┴────┬────┴────┬───┘
          │         │         │
    ┌─────▼─┐  ┌───▼───┐  ┌──▼─────┐
    │Postgres│  │Redis  │  │Vault   │
    │Primary │  │Cluster│  │Secrets │
    └───────-┘  └───────┘  └────────┘
```

## Pre-Launch Setup

### 1. Infrastructure (AWS Example)

```bash
# Create EKS cluster
aws eks create-cluster \
  --name openprivy-prod \
  --version 1.28 \
  --role-arn arn:aws:iam::ACCOUNT_ID:role/eks-service-role \
  --resources-config nodeGroups=3,nodeType=t3.large

# Create RDS PostgreSQL
aws rds create-db-instance \
  --db-instance-identifier openprivy-prod \
  --db-instance-class db.t3.large \
  --engine postgres \
  --master-username openprivy \
  --allocated-storage 200 \
  --backup-retention-period 30 \
  --enable-cloudwatch-logs-exports postgresql

# Create ElastiCache Redis
aws elasticache create-replication-group \
  --replication-group-description "OpenPrivy Production Redis" \
  --engine redis \
  --engine-version 7.0 \
  --cache-node-type cache.t3.medium \
  --num-cache-clusters 3 \
  --automatic-failover-enabled
```

### 2. Kubernetes Deployment

```bash
# Apply namespace
kubectl apply -f k8s/namespace.yaml

# Apply monitoring (Prometheus)
kubectl apply -f k8s/prometheus.yaml

# Apply databases
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml

# Apply backend
kubectl apply -f k8s/backend.yaml

# Verify deployment
kubectl get pods -n openprivy
kubectl logs -n openprivy deployment/backend
```

### 3. Secrets Management

```bash
# Install Vault (or use AWS Secrets Manager)
helm repo add hashicorp https://helm.releases.hashicorp.com
helm install vault hashicorp/vault -n openprivy

# Seal Vault
vault operator init
vault operator unseal

# Store secrets
vault kv put secret/openprivy/backend \
  jwt_secret="$(openssl rand -hex 32)" \
  encryption_key="$(openssl rand -hex 16)" \
  database_password="$(openssl rand -base64 32)" \
  redis_password="$(openssl rand -base64 32)"

# Create Kubernetes secret from Vault
kubectl create secret generic backend-secrets \
  --from-literal=DATABASE_URL=$DB_URL \
  --from-literal=JWT_SECRET=$JWT_SECRET \
  -n openprivy
```

### 4. Certificate Management

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create ClusterIssuer for Let's Encrypt
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@openprivy.io
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

### 5. Ingress Configuration

```bash
# Install NGINX Ingress
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace

# Apply ingress resource
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: openprivy-ingress
  namespace: openprivy
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
  - hosts:
    - api.openprivy.io
    secretName: openprivy-tls
  rules:
  - host: api.openprivy.io
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: backend
            port:
              number: 3001
EOF
```

## Deployment Steps

### 1. Smart Contracts Deployment

```bash
cd services/contracts

# Deploy to Ethereum mainnet
PRIVATE_KEY=<key> \
ETHEREUM_RPC_MAINNET=<rpc> \
ETHERSCAN_API_KEY=<key> \
npm run deploy:mainnet

# Verify contracts
npm run verify:mainnet -- --address <contract_address> --constructorArgs <args>
```

### 2. Database Migrations

```bash
# Run migrations
kubectl exec -n openprivy deployment/backend -- npm run migrate

# Verify schema
kubectl exec -n openprivy postgres-0 -- \
  psql -U openprivy -d openprivy -c "\dt"
```

### 3. Canary Deployment

```bash
# Deploy 1 replica first
kubectl set replicas deployment/backend 1 -n openprivy

# Monitor for errors
kubectl logs -n openprivy deployment/backend -f

# Scale up gradually
kubectl set replicas deployment/backend 3 -n openprivy
sleep 5m
kubectl set replicas deployment/backend 5 -n openprivy
```

### 4. Smoke Tests

```bash
# Run smoke tests against production
BASE_URL=https://api.openprivy.io npm run test:smoke

# Results should show all critical paths working
```

## Post-Deployment Validation

### Health Checks

```bash
# Check backend health
curl https://api.openprivy.io/health

# Check database
kubectl exec -n openprivy postgres-0 -- \
  pg_isready -U openprivy -d openprivy

# Check Redis
kubectl exec -n openprivy redis-0 -- redis-cli ping

# Check Prometheus metrics
curl https://prometheus.openprivy.io/api/v1/query?query=up
```

### Performance Validation

```bash
# Load test
k6 run --vus 100 --duration 10m \
  --out json=results.json \
  test/load/api-load.k6.js

# Analyze results
jq '.metrics[] | select(.type == "trend")' results.json
```

## Monitoring & Alerting

### Key Metrics to Monitor

```
- Request rate (RPS)
- Error rate (< 0.1%)
- P95 latency (< 500ms)
- P99 latency (< 1000ms)
- Pod CPU (< 70%)
- Pod memory (< 80%)
- Database connections (< 150/200)
- Gas sponsored ($ tracking)
- Failed transactions (count)
```

### Alert Thresholds

```yaml
Critical:
  - Error rate > 5%
  - P95 latency > 2s
  - Pod down
  - Database unavailable
  
High:
  - Error rate > 1%
  - P95 latency > 1s
  - Memory > 85%
  - CPU > 80%

Medium:
  - Error rate > 0.5%
  - P95 latency > 700ms
```

### Incident Response

```
1. Alert fires → PagerDuty notification
2. On-call engineer investigates
3. Check logs: kubectl logs -n openprivy deployment/backend
4. Check metrics: Prometheus dashboard
5. Check database: psql connection
6. Rollback if needed: kubectl rollout undo deployment/backend -n openprivy
7. Post-incident review within 24 hours
```

## Disaster Recovery

### Backup Strategy

```bash
# Automated backups
- PostgreSQL: Daily snapshots (30-day retention)
- Redis: RDB snapshots every 6 hours
- Secrets: Vault replicated across regions
- Code: Git repository with GitHub backups

# Test restore (monthly)
kubectl delete pvc postgres-pvc -n openprivy
kubectl apply -f k8s/postgres.yaml
# Restore from backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier openprivy-restore \
  --db-snapshot-identifier openprivy-snapshot
```

### Failover Procedure

```bash
# If primary database fails
aws rds promote-read-replica --db-instance-identifier openprivy-replica

# If Kubernetes cluster fails
# Terraform stack to spin up new cluster
cd terraform/
terraform apply -var="environment=prod"

# Restore from backups
kubectl apply -f k8s/
aws s3 cp s3://openprivy-backups/latest.sql - | \
  psql -h new-postgres-endpoint.rds.amazonaws.com -U openprivy
```

## Cost Optimization

### Resource Sizing

```
Development:
- 1x t3.small backend pod
- 1x db.t3.small PostgreSQL
- Redis cache.t3.micro

Production:
- 3-10x t3.medium backend pods (HPA)
- db.t3.xlarge PostgreSQL (2 replicas)
- 3-node Redis cluster cache.t3.large
```

### Estimated Monthly Costs (AWS)

```
Compute (EKS):
- 3 t3.medium nodes: $75/month
- 1 t3.large for master: $50/month

Database:
- RDS PostgreSQL db.t3.xlarge: $400/month
- ElastiCache Redis 3-node: $250/month

Networking:
- ALB: $16/month
- Data transfer: $100/month

Monitoring:
- Prometheus: included in cluster
- Grafana Cloud: $50/month

Backups:
- S3: $50/month

Total: ~$990/month (can reduce with reserved instances to ~$600)
```

## Security Checklist

- [ ] Network policies configured (egress/ingress)
- [ ] Pod security policies enforced
- [ ] RBAC roles for all service accounts
- [ ] Secrets never logged or exposed
- [ ] Rate limiting on all endpoints
- [ ] CORS configured restrictively
- [ ] HTTPS everywhere (no HTTP)
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS protection headers configured
- [ ] CSRF tokens for state-changing operations
- [ ] Encryption at rest (PostgreSQL) and in transit (TLS)
- [ ] Regular security updates scheduled

## Rollback Procedures

```bash
# If deployment fails
kubectl rollout undo deployment/backend -n openprivy

# Check rollback status
kubectl rollout status deployment/backend -n openprivy

# View rollout history
kubectl rollout history deployment/backend -n openprivy

# Rollback to specific revision
kubectl rollout undo deployment/backend -n openprivy --to-revision=2
```

## Support & Documentation

- **API Docs:** https://docs.openprivy.io
- **Status Page:** https://status.openprivy.io
- **Support:** support@openprivy.io
- **Security Issues:** security@openprivy.io

---

**Last Updated:** June 30, 2026  
**Version:** 1.0.0  
**Maintained By:** OpenPrivy Operations Team
