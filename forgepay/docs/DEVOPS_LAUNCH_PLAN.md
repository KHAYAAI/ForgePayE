# ForgePay DevOps Launch Plan
**Version:** 2026-05-05  
**Target:** Closed Beta — 50 merchants on AWS us-east-1  
**Branch:** `claude/forgepay-platform-design-gEkgE`

---

## Prerequisites Checklist

Before starting, every engineer on the team must have:

- [ ] AWS CLI v2 configured (`aws sts get-caller-identity` returns your account)
- [ ] `kubectl` 1.29+ installed
- [ ] `helm` 3.15+ installed
- [ ] `terraform` 1.6+ installed
- [ ] `docker` 24+ and `docker compose` v2 installed
- [ ] `k6` installed (load testing)
- [ ] `vault` CLI installed
- [ ] GitHub repo access: `khayaai/forgepaye`
- [ ] AWS IAM permissions: EKS admin, RDS admin, EC2, S3, IAM
- [ ] GitHub Environments access to create `staging` and `production` environments

---

## Phase 0 — Local Validation (Day 0)
**Owner:** Any engineer  
**Duration:** 2-3 hours  
**Goal:** Confirm the entire stack boots and all tests pass before touching cloud.

### Step 0.1 — Clone & Configure Local Environment

```bash
git clone https://github.com/khayaai/forgepaye.git forgepaye
cd forgepaye
git checkout claude/forgepay-platform-design-gEkgE
```

Create local env overrides:

```bash
cat > .env.local << 'EOF'
# Dev secrets — never commit
POSTGRES_PASSWORD=devpassword
REDIS_URL=redis://localhost:6379
INTERNAL_WEBHOOK_SECRET=dev-internal-secret-change-me
HYPERSWITCH_WEBHOOK_SECRET=dev-hs-secret
KILLBILL_WEBHOOK_SECRET=dev-kb-secret-12345
STABLECOIN_GW_WEBHOOK_SECRET=dev-sc-secret
CRYPTO_GW_WEBHOOK_SECRET=dev-crypto-secret
HD_WALLET_SEED=dfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdf
PRIVATE_KEY_ENCRYPTION_KEY=dededededededededededededededededededededededededededededededede
EOF
```

### Step 0.2 — Start Infrastructure

```bash
# Start all services (postgres, redis, all gateways, observability)
docker compose -f forgepay/infra/k8s/docker-compose.dev.yml up -d

# Wait for postgres health (takes ~20 seconds)
docker compose -f forgepay/infra/k8s/docker-compose.dev.yml \
  exec postgres pg_isready -U forgepay
```

**Port map after startup:**

| Service | Port | URL |
|---------|------|-----|
| Payment Engine | 8080 | http://localhost:8080 |
| Unified Router | 8000 | http://localhost:8000 |
| MoR Layer | 8010 | http://localhost:8010 |
| Stablecoin Gateway | 8020 | http://localhost:8020 |
| Crypto Gateway | 8030 | http://localhost:8030 |
| Marketing Site | 3000 | http://localhost:3000 |
| Grafana | 3001 | http://localhost:3001 (admin/devpassword) |
| Prometheus | 9090 | http://localhost:9090 |
| Jaeger | 16686 | http://localhost:16686 |

### Step 0.3 — Run Test Suites

```bash
# TypeScript services
cd forgepay/services/unified-router && npm ci && npm test
cd forgepay/services/crypto-gateway && npm ci && npm test
cd forgepay/services/stablecoin-gateway && npm ci && npm test
cd forgepay/services/chain-sync && npm ci && npm test
cd forgepay/services/billing-engine && npm ci && npm test

# Python services
cd forgepay/services/mor-layer && pip install -e ".[dev]" && pytest tests/ -v

# Integration tests
cd forgepay/tests/integration && npm ci && npm test

# SDKs
cd forgepay/packages/sdk-js && npm ci && npm test
cd forgepay/packages/sdk-python && pip install -e ".[dev]" && pytest tests/ -v

# Helm lint
helm lint forgepay/infra/helm/forgepay-stack/
helm lint forgepay/infra/helm/unified-router/
helm lint forgepay/infra/helm/payment-engine/
```

**All tests must pass before continuing to Phase 1.**

### Step 0.4 — Smoke Test Local Services

```bash
# Health checks
curl -sf http://localhost:8000/healthz | jq .   # unified-router
curl -sf http://localhost:8010/health   | jq .   # mor-layer
curl -sf http://localhost:8020/healthz  | jq .   # stablecoin-gateway
curl -sf http://localhost:8030/healthz  | jq .   # crypto-gateway

# Create test payment intent
curl -sf -X POST http://localhost:8080/payments \
  -H "Content-Type: application/json" \
  -H "api-key: test_key" \
  -d '{"amount":4900,"currency":"USD","customer_id":"cus_test_001","idempotency_key":"smoke_001"}' | jq .

# Create test crypto invoice
curl -sf -X POST http://localhost:8030/invoices \
  -H "Content-Type: application/json" \
  -d '{"coin":"BTC","amount":0.001,"merchant_id":"merchant_test_001"}' | jq .
```

**Expected:** All return 200/201 with valid JSON.

---

## Phase 1 — AWS Infrastructure Provisioning (Days 1–3)
**Owner:** Senior DevOps / Platform Engineer  
**Duration:** 3 days  
**Goal:** Create the VPC, EKS cluster, RDS, Redis, S3, Vault, and CloudFront on AWS us-east-1.

### Step 1.1 — Bootstrap Terraform Backend

Create the S3 bucket and DynamoDB table for Terraform state **before** running any module:

```bash
# Only run this once — manual bootstrap
aws s3api create-bucket \
  --bucket forgepay-terraform-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket forgepay-terraform-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket forgepay-terraform-state \
  --server-side-encryption-configuration '{
    "Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws dynamodb create-table \
  --table-name forgepay-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### Step 1.2 — Create `staging.tfvars`

```bash
cat > forgepay/infra/terraform/staging.tfvars << 'EOF'
# Staging-specific variable overrides
aws_region  = "us-east-1"
environment = "staging"

# VPC
vpc_cidr           = "10.10.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# EKS
kubernetes_version      = "1.29"
eks_node_instance_types = ["t3.large"]
eks_node_desired_size   = 3
eks_node_min_size       = 2
eks_node_max_size       = 8

# RDS
db_username              = "forgepay"
db_instance_class        = "db.t3.medium"
db_allocated_storage     = 50
db_backup_retention_days = 7
db_multi_az              = false    # single-AZ acceptable for staging

# Redis
redis_engine_version       = "7.1"
redis_node_type            = "cache.t3.medium"
redis_num_nodes            = 1
redis_automatic_failover   = false

# Vault (use existing vault or deploy new)
vault_namespace = "forgepay-staging"
vault_addr      = "https://vault.staging.example.com"

# Monitoring
log_retention_days = 14
alert_email        = "devops@forgepay.io"

# ACM certificate ARN (create via ACM console first)
acm_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERT_ID"
cloudfront_allowed_origins = ["https://staging.forgepay.io"]
EOF
```

**Note:** `db_password` must be set via environment variable — never in tfvars:
```bash
export TF_VAR_db_password="$(openssl rand -base64 32)"
```

### Step 1.3 — Apply Terraform (Staging)

```bash
cd forgepay/infra/terraform

terraform init
terraform validate
terraform plan -var-file=staging.tfvars -out=staging.plan

# Review plan carefully — look for:
# - VPC CIDR conflicts
# - Security group inbound rules (should be restrictive)
# - RDS publicly accessible = false
# - EKS endpoint public access = true (needed for CI)

terraform apply staging.plan
```

**Outputs you'll need:**
```bash
terraform output eks_cluster_name    # forgepay-staging
terraform output eks_cluster_endpoint
terraform output rds_endpoint
terraform output redis_endpoint
terraform output s3_backup_bucket
```

### Step 1.4 — Configure kubectl

```bash
aws eks update-kubeconfig \
  --region us-east-1 \
  --name forgepay-staging

# Verify
kubectl get nodes
# Expected: 3 nodes in Ready state
```

### Step 1.5 — Install Cluster Prerequisites

```bash
# cert-manager (TLS certificates)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.5/cert-manager.yaml
kubectl wait --for=condition=ready pod -l app=cert-manager -n cert-manager --timeout=120s

# nginx ingress controller
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-type"=external \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-nlb-target-type"=ip \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-scheme"=internet-facing

# External Secrets Operator (Vault → K8s Secrets)
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets-system --create-namespace \
  --set installCRDs=true

# Metrics server (required for HPA)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

---

## Phase 2 — Secrets Wiring (Day 3)
**Owner:** Platform Engineer + Security Lead  
**Duration:** 4-6 hours  
**Goal:** All production secrets in Vault; services pull them at pod startup. Zero plaintext secrets in Helm values or git.

### Step 2.1 — Initialize Vault for Staging

```bash
export VAULT_ADDR=https://vault.staging.example.com
export VAULT_TOKEN=<your_initial_root_token>

# Run the ForgePay vault setup script
bash forgepay/infra/vault/setup-forgepay.sh staging

# Verify policies were created
vault policy list | grep forgepay
```

### Step 2.2 — Populate Real Secrets

Replace placeholder values one by one. Use the Vault CLI to set each:

```bash
# Database
vault kv put forgepay/staging/database/password \
  value="$(terraform output -raw rds_master_password)"

# Payment Engine (Hyperswitch API key from your account)
vault kv put forgepay/staging/payment-engine/api_key \
  value="snd_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Webhook signing secret (generate a new 256-bit key)
WEBHOOK_SECRET=$(openssl rand -hex 32)
vault kv put forgepay/staging/webhook/signing_secret value="$WEBHOOK_SECRET"

# Crypto Gateway HD wallet seed (NEVER reuse across environments)
CRYPTO_SEED=$(openssl rand -hex 64)
vault kv put forgepay/staging/crypto-gateway/hd_wallet_seed value="$CRYPTO_SEED"

# Stablecoin Gateway private key encryption key
PRIVKEY_ENC=$(openssl rand -hex 32)
vault kv put forgepay/staging/stablecoin-gateway/privkey_encryption_key value="$PRIVKEY_ENC"

# MoR Layer internal webhook secret
vault kv put forgepay/staging/mor-layer/internal_webhook_secret \
  value="$WEBHOOK_SECRET"

# Kill Bill webhook secret
vault kv put forgepay/staging/billing-engine/webhook_secret \
  value="$WEBHOOK_SECRET"
```

### Step 2.3 — Create ExternalSecret Resources

```bash
cat > /tmp/forgepay-secrets.yaml << 'EOF'
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: vault-backend
  namespace: forgepay-staging
spec:
  provider:
    vault:
      server: https://vault.staging.example.com
      path: forgepay/staging
      auth:
        kubernetes:
          mountPath: kubernetes
          role: forgepay-services

---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: forgepay-core-secrets
  namespace: forgepay-staging
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: forgepay-core-secrets
    creationPolicy: Owner
  data:
    - secretKey: POSTGRES_PASSWORD
      remoteRef: { key: database/password, property: value }
    - secretKey: INTERNAL_WEBHOOK_SECRET
      remoteRef: { key: webhook/signing_secret, property: value }
    - secretKey: HYPERSWITCH_API_KEY
      remoteRef: { key: payment-engine/api_key, property: value }
    - secretKey: HD_WALLET_SEED
      remoteRef: { key: crypto-gateway/hd_wallet_seed, property: value }
    - secretKey: PRIVATE_KEY_ENCRYPTION_KEY
      remoteRef: { key: stablecoin-gateway/privkey_encryption_key, property: value }
EOF

kubectl apply -f /tmp/forgepay-secrets.yaml

# Verify secret was created
kubectl get secret forgepay-core-secrets -n forgepay-staging
kubectl describe externalsecret forgepay-core-secrets -n forgepay-staging
```

### Step 2.4 — Store GitHub Secrets for CI

Navigate to: `https://github.com/khayaai/forgepaye/settings/environments`

Create two environments: `staging` and `production`

Then set these secrets in each:

```bash
# Staging environment secrets
STAGING_KUBECONFIG     = <base64-encoded kubeconfig for staging cluster>

# Production environment secrets (set after prod cluster is created)
PROD_KUBECONFIG        = <base64-encoded kubeconfig for prod cluster>

# Shared
STAGING_API_URL        = https://api.staging.forgepay.io
SLACK_WEBHOOK_URL      = https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

Encode kubeconfig:
```bash
cat ~/.kube/config | base64 -w 0
```

---

## Phase 3 — Staging Deployment (Days 4–5)
**Owner:** DevOps Lead  
**Duration:** 2 days  
**Goal:** All 8 services running and passing health checks on staging Kubernetes.

### Step 3.1 — Build & Push Docker Images

Trigger the Docker workflow manually (or push a commit to the branch):

```bash
# Via GitHub CLI
gh workflow run forgepay-docker.yml \
  --field service=all \
  -R khayaai/forgepaye

# Alternatively, push a commit to trigger automatic build:
git commit --allow-empty -m "ci: trigger docker build for staging"
git push origin claude/forgepay-platform-design-gEkgE
```

Verify all images are in GHCR:
```bash
# List available images
gh api /orgs/khayaai/packages?package_type=container | jq '.[].name'

# Expected:
# forgepay-unified-router
# forgepay-payment-engine
# forgepay-mor-layer
# forgepay-billing-engine
# forgepay-stablecoin-gateway
# forgepay-crypto-gateway
# forgepay-web
# forgepay-dashboard
```

### Step 3.2 — Create Helm Values Override for Staging

```bash
cat > forgepay/infra/helm/forgepay-stack/values-staging.yaml << 'EOF'
# Staging-specific overrides — references real K8s secret names

global:
  imageRegistry: "ghcr.io/khayaai"
  imagePullSecrets:
    - name: ghcr-pull-secret
  postgresql:
    host: "<RDS_ENDPOINT>"          # from terraform output rds_endpoint
    port: 5432
    database: forgepay
    existingSecret: forgepay-core-secrets
    secretKeys:
      password: POSTGRES_PASSWORD
  redis:
    url: "redis://<REDIS_ENDPOINT>:6379"    # from terraform output redis_endpoint
  otel:
    endpoint: "http://otel-collector:4317"
    enabled: true

# Replicas reduced for staging
paymentEngine:
  replicaCount: 1
  image:
    repository: ghcr.io/khayaai/forgepay-payment-engine
    tag: "latest"

unifiedRouter:
  replicaCount: 1
  image:
    repository: ghcr.io/khayaai/forgepay-unified-router
    tag: "latest"
  env:
    existingSecret: forgepay-core-secrets
    secretKey: INTERNAL_WEBHOOK_SECRET

morLayer:
  replicaCount: 1
  image:
    repository: ghcr.io/khayaai/forgepay-mor-layer
    tag: "latest"

billingEngine:
  replicaCount: 1
  image:
    repository: ghcr.io/khayaai/forgepay-billing-engine
    tag: "latest"

stablecoinGateway:
  replicaCount: 1
  image:
    repository: ghcr.io/khayaai/forgepay-stablecoin-gateway
    tag: "latest"

cryptoGateway:
  replicaCount: 1
  image:
    repository: ghcr.io/khayaai/forgepay-crypto-gateway
    tag: "latest"

# Accounts service (Phase 2 preview — enabled in staging)
accountsService:
  replicaCount: 1
  image:
    repository: ghcr.io/khayaai/forgepay-accounts-service
    tag: "latest"

# Chain sync disabled — contracts not deployed yet
chainSync:
  enabled: false

# Forge Agent disabled for MVP
forgeAgent:
  enabled: false
  billingEnabled: false

# Use AWS RDS, not in-cluster PostgreSQL
postgresql:
  enabled: false   # BYO via RDS

# Use AWS ElastiCache, not in-cluster Redis
redis:
  enabled: false   # BYO via ElastiCache

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-staging
    nginx.ingress.kubernetes.io/proxy-body-size: "16k"
  hosts:
    - host: api.staging.forgepay.io
      paths:
        - { path: /, pathType: Prefix, service: payment-engine, port: 8080 }
    - host: hooks.staging.forgepay.io
      paths:
        - { path: /, pathType: Prefix, service: unified-router, port: 8000 }
    - host: staging.forgepay.io
      paths:
        - { path: /, pathType: Prefix, service: web, port: 3000 }
    - host: dashboard.staging.forgepay.io
      paths:
        - { path: /, pathType: Prefix, service: dashboard, port: 3001 }
  tls:
    - secretName: forgepay-staging-tls
      hosts:
        - api.staging.forgepay.io
        - hooks.staging.forgepay.io
        - staging.forgepay.io
        - dashboard.staging.forgepay.io
EOF
```

### Step 3.3 — Create GHCR Image Pull Secret

```bash
kubectl create namespace forgepay-staging

kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username=<github_username> \
  --docker-password=<github_pat_with_read_packages> \
  --docker-email=devops@forgepay.io \
  -n forgepay-staging
```

### Step 3.4 — Apply Database Migrations

```bash
# Apply all 6 SQL migrations to staging RDS
for migration in forgepay/infra/k8s/migrations/*.sql; do
  echo "Applying $migration..."
  psql "postgresql://forgepay:${DB_PASSWORD}@${RDS_ENDPOINT}:5432/forgepay" \
    -f "$migration"
done

# Apply MoR Layer Alembic migrations
kubectl run alembic-migrate \
  --image=ghcr.io/khayaai/forgepay-mor-layer:latest \
  --restart=Never \
  --env="DATABASE_URL=postgresql+asyncpg://forgepay:${DB_PASSWORD}@${RDS_ENDPOINT}:5432/forgepay" \
  --command -- alembic upgrade head \
  -n forgepay-staging

kubectl wait --for=condition=complete job/alembic-migrate -n forgepay-staging --timeout=120s
kubectl delete pod alembic-migrate -n forgepay-staging
```

### Step 3.5 — Deploy Helm Stack

```bash
# Update Helm dependencies
cd forgepay/infra/helm/forgepay-stack
helm dependency update

# Dry run first — catch YAML errors before applying
helm upgrade --install forgepay-staging . \
  --namespace forgepay-staging \
  --values values-staging.yaml \
  --dry-run --debug 2>&1 | head -100

# Deploy for real
helm upgrade --install forgepay-staging . \
  --namespace forgepay-staging \
  --values values-staging.yaml \
  --atomic \
  --timeout 15m \
  --wait

cd -
```

**Expected duration:** 5-10 minutes for all pods to reach Running.

### Step 3.6 — Verify All Pods Are Running

```bash
watch kubectl get pods -n forgepay-staging
```

**Expected output (all READY 1/1 or 2/2):**

```
NAME                                           READY   STATUS    RESTARTS
forgepay-staging-payment-engine-xxx            1/1     Running   0
forgepay-staging-unified-router-xxx            1/1     Running   0
forgepay-staging-mor-layer-xxx                 1/1     Running   0
forgepay-staging-billing-engine-xxx            1/1     Running   0
forgepay-staging-stablecoin-gateway-xxx        1/1     Running   0
forgepay-staging-crypto-gateway-xxx            1/1     Running   0
forgepay-staging-accounts-service-xxx          1/1     Running   0
```

### Step 3.7 — Staging Health Check

```bash
# Port-forward for quick validation before DNS is set
kubectl port-forward svc/forgepay-staging-unified-router 8000:8000 -n forgepay-staging &
kubectl port-forward svc/forgepay-staging-mor-layer 8010:8010 -n forgepay-staging &
kubectl port-forward svc/forgepay-staging-crypto-gateway 8030:8030 -n forgepay-staging &

# Health checks
curl -sf http://localhost:8000/healthz | jq .
curl -sf http://localhost:8010/health  | jq .
curl -sf http://localhost:8030/healthz | jq .

# Readiness checks (these call the DB)
curl -sf http://localhost:8000/readyz | jq .
curl -sf http://localhost:8030/readyz | jq .

# Stop port-forwards
kill %1 %2 %3
```

---

## Phase 4 — DNS, TLS, and CDN (Day 5)
**Owner:** DevOps / Networking  
**Duration:** 2-4 hours  
**Goal:** All staging URLs are live with valid TLS certificates.

### Step 4.1 — Get the ALB Hostname

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

### Step 4.2 — Configure DNS (Route53)

```bash
# Get the ALB hostname from above, then:
aws route53 change-resource-record-sets \
  --hosted-zone-id <YOUR_ZONE_ID> \
  --change-batch '{
    "Changes": [
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "api.staging.forgepay.io",
          "Type": "CNAME",
          "TTL": 300,
          "ResourceRecords": [{"Value": "<ALB_HOSTNAME>"}]
        }
      },
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "hooks.staging.forgepay.io",
          "Type": "CNAME",
          "TTL": 300,
          "ResourceRecords": [{"Value": "<ALB_HOSTNAME>"}]
        }
      },
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "staging.forgepay.io",
          "Type": "CNAME",
          "TTL": 300,
          "ResourceRecords": [{"Value": "<ALB_HOSTNAME>"}]
        }
      },
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "dashboard.staging.forgepay.io",
          "Type": "CNAME",
          "TTL": 300,
          "ResourceRecords": [{"Value": "<ALB_HOSTNAME>"}]
        }
      }
    ]
  }'
```

### Step 4.3 — Configure cert-manager ClusterIssuer

```bash
kubectl apply -f - << 'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: devops@forgepay.io
    privateKeySecretRef:
      name: letsencrypt-staging-key
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
```

### Step 4.4 — Verify TLS Certificates

```bash
# Wait for certificate to be issued (2-5 minutes after DNS propagates)
kubectl get certificate -n forgepay-staging -w

# Expected: READY=True
# NAME                    READY   SECRET                  AGE
# forgepay-staging-tls    True    forgepay-staging-tls    3m

# Test HTTPS
curl -sv https://api.staging.forgepay.io/healthz
```

---

## Phase 5 — Observability Setup (Day 6)
**Owner:** DevOps / SRE  
**Duration:** 3-4 hours  
**Goal:** Prometheus, Grafana, Jaeger, and all alerts deployed and working.

### Step 5.1 — Deploy Monitoring Stack

```bash
helm upgrade --install forgepay-monitoring \
  forgepay/infra/observability/helm/forgepay-monitoring/ \
  --namespace monitoring \
  --create-namespace \
  --values forgepay/infra/observability/helm/forgepay-monitoring/values.yaml \
  --set grafana.adminPassword="$(openssl rand -base64 16)" \
  --wait
```

### Step 5.2 — Apply Alert Rules

```bash
kubectl apply -f forgepay/infra/observability/alerts/ -n forgepay-staging
kubectl apply -f forgepay/infra/observability/prometheus/rules/ -n forgepay-staging
```

**Active SLO Alerts:**

| Alert | Threshold | Severity |
|-------|-----------|----------|
| `PaymentSuccessRateLow` | < 99.5% over 5 min | critical |
| `CheckoutLatencyHigh` | P99 > 3s | warning |
| `WebhookDeliveryFailureHigh` | > 5% over 10 min | warning |
| `StablecoinDepositConfirmationStall` | > 50 pending, 0 confirmed/30 min | critical |
| `DatabaseConnectionPoolExhausted` | > 5 waiting connections | warning |
| `ServiceDown` | any service `up == 0` for 1 min | critical |

### Step 5.3 — Configure Alert Routing to Slack

```bash
# Add Alertmanager config pointing to your Slack webhook
kubectl apply -f - << 'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: alertmanager-config
  namespace: monitoring
data:
  alertmanager.yml: |
    global:
      slack_api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
    route:
      receiver: 'slack-critical'
      group_by: ['alertname', 'severity']
      group_wait: 30s
      group_interval: 5m
      repeat_interval: 3h
      routes:
        - receiver: slack-critical
          match:
            severity: critical
        - receiver: slack-warning
          match:
            severity: warning
    receivers:
      - name: slack-critical
        slack_configs:
          - channel: '#forgepay-incidents'
            title: '{{ .GroupLabels.alertname }}'
            text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
            send_resolved: true
      - name: slack-warning
        slack_configs:
          - channel: '#forgepay-ops'
            title: '{{ .GroupLabels.alertname }}'
            text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
EOF
```

### Step 5.4 — Verify Dashboards

```bash
# Port-forward Grafana
kubectl port-forward svc/forgepay-monitoring-grafana 3001:80 -n monitoring

# Open http://localhost:3001
# Login: admin / <password from step 5.1>
# Import dashboards:
# - forgepay/infra/observability/grafana/provisioning/dashboards/
```

---

## Phase 6 — Load Testing & Baseline (Day 7)
**Owner:** QA / DevOps  
**Duration:** 4-6 hours  
**Goal:** Validate that the staging cluster meets SLO thresholds under expected load.

### Step 6.1 — Install k6

```bash
# macOS
brew install k6

# Linux
sudo apt-get install k6
```

### Step 6.2 — Run Load Tests Against Staging

```bash
export BASE_URL=https://api.staging.forgepay.io

# Card checkout (primary flow)
cd forgepay/infra/load-tests
k6 run checkout-load-test.js \
  -e BASE_URL=$BASE_URL \
  --out json=results/checkout-baseline.json

# Stablecoin gateway
k6 run stablecoin-load-test.js \
  -e BASE_URL=https://hooks.staging.forgepay.io \
  --out json=results/stablecoin-baseline.json

# Crypto gateway
k6 run crypto-load-test.js \
  -e BASE_URL=https://hooks.staging.forgepay.io \
  --out json=results/crypto-baseline.json
```

**SLO Pass Criteria:**

| Test | VUs | Duration | P95 Target | Error Target |
|------|-----|----------|-----------|--------------|
| checkout | 100 | 5 min | < 500ms | < 0.5% |
| stablecoin | 30 | 5 min | < 1000ms | < 0.5% |
| crypto | 20 | 5 min | < 800ms | < 1.0% |

### Step 6.3 — Capture Baseline

```bash
# Save as canonical baseline for regression detection in CI
bash forgepay/infra/load-tests/capture-baseline.sh

# Verify baseline file was saved
cat forgepay/infra/load-tests/results/baseline.json | jq '.metrics.http_req_duration.values'
```

**Do not proceed to production if any threshold fails.** Debug, fix, re-run.

---

## Phase 7 — CI/CD Wire-Up (Day 7)
**Owner:** DevOps Lead  
**Duration:** 2-3 hours  
**Goal:** Every push to `main` auto-deploys to staging; prod requires manual approval.

### Step 7.1 — Verify GitHub Secrets Are Set

```bash
gh secret list -e staging -R khayaai/forgepaye
gh secret list -e production -R khayaai/forgepaye

# Required secrets:
# staging:    STAGING_KUBECONFIG, STAGING_API_URL, SLACK_WEBHOOK_URL
# production: PROD_KUBECONFIG, SLACK_WEBHOOK_URL
```

### Step 7.2 — Test the CI/CD Pipeline

```bash
# Push a no-op commit to trigger the full pipeline
git commit --allow-empty -m "ci: validate staging pipeline"
git push origin claude/forgepay-platform-design-gEkgE

# Monitor at:
# https://github.com/khayaai/forgepaye/actions
```

**Pipeline flow:**
1. `forgepay-ci.yml` → lint + type-check + test (all services)
2. `forgepay-docker.yml` → build + push Docker images to GHCR
3. `forgepay-deploy.yml` → Helm upgrade on staging cluster
4. Smoke tests → kubectl rollout status + /healthz check

**Total pipeline time: ~15 minutes.**

### Step 7.3 — Protect the `main` Branch

```bash
gh api repos/khayaai/forgepaye/branches/main/protection -X PUT \
  -f required_status_checks='{"strict":true,"contexts":["unified-router — lint + type-check + test","mor-layer — lint + type-check + test","web — type-check + build","dashboard — type-check + build","sdk-js — type-check + test + build"]}' \
  -f enforce_admins=true \
  -f required_pull_request_reviews='{"required_approving_review_count":1}' \
  -f restrictions=null
```

---

## Phase 8 — Production Deployment (Days 10–14)
**Owner:** DevOps Lead + Engineering Lead  
**Duration:** 3-4 days  
**Gate:** All staging tests green for 48 consecutive hours, load test baseline met.

### Step 8.1 — Provision Production Infrastructure

```bash
cat > forgepay/infra/terraform/prod.tfvars << 'EOF'
aws_region  = "us-east-1"
environment = "production"

vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]

kubernetes_version      = "1.29"
eks_node_instance_types = ["m6i.xlarge"]
eks_node_desired_size   = 5
eks_node_min_size       = 3
eks_node_max_size       = 20

db_instance_class        = "db.r6i.xlarge"
db_allocated_storage     = 200
db_backup_retention_days = 30
db_multi_az              = true     # REQUIRED for production

redis_node_type          = "cache.r6g.large"
redis_num_nodes          = 2
redis_automatic_failover = true    # REQUIRED for production

vault_namespace = "forgepay"
vault_addr      = "https://vault.example.com"

log_retention_days = 90
alert_email        = "oncall@forgepay.io"

acm_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/PROD_CERT_ID"
cloudfront_allowed_origins = ["https://forgepay.io", "https://www.forgepay.io"]
EOF

export TF_VAR_db_password="$(openssl rand -base64 40)"

terraform apply -var-file=prod.tfvars
```

### Step 8.2 — Replicate Secrets to Production Vault

```bash
export VAULT_ADDR=https://vault.example.com   # prod vault

bash forgepay/infra/vault/setup-forgepay.sh prod

# Populate production secrets
# IMPORTANT: Use DIFFERENT values from staging for all secrets
vault kv put forgepay/prod/payment-engine/api_key \
  value="<YOUR_PRODUCTION_HYPERSWITCH_API_KEY>"

vault kv put forgepay/prod/webhook/signing_secret \
  value="$(openssl rand -hex 32)"

vault kv put forgepay/prod/crypto-gateway/hd_wallet_seed \
  value="$(openssl rand -hex 64)"
# ... (all other secrets)
```

### Step 8.3 — Production Values Override

```bash
cat > forgepay/infra/helm/forgepay-stack/values-prod.yaml << 'EOF'
global:
  imageRegistry: "ghcr.io/khayaai"
  postgresql:
    host: "<PROD_RDS_ENDPOINT>"
    existingSecret: forgepay-core-secrets
  redis:
    url: "redis://<PROD_REDIS_ENDPOINT>:6379"

paymentEngine:
  replicaCount: 2
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 20

unifiedRouter:
  replicaCount: 2
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10

morLayer:
  replicaCount: 2
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10

billingEngine:
  replicaCount: 1   # stateful — do not auto-scale

stablecoinGateway:
  replicaCount: 2

cryptoGateway:
  replicaCount: 2

chainSync:
  enabled: false    # Enable after contract deployment (Phase 2)

forgeAgent:
  enabled: false    # Enable at Forge Agent launch

postgresql:
  enabled: false    # BYO via RDS

redis:
  enabled: false    # BYO via ElastiCache

ingress:
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: api.forgepay.io
      paths:
        - { path: /, pathType: Prefix, service: payment-engine, port: 8080 }
    - host: hooks.forgepay.io
      paths:
        - { path: /, pathType: Prefix, service: unified-router, port: 8000 }
    - host: forgepay.io
      paths:
        - { path: /, pathType: Prefix, service: web, port: 3000 }
    - host: dashboard.forgepay.io
      paths:
        - { path: /, pathType: Prefix, service: dashboard, port: 3001 }
  tls:
    - secretName: forgepay-prod-tls
      hosts: [api.forgepay.io, hooks.forgepay.io, forgepay.io, dashboard.forgepay.io]
EOF
```

### Step 8.4 — Production Deploy (Blue-Green via Helm)

```bash
# Deploy to production via GitHub Actions workflow_dispatch
# This requires the 'production' environment approval gate

gh workflow run forgepay-deploy.yml \
  --field environment=production \
  --field image_tag="sha-$(git rev-parse --short HEAD)" \
  -R khayaai/forgepaye

# Monitor the deployment at:
# https://github.com/khayaai/forgepaye/actions
```

**Production deployment requires a human approval in the GitHub `production` environment before the workflow proceeds.**

### Step 8.5 — Production Smoke Tests

```bash
# Wait for all pods to be Ready
kubectl get pods -n forgepay --watch

# Health checks on real domain
curl -sf https://api.forgepay.io/healthz | jq .
curl -sf https://hooks.forgepay.io/healthz | jq .

# Test payment endpoint (test mode)
curl -sf -X POST https://api.forgepay.io/payments \
  -H "Content-Type: application/json" \
  -H "api-key: YOUR_TEST_API_KEY" \
  -d '{"amount":100,"currency":"USD","customer_id":"cus_smoke_001","idempotency_key":"prod_smoke_001"}' | jq .

# Verify event is flowing through unified-router
curl -sf "https://hooks.forgepay.io/events?limit=5" \
  -H "Authorization: Bearer YOUR_TEST_API_KEY" | jq '.events[0]'
```

---

## Phase 9 — Rollback Procedures
**Owner:** Any on-call engineer  

### Scenario A: Pod Crash Loop

```bash
# Check logs
kubectl logs -n forgepay deployment/forgepay-unified-router --tail=100

# If config issue → rollback Helm
helm rollback forgepay 1 -n forgepay --wait

# If code issue → deploy known-good image tag
helm upgrade forgepay forgepay/infra/helm/forgepay-stack \
  --namespace forgepay \
  --values forgepay/infra/helm/forgepay-stack/values-prod.yaml \
  --set unifiedRouter.image.tag=sha-<LAST_GOOD_SHA> \
  --atomic --wait
```

### Scenario B: Database Connection Failure

```bash
# Check RDS status in AWS console first
aws rds describe-db-instances \
  --db-instance-identifier forgepay-production \
  --query 'DBInstances[0].DBInstanceStatus'

# If RDS is fine, check K8s secret
kubectl get secret forgepay-core-secrets -n forgepay -o yaml | grep POSTGRES

# If secret is wrong → refresh via External Secrets
kubectl annotate externalsecret forgepay-core-secrets \
  force-sync="$(date +%s)" -n forgepay
```

### Scenario C: High Payment Error Rate (> 1%)

```bash
# 1. Check alert in Grafana
# 2. Check payment-engine logs
kubectl logs -n forgepay deployment/forgepay-payment-engine --tail=200 | grep ERROR

# 3. If processor down → check Hyperswitch processor health
curl -sf https://api.forgepay.io/health/processors | jq .

# 4. If all processors down → switch to fallback or maintenance mode
helm upgrade forgepay forgepay/infra/helm/forgepay-stack \
  --namespace forgepay \
  --set paymentEngine.maintenanceMode=true \
  --reuse-values
```

### Scenario D: Webhook Delivery Failure (> 5%)

```bash
# Check unified-router queue depth
kubectl exec -n forgepay deployment/forgepay-unified-router \
  -- redis-cli -u $REDIS_URL llen webhook_queue

# Check dead-letter queue
kubectl exec -n forgepay deployment/forgepay-unified-router \
  -- redis-cli -u $REDIS_URL llen webhook_dead_letter

# If queue is backed up → scale up unified-router
kubectl scale deployment/forgepay-unified-router --replicas=5 -n forgepay

# Drain dead-letter queue after fixing root cause
kubectl exec -n forgepay deployment/forgepay-unified-router \
  -- node dist/scripts/retry-dead-letter.js
```

---

## Phase 10 — Day 1 Launch Operations Checklist
**Owner:** Entire DevOps team  
**Time:** Morning of launch day

### T-2 Hours
- [ ] All services healthy (`kubectl get pods -n forgepay`)
- [ ] Grafana dashboards loading with live data
- [ ] Prometheus alerts firing correctly (test with a manual bad-health pod)
- [ ] On-call rotation active in PagerDuty
- [ ] Slack `#forgepay-incidents` channel created
- [ ] Final database backup complete
- [ ] Rollback SHA documented (last stable commit)

### T-0 Hours (Launch Window)
- [ ] Run staging load test one final time (baseline regression check)
- [ ] Verify DNS TTLs are set to 300s (5 minutes) for fast rollback
- [ ] Get Engineering Lead + CTO sign-off in Slack thread
- [ ] Merge `claude/forgepay-platform-design-gEkgE` → `main`
- [ ] Monitor GitHub Actions pipeline completion
- [ ] Verify production pods roll over without CrashLoops

### T+30 Minutes
- [ ] Payment success rate ≥ 99.5% in Grafana
- [ ] P99 checkout latency < 3s in Grafana
- [ ] Webhook delivery success ≥ 95% in Grafana
- [ ] Zero active `critical` alerts
- [ ] Marketing team given green light to post announcements

### T+2 Hours
- [ ] First 5 beta merchants manually onboarded
- [ ] Test a real $1.00 payment per environment
- [ ] Confirm Stripe webhook forwarding (for hybrid merchants) works
- [ ] Document any anomalies in `#forgepay-ops`

---

## Reference — Service Port Map

| Service | Internal Port | K8s Service | External |
|---------|--------------|-------------|----------|
| payment-engine | 8080 | `forgepay-payment-engine` | `api.forgepay.io` |
| unified-router | 8000 | `forgepay-unified-router` | `hooks.forgepay.io` |
| mor-layer | 8010 | `forgepay-mor-layer` | internal only |
| billing-engine | 8020 | `forgepay-billing-engine` | internal only |
| stablecoin-gateway | 8030 | `forgepay-stablecoin-gateway` | internal only |
| crypto-gateway | 8040 | `forgepay-crypto-gateway` | internal only |
| accounts-service | 8050 | `forgepay-accounts-service` | internal only |
| web (marketing) | 3000 | `forgepay-web` | `forgepay.io` |
| dashboard | 3001 | `forgepay-dashboard` | `dashboard.forgepay.io` |

## Reference — Environment Variables Required Per Service

| Service | Key Variables |
|---------|--------------|
| All services | `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `REDIS_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT` |
| unified-router | `INTERNAL_WEBHOOK_SECRET`, `HYPERSWITCH_WEBHOOK_SECRET`, `KILLBILL_WEBHOOK_SECRET` |
| payment-engine | `HYPERSWITCH_API_KEY`, `VAULT_URL`, `VAULT_TOKEN` |
| mor-layer | `MOR_HYPERSWITCH_API_KEY`, `MOR_INTERNAL_WEBHOOK_SECRET` |
| billing-engine | `KILLBILL_DB_URL`, `KILLBILL_WEBHOOK_SECRET` |
| stablecoin-gateway | `PRIVATE_KEY_ENCRYPTION_KEY`, `UNIFIED_ROUTER_URL` |
| crypto-gateway | `HD_WALLET_SEED`, `UNIFIED_ROUTER_URL` |
| accounts-service | `CIRCLE_API_KEY`, `KMS_KEY_ARN` |

## Reference — Key Files

| File | Purpose |
|------|---------|
| `forgepay/infra/helm/forgepay-stack/Chart.yaml` | Umbrella chart with all service dependencies |
| `forgepay/infra/helm/forgepay-stack/values.yaml` | Default values — override per environment |
| `forgepay/infra/helm/forgepay-stack/values-prod.yaml` | Production overrides (BYO DB/Redis, HA replicas) |
| `forgepay/infra/terraform/main.tf` | AWS infra: EKS, RDS, Redis, Vault, S3, CloudFront |
| `forgepay/infra/terraform/variables.tf` | All tunable vars |
| `forgepay/infra/k8s/docker-compose.dev.yml` | Local dev stack (all services + observability) |
| `forgepay/infra/k8s/migrations/*.sql` | Database migrations (apply before first deploy) |
| `forgepay/infra/load-tests/run-load-tests.sh` | Run all K6 load tests |
| `forgepay/infra/observability/alerts/payment-alerts.yaml` | SLO alert rules |
| `forgepay/infra/vault/setup-forgepay.sh` | Vault initialization for dev/staging/prod |
| `forgepay/config/environments/staging.yaml` | Staging service configuration |
| `forgepay/config/environments/prod.example.yaml` | Production config template |
| `forgepay/config/SECRETS_MANAGEMENT.md` | Secrets rotation procedures |
| `.github/workflows/forgepay-ci.yml` | CI: lint + test all services |
| `.github/workflows/forgepay-docker.yml` | CI: Docker build + GHCR push |
| `.github/workflows/forgepay-deploy.yml` | CD: Helm deploy to staging/prod |

---

## Escalation Matrix

| Severity | Definition | Response Time | Owner | Channel |
|----------|-----------|--------------|-------|---------|
| P0 — Critical | Payments down, data breach | 15 minutes | On-call engineer | `#forgepay-incidents` + PagerDuty |
| P1 — High | >1% payment error rate, service degraded | 30 minutes | On-call engineer | `#forgepay-incidents` |
| P2 — Medium | Single service degraded, latency spike | 2 hours | Primary engineer | `#forgepay-ops` |
| P3 — Low | Non-critical feature broken, warning alert | Next business day | Any engineer | GitHub Issues |

---

*Questions? Slack `#forgepay-devops` or open an issue at github.com/khayaai/forgepaye/issues*
