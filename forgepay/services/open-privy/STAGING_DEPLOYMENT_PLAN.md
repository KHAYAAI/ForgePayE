# OpenPrivy Staging Deployment & Validation Plan

## Overview
This document outlines the complete staging deployment process for OpenPrivy, validating all production systems are ready for launch.

**Timeline**: 2-3 days
**Target**: 99.5% uptime, 1000+ RPS, <500ms P95 latency, <5% error rate

---

## Phase 1: Pre-Deployment Validation (Day 1)

### 1.1 Infrastructure Readiness
- [ ] Staging Kubernetes cluster provisioned and accessible
  - Cluster version: 1.28+ (for security policies)
  - Node count: Minimum 3 nodes (for pod anti-affinity)
  - Network policies enabled
  - RBAC properly configured
- [ ] Container registry access verified (GCR, ECR, or equivalent)
  - Authentication configured for docker push
  - Namespaced repositories created for staging
- [ ] Database backup/restore procedures tested
  - Staging PostgreSQL instance prepared
  - Backup jobs configured and tested
- [ ] Load balancer/ingress controller installed and configured

### 1.2 Secrets & Configuration
- [ ] Create backend secrets in Kubernetes
  ```bash
  kubectl create secret generic backend-secrets \
    --from-literal=DATABASE_URL="postgresql://..." \
    --from-literal=REDIS_URL="redis://..." \
    --from-literal=JWT_SECRET="$(openssl rand -base64 32)" \
    --from-literal=ENCRYPTION_KEY="$(openssl rand -c 32)" \
    --from-literal=ETHEREUM_RPC_MAINNET="https://..." \
    --from-literal=POLYGON_RPC_URL="https://..." \
    --from-literal=PIMLICO_API_KEY="..." \
    -n openprivy-staging
  ```
- [ ] Configure ConfigMap for environment variables
  ```bash
  kubectl create configmap backend-config \
    --from-literal=LOG_LEVEL=info \
    --from-literal=CORS_ORIGINS="https://staging.openprivy.io" \
    -n openprivy-staging
  ```
- [ ] Verify all required RPC endpoints and API keys are set
- [ ] Staging database credentials are different from production

### 1.3 Code Validation
- [ ] Run full test suite
  ```bash
  npm run test           # Unit tests
  npm run test:integration  # Integration tests
  ```
- [ ] Contract tests pass
  ```bash
  cd services/contracts && npm run test
  ```
- [ ] No console.log statements in production code
- [ ] Security review checklist passed:
  - [ ] SQL injection prevented (parameterized queries)
  - [ ] XSS prevented (output encoding)
  - [ ] CSRF tokens validated
  - [ ] Rate limiting enabled
  - [ ] Input validation on all endpoints
  - [ ] Secrets not exposed in logs

---

## Phase 2: Container Build & Push (Day 1)

### 2.1 Build Docker Image
```bash
#!/bin/bash
REGISTRY="gcr.io/openprivy"
IMAGE_TAG="staging-$(date +%Y%m%d-%H%M%S)"

docker build \
  -t "${REGISTRY}/backend:${IMAGE_TAG}" \
  -t "${REGISTRY}/backend:staging-latest" \
  -f services/backend/Dockerfile \
  .

# Security scanning
docker scout cves "${REGISTRY}/backend:${IMAGE_TAG}"
```

### 2.2 Push to Registry
```bash
# Authenticate with registry
gcloud auth configure-docker

# Push images
docker push "${REGISTRY}/backend:${IMAGE_TAG}"
docker push "${REGISTRY}/backend:staging-latest"

# Verify push
docker pull "${REGISTRY}/backend:${IMAGE_TAG}" --quiet
```

### 2.3 Image Validation
- [ ] Image vulnerability scan completed
- [ ] Image size reasonable (<200MB)
- [ ] Base image (node:20-alpine) is up to date
- [ ] No hardcoded secrets in image
- [ ] Image runs as non-root user (UID 1000)

---

## Phase 3: Kubernetes Deployment (Day 1)

### 3.1 Deploy Infrastructure
Run the staging deployment script:
```bash
./scripts/deploy-staging.sh
```

This will:
1. Switch to staging Kubernetes context
2. Create/update namespace
3. Deploy PostgreSQL
4. Deploy Redis
5. Deploy Prometheus for monitoring
6. Deploy backend application
7. Run database migrations
8. Execute smoke tests

### 3.2 Verify Deployment
- [ ] Namespace created: `kubectl get namespace openprivy-staging`
- [ ] PostgreSQL pod running: `kubectl get pods -l app=postgres -n openprivy-staging`
- [ ] Redis pod running: `kubectl get pods -l app=redis -n openprivy-staging`
- [ ] Backend pods running: `kubectl get deployment backend -n openprivy-staging`
  - All replicas ready (3/3)
  - No crashes or restarts
- [ ] Service created: `kubectl get svc backend -n openprivy-staging`
- [ ] Prometheus scraping metrics: Visit Prometheus UI at http://prometheus.openprivy-staging.svc.cluster.local:9090

### 3.3 Check Pod Health
```bash
# Get pod details
kubectl get pods -n openprivy-staging -o wide

# Check logs for errors
kubectl logs -n openprivy-staging -l app=backend --tail=50

# Check resource usage
kubectl top pods -n openprivy-staging
```

---

## Phase 4: Database Setup (Day 1-2)

### 4.1 Run Migrations
```bash
# Identify backend pod
POD=$(kubectl get pods -n openprivy-staging -l app=backend -o jsonpath='{.items[0].metadata.name}')

# Run migrations
kubectl exec -n openprivy-staging "$POD" -- npm run migrate:prod
```

### 4.2 Seed Test Data
```bash
kubectl exec -n openprivy-staging "$POD" -- npm run seed:staging
```

### 4.3 Verify Database State
```bash
# Connect to PostgreSQL
kubectl exec -it -n openprivy-staging postgres-0 -- psql -U openprivy

# Check tables exist
\dt

# Verify data
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM wallets;
```

---

## Phase 5: Smoke Tests (Day 2)

### 5.1 Basic Health Checks
```bash
SERVICE_IP=$(kubectl get svc backend -n openprivy-staging -o jsonpath='{.status.loadBalancer.ingress[0].ip}' || echo "localhost:3001")

# Health check endpoint
curl -s "http://${SERVICE_IP}/health" | jq .

# Metrics endpoint
curl -s "http://${SERVICE_IP}/metrics" | head -20
```

### 5.2 API Smoke Tests
```bash
# Set environment
export BASE_URL="http://${SERVICE_IP}"

# Run smoke tests
npm run test:smoke
```

Expected results:
- [ ] User registration endpoint responds
- [ ] Login endpoint works
- [ ] Wallet creation works
- [ ] Transaction submission works
- [ ] Metrics are collected

### 5.3 Database Connectivity
```bash
# Verify backend can connect to database
kubectl logs -n openprivy-staging -l app=backend | grep -i "connected\|database"
```

---

## Phase 6: Load Testing (Day 2-3)

### 6.1 K6 Load Test Setup
Create `test/load/staging-load.k6.js`:
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export const options = {
  stages: [
    { duration: '2m', target: 100 },    // Ramp up to 100 RPS
    { duration: '5m', target: 500 },    // Ramp up to 500 RPS
    { duration: '5m', target: 1000 },   // Ramp up to 1000 RPS
    { duration: '5m', target: 1000 },   // Stay at 1000 RPS
    { duration: '2m', target: 0 },      // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],  // P95 < 500ms, P99 < 1s
    http_req_failed: ['rate<0.05'],                   // <5% error rate
  },
};

export default function () {
  const params = { headers: { 'Content-Type': 'application/json' } };

  // Health check
  let res = http.get(`${BASE_URL}/health`, params);
  check(res, {
    'health check status': (r) => r.status === 200,
  });

  // API endpoint (replace with actual endpoint)
  res = http.get(`${BASE_URL}/api/wallets`, params);
  check(res, {
    'wallet list status': (r) => r.status === 200,
  });

  sleep(1);
}
```

### 6.2 Execute Load Test
```bash
# Run load test for 20 minutes
k6 run \
  --vus 100 \
  --duration 20m \
  --out csv=results.csv \
  test/load/staging-load.k6.js
```

### 6.3 Validate Results
Expected metrics:
- [ ] P95 latency < 500ms ✓
- [ ] P99 latency < 1000ms ✓
- [ ] Error rate < 5% ✓
- [ ] No pod crashes or restarts ✓
- [ ] CPU utilization < 80% ✓
- [ ] Memory utilization < 80% ✓

```bash
# Monitor during load test
watch -n 5 'kubectl top pods -n openprivy-staging'
```

---

## Phase 7: Monitoring & Alerting (Day 2-3)

### 7.1 Access Prometheus
```bash
kubectl port-forward -n openprivy-staging svc/prometheus 9090:9090
# Visit http://localhost:9090
```

### 7.2 Verify Metrics Collection
Check these metrics in Prometheus:
- [ ] `openprivy_requests_total` - Request count
- [ ] `openprivy_errors_total` - Error count
- [ ] `openprivy_request_duration_seconds_bucket` - Latency histogram
- [ ] `container_memory_usage_bytes{pod=~"backend.*"}` - Memory usage
- [ ] `container_cpu_usage_seconds_total{pod=~"backend.*"}` - CPU usage

Query examples:
```promql
# Current error rate
rate(openprivy_errors_total[5m]) / rate(openprivy_requests_total[5m])

# P95 latency
histogram_quantile(0.95, rate(openprivy_request_duration_seconds_bucket[5m]))

# Availability
1 - (rate(openprivy_errors_total[30m]) / rate(openprivy_requests_total[30m]))
```

### 7.3 Verify Alert Rules
- [ ] Alert rules loaded: `kubectl get PrometheusRule -n openprivy-staging`
- [ ] High error rate alert triggers correctly (simulate error)
- [ ] Pod crash alert works (crash a pod intentionally)
- [ ] High latency alert works (under load test)

---

## Phase 8: E2E Test Suite (Day 3)

### 8.1 Run E2E Tests
```bash
export BASE_URL="http://$(kubectl get svc backend -n openprivy-staging -o jsonpath='{.status.loadBalancer.ingress[0].ip}'):3001"

npm run test:e2e
```

Expected test coverage:
- [ ] User authentication flows
- [ ] Account creation and recovery
- [ ] Wallet operations (create, delete)
- [ ] Multi-chain transactions
- [ ] Gas sponsorship verification
- [ ] DeFi integrations (swap, stake)
- [ ] Error handling and edge cases

### 8.2 Verify API Contract
```bash
# Test all API endpoints are accessible
npm run test:api-contract
```

### 8.3 Security Tests
```bash
# Run security-focused tests
npm run test:security

# Verify:
# - CORS properly configured
# - Rate limits enforced
# - Authentication required on protected endpoints
# - SQL injection prevented
# - XSS prevented
```

---

## Phase 9: Failure Recovery (Day 3)

### 9.1 Pod Crash Simulation
```bash
# Delete a backend pod
kubectl delete pod -n openprivy-staging -l app=backend --limit=1

# Verify:
# - Pod automatically restarted
# - Deployment still healthy
# - No service interruption
# - Restart counter incremented
```

### 9.2 Database Failover
```bash
# Simulate database unavailable
kubectl patch pod postgres-0 -n openprivy-staging --type='merge' -p '{"spec":{"containers":[{"name":"postgres","command":["sleep","999999"]}]}}'

# Verify:
# - Backend pods detect database down
# - Health checks fail appropriately
# - Errors logged correctly
# - Alert triggered

# Restore database
kubectl delete pod postgres-0 -n openprivy-staging
```

### 9.3 Network Partition
```bash
# Simulate network latency
kubectl exec -n openprivy-staging -it backend-XXX -- \
  tc qdisc add dev eth0 root netem delay 500ms loss 10%

# Verify:
# - Requests still processed
# - Error rate increases appropriately
# - Alerts triggered
# - Latency increased

# Cleanup
kubectl exec -n openprivy-staging -it backend-XXX -- \
  tc qdisc del dev eth0 root netem
```

---

## Phase 10: Sign-Off & Production Readiness (Day 3)

### 10.1 Compliance Checklist
- [ ] Security review completed
- [ ] All tests passing
- [ ] Performance benchmarks met
- [ ] Monitoring and alerting verified
- [ ] Runbooks written for all critical alerts
- [ ] Incident response procedures documented
- [ ] Team trained on monitoring dashboard
- [ ] Backup/restore procedures tested

### 10.2 Production Configuration Review
- [ ] All secrets rotated and staging values used
- [ ] Production secrets prepared but not exposed
- [ ] Database backups configured
- [ ] Log aggregation working
- [ ] Error tracking (Sentry, etc.) configured
- [ ] Analytics tracking in place

### 10.3 Final Validation
```bash
# Generate final status report
kubectl get all -n openprivy-staging
kubectl get hpa -n openprivy-staging
kubectl top nodes
kubectl top pods -n openprivy-staging

# Get deployment history
kubectl rollout history deployment/backend -n openprivy-staging

# Verify no pending/crashing pods
kubectl get pods -n openprivy-staging --field-selector=status.phase!=Running
```

### 10.4 Approval Sign-Off
- [ ] Engineering lead: ______________________ Date: _______
- [ ] Security lead: ______________________ Date: _______
- [ ] Operations lead: ______________________ Date: _______

---

## Rollback Procedures

If any phase fails:

### Immediate Rollback
```bash
# If deployment fails
kubectl rollout undo deployment/backend -n openprivy-staging

# If database migration fails
kubectl exec postgres-0 -n openprivy-staging -- psql -c "ROLLBACK;"

# Full stack teardown
kubectl delete all --all -n openprivy-staging
```

### Investigation
```bash
# Check deployment history
kubectl rollout history deployment/backend -n openprivy-staging

# View past events
kubectl describe deployment backend -n openprivy-staging

# Check pod logs
kubectl logs -n openprivy-staging deployment/backend --previous

# Check resource limits
kubectl describe nodes
```

---

## Success Criteria

✓ All 10 phases complete
✓ Performance benchmarks met (1000+ RPS, <500ms P95, <5% errors)
✓ Monitoring and alerting functional
✓ All tests passing
✓ No security issues
✓ Team trained and ready
✓ Runbooks and procedures documented

**Once complete → Proceed to Production Canary Deployment (2-3 days)**

---

## Next Steps: Production Deployment

After successful staging validation:

1. Execute `scripts/deploy-production.sh`
2. Monitor canary stages (1% → 10% → 50% → 100%)
3. Verify metrics at each stage
4. Run production smoke tests
5. Monitor first 48 hours intensively
6. Scale to 100% traffic with confidence

**Production SLA**: 99.5% uptime, <500ms P95 latency, <5% error rate
