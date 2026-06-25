# ForgePay Production Deployment Runbook

**Version**: 1.0  
**Last Updated**: June 25, 2026  
**Audience**: Platform engineers, DevOps team  

This guide provides step-by-step instructions for deploying ForgePay to production.

---

## Pre-Deployment Checklist

**STOP: Complete this checklist before proceeding with deployment.**

- [ ] Go-Live Readiness Checklist completed and signed off (`forgepay/GO_LIVE_CHECKLIST.md`)
- [ ] Load testing baseline captured (`forgepay/load-testing/baseline.json`)
- [ ] All load tests passing: P99 < 2s, error rate < 1%
- [ ] All services built and Docker images pushed to registry
- [ ] Helm values reviewed and finalized for production
- [ ] Database backups recent (< 4 hours old)
- [ ] Redis backups recent (< 4 hours old)
- [ ] Staging deployment successful (all services up, smoke tests pass)
- [ ] Team notified of deployment window
- [ ] Status page ready to update during deployment
- [ ] On-call engineer assigned
- [ ] Rollback plan reviewed with team

**If ANY checkbox is unchecked, STOP and fix the issue before proceeding.**

---

## Deployment Steps

### Phase 1: Pre-Flight Checks (15 minutes)

**Objective**: Verify production environment health and readiness.

#### 1.1 Verify Cluster Health

```bash
# Check Kubernetes cluster
kubectl cluster-info
kubectl get nodes -o wide

# Expected output:
# - All nodes: Ready
# - Node status: NotReady or SchedulingDisabled = STOP, investigate
```

#### 1.2 Verify Database

```bash
# Check PostgreSQL primary
kubectl exec -n forgepay deployment/postgres-primary -- \
  pg_isready -U forgepay

# Check replication status
kubectl exec -n forgepay deployment/postgres-primary -- \
  psql -U forgepay -c "SELECT * FROM pg_stat_replication;"

# Expected output:
# - Primary: accepting connections
# - Replica(s): state = streaming, sync_state = async or sync
# If no replicas, STOP and investigate
```

#### 1.3 Verify Redis

```bash
# Check Redis cluster
kubectl exec -n forgepay deployment/redis-master -- redis-cli cluster info

# Expected output:
# cluster_state: ok
# cluster_slots_assigned: 16384
# If not OK, STOP and investigate
```

#### 1.4 Verify Secrets and ConfigMaps

```bash
# Check all required secrets exist
kubectl get secrets -n forgepay | grep -E "api-key|jwt-secret|db-password"

# Expected output:
# - forgepay-api-keys
# - forgepay-jwt-secrets
# - forgepay-db-password
# If any missing, STOP and create via Vault
```

#### 1.5 Verify Current Deployment

```bash
# Check current Helm release
helm list -n forgepay

# Get current version
helm history forgepay -n forgepay | head -5

# Expected output:
# - Release name: forgepay
# - Status: deployed or superseded
```

### Phase 2: Database Migrations (30 minutes)

**Objective**: Apply pending schema changes safely without downtime.

#### 2.1 Run Pre-Migration Backup

```bash
# Create full database backup
kubectl exec -n forgepay deployment/postgres-primary -- \
  pg_dump -U forgepay -d forgepay_prod \
  | gzip > backup-pre-migration-$(date +%s).sql.gz

# Upload to S3
aws s3 cp backup-pre-migration-*.sql.gz \
  s3://forgepay-backups/pre-migration/
```

#### 2.2 Run Database Migrations

```bash
# Apply pending migrations
kubectl apply -f forgepay/infra/helm/templates/migration-job.yaml

# Wait for migration job to complete
kubectl wait --for=condition=complete job/db-migrate -n forgepay --timeout=600s

# Check migration status
kubectl logs job/db-migrate -n forgepay

# Expected output:
# - All migrations: Applied
# - No errors
# If errors, STOP and investigate (do NOT proceed)
```

#### 2.3 Verify Migration Success

```bash
# Connect to database and verify schema
kubectl exec -n forgepay deployment/postgres-primary -- \
  psql -U forgepay -d forgepay_prod -c \
  "SELECT * FROM schema_migrations ORDER BY id DESC LIMIT 10;"

# Verify no errors in migration logs
kubectl logs job/db-migrate -n forgepay | grep -i "error" | wc -l
# Expected output: 0 errors
```

### Phase 3: Deploy Services (20 minutes)

**Objective**: Update all ForgePay services to new version.

#### 3.1 Create Helm Release (or Upgrade)

```bash
# Set variables
CHART_PATH="forgepay/infra/helm"
NAMESPACE="forgepay"
RELEASE_NAME="forgepay"
VALUES_FILE="forgepay/infra/helm/values-prod.yaml"

# Validate Helm chart
helm lint ${CHART_PATH}

# Expected output:
# - No errors or warnings
```

#### 3.2 Perform Dry-Run

```bash
# Dry-run to preview changes
helm upgrade --install ${RELEASE_NAME} ${CHART_PATH} \
  --namespace ${NAMESPACE} \
  --values ${VALUES_FILE} \
  --dry-run \
  --debug

# Review output for:
# - Correct image versions
# - Correct replica counts
# - Correct resource limits
# If anything looks wrong, STOP and fix
```

#### 3.3 Deploy with Canary Strategy

**Option A: Blue-Green (Recommended for critical changes)**

```bash
# 1. Deploy new version alongside old version
helm upgrade ${RELEASE_NAME} ${CHART_PATH} \
  --namespace ${NAMESPACE} \
  --values ${VALUES_FILE} \
  --values forgepay/infra/helm/values-canary.yaml \
  --set canaryEnabled=true \
  --atomic \
  --timeout 5m

# 2. Wait for new pods to be Ready
kubectl wait --for=condition=Ready pod \
  -l app=unified-router,version=new \
  -n ${NAMESPACE} \
  --timeout=300s

# 3. Monitor metrics for 5 minutes (new version only gets 10% traffic)
echo "Monitoring new version for 5 minutes..."
sleep 300

# 4. Check new version health (should see no 5xx errors)
kubectl logs -n ${NAMESPACE} \
  -l app=unified-router,version=new \
  --all-containers=true | grep "error\|500" | wc -l
# Expected: 0 errors

# 5. If healthy, switch 100% traffic to new version
kubectl patch service forgepay -n ${NAMESPACE} \
  -p '{"spec": {"selector": {"version": "new"}}}'

# 6. Wait for old pods to drain connections
sleep 30

# 7. Remove old pods
kubectl delete pods -n ${NAMESPACE} \
  -l app=unified-router,version=old
```

**Option B: Helm Rollback Atomic (Faster)**

```bash
# Deploy with --atomic flag (auto-rollback if health checks fail)
helm upgrade --install ${RELEASE_NAME} ${CHART_PATH} \
  --namespace ${NAMESPACE} \
  --values ${VALUES_FILE} \
  --atomic \
  --timeout 5m

# This will:
# 1. Roll out new pods
# 2. Wait for readiness probes
# 3. Auto-rollback if any pod fails to become Ready
```

#### 3.4 Verify Rollout

```bash
# Check rollout status for each service
kubectl rollout status deployment/unified-router -n forgepay --timeout=300s
kubectl rollout status deployment/mor-layer -n forgepay --timeout=300s
kubectl rollout status deployment/crypto-gateway -n forgepay --timeout=300s
kubectl rollout status deployment/stablecoin-gateway -n forgepay --timeout=300s
kubectl rollout status deployment/yield-engine -n forgepay --timeout=300s
kubectl rollout status deployment/agent-identity -n forgepay --timeout=300s

# Expected output:
# deployment "unified-router" successfully rolled out

# Check pod status
kubectl get pods -n forgepay -o wide

# Expected output:
# All pods: Running, 1/1 Ready
# If any: Pending, CrashLoopBackOff, ImagePullBackOff = IMMEDIATE ROLLBACK
```

### Phase 4: Post-Deployment Verification (20 minutes)

**Objective**: Verify all services are healthy and traffic is flowing.

#### 4.1 Health Checks

```bash
# Check service health endpoints
for svc in unified-router mor-layer crypto-gateway stablecoin-gateway yield-engine agent-identity; do
  echo "Checking ${svc}..."
  kubectl exec -n forgepay deployment/${svc} -- \
    curl -s http://localhost:8000/health || echo "FAILED"
done

# Expected output:
# All services: 200 OK with {"status": "ok"}
```

#### 4.2 Smoke Tests

Run automated smoke test suite:

```bash
# Deploy and run smoke tests
kubectl apply -f forgepay/infra/helm/templates/smoke-test-job.yaml

# Wait for tests to complete
kubectl wait --for=condition=complete job/smoke-tests -n forgepay --timeout=600s

# Check results
kubectl logs job/smoke-tests -n forgepay

# Expected output:
# ✓ Health check: PASS
# ✓ Unified Router webhook: PASS
# ✓ Mor-layer checkout: PASS
# ✓ Crypto Gateway invoice: PASS
# ✓ Stablecoin Gateway deposit: PASS
# ✓ Yield Engine positions: PASS
# ✓ Agent Identity agents: PASS
# ✓ Payment flow: PASS

# If ANY test fails, IMMEDIATELY ROLLBACK
```

#### 4.3 Monitor Metrics

```bash
# Check current metrics from Prometheus
# (Connect to Prometheus UI: https://prometheus.forgepay.io)

# PromQL queries to check:
# 1. P99 latency per service (should match or improve vs. baseline)
histogram_quantile(0.99, rate(http_req_duration_bucket[5m]))

# 2. Error rate (should be 0–0.1%)
rate(http_requests_failed[5m])

# 3. RPS per service (should be low during smoke test)
rate(http_requests[5m])

# Expected:
# - P99: < 2000ms
# - Error rate: < 0.1%
# - RPS: < 10 (only smoke tests)
```

#### 4.4 End-to-End Payment Flow Test

```bash
# Simulate a complete payment flow
# 1. Create checkout session (mor-layer)
curl -X POST http://forgepay-api.example.com/v1/checkout/sessions \
  -H "Content-Type: application/json" \
  -d '{"line_items": [{"price_data": {"currency": "usd", "unit_amount": 2000}, "quantity": 1}]}'

# Expected output: session_id = sess_xxx

# 2. Process payment (payment-engine)
curl -X POST http://forgepay-api.example.com/v1/payments \
  -H "Content-Type: application/json" \
  -d '{"session_id": "sess_xxx", "source": "card_visa"}'

# Expected output: payment_id = pay_xxx, status = succeeded

# 3. Verify webhook received
# Check unified-router logs for webhook processing
kubectl logs -n forgepay deployment/unified-router | grep "pay_xxx"

# Expected: webhook logged and processed
```

### Phase 5: Monitoring (30 minutes)

**Objective**: Monitor system health for 30 minutes post-deployment.

During this window, watch:

```bash
# Terminal 1: Pod logs (watch for crashes)
kubectl logs -n forgepay -f --all-containers=true \
  -l app in (unified-router,mor-layer,crypto-gateway,stablecoin-gateway,yield-engine,agent-identity)

# Terminal 2: Pod events (watch for restarts)
kubectl get events -n forgepay --sort-by='.lastTimestamp' -w

# Terminal 3: Prometheus dashboard
# Open: https://grafana.forgepay.io
# Check dashboards:
# - ForgePay Services (P99 latency, error rate, RPS)
# - Database (connection count, slow queries)
# - Redis (memory usage, command throughput)
# - Kubernetes (node CPU/memory, pod density)
```

**Success criteria for this phase:**
- No pod restarts (should see 0 restarts in k get pods)
- No error spikes in logs
- P99 latency stable and predictable
- Error rate < 0.5%
- Memory/CPU not trending upward

**If any issue detected**, escalate to L2 and consider rollback.

---

## Rollback Procedure

If issues are discovered post-deployment, **IMMEDIATELY** rollback:

### Immediate Rollback (< 2 minutes)

```bash
# Get previous release number
helm history forgepay -n forgepay

# Sample output:
# REVISION  UPDATED                 STATUS      CHART
# 42        2026-06-25 10:30:00     superseded  forgepay-1.2.0
# 41        2026-06-25 09:00:00     deployed    forgepay-1.1.9

# Rollback to previous release
helm rollback forgepay 41 -n forgepay

# Verify rollback
kubectl rollout status deployment/unified-router -n forgepay
kubectl rollout status deployment/mor-layer -n forgepay
# ... (check all services)

# Expected: all rollout statuses show "successfully rolled out"
```

### Verify Rollback Success

```bash
# Check pod status
kubectl get pods -n forgepay

# Expected: all pods Running

# Verify health endpoints
for svc in unified-router mor-layer crypto-gateway stablecoin-gateway yield-engine agent-identity; do
  curl -s http://${svc}.forgepay.svc.cluster.local:8000/health
done

# Expected: all return 200

# Run smoke tests again
kubectl apply -f forgepay/infra/helm/templates/smoke-test-job.yaml
kubectl wait --for=condition=complete job/smoke-tests -n forgepay --timeout=600s
kubectl logs job/smoke-tests -n forgepay
```

### Post-Rollback

1. **Notify stakeholders**: "Rollback completed, system recovered"
2. **Update status page**: "Incident resolved"
3. **Preserve logs**: `kubectl logs ... > incident-logs.txt`
4. **Schedule post-mortem**: Root cause analysis within 24 hours
5. **Do NOT retry deployment** until root cause is identified and fixed

---

## Troubleshooting

### Pod Stuck in CrashLoopBackOff

```bash
# Check pod logs
kubectl logs -n forgepay <pod-name> --previous

# Common causes:
# - Database connection failure
# - Memory leak
# - Startup script error

# Check resource limits
kubectl describe pod -n forgepay <pod-name>

# If memory limit too low:
# 1. Increase limit in values.yaml
# 2. Re-deploy
# 3. Re-test
```

### High Error Rate Post-Deployment

```bash
# Check application logs for errors
kubectl logs -n forgepay deployment/unified-router | grep -i "error" | head -20

# Check database connection pool
kubectl exec -n forgepay deployment/postgres-primary -- \
  psql -U forgepay -c "SELECT * FROM pg_stat_activity;"

# If connection pool exhausted (> max_connections):
# 1. Check which service has too many connections
# 2. Reduce pool size or increase Postgres max_connections
# 3. If temporary, wait 5 minutes for idle connections to close

# Check Redis
kubectl exec -n forgepay deployment/redis-master -- redis-cli info stats
```

### Slow Queries / High P99 Latency

```bash
# Check slow query log
kubectl exec -n forgepay deployment/postgres-primary -- \
  psql -U forgepay -d forgepay_prod -c \
  "SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 20;"

# Enable query logging if not already
kubectl exec -n forgepay deployment/postgres-primary -- \
  psql -U forgepay -c "ALTER SYSTEM SET log_min_duration_statement = 1000;"

# Reload config
kubectl exec -n forgepay deployment/postgres-primary -- \
  psql -U forgepay -c "SELECT pg_reload_conf();"
```

---

## Post-Deployment Sign-Off

After successful deployment, **the on-call engineer must complete:**

- [ ] All rollout statuses: successfully rolled out
- [ ] All health checks: passing
- [ ] Smoke tests: all passed
- [ ] Metrics stable: P99 < 2s, error rate < 1%
- [ ] Logs monitored: no errors for 30 minutes
- [ ] Database: no replication lag, backups working
- [ ] Status page: updated to "All Systems Operational"

**Sign-off:**
```
Deployment: 1.2.0
Date: June 25, 2026
Time: 10:30 AM UTC
Engineer: [Name]
Result: ✓ SUCCESS / ✗ ROLLBACK
Notes: [Any issues encountered]
```

---

## Quick Reference

### Emergency Contacts

- **On-Call Engineer**: [Phone/Slack]
- **Platform Lead**: [Phone/Slack]
- **CTO**: [Phone/Slack]

### Important Dashboards

- Prometheus: https://prometheus.forgepay.io
- Grafana: https://grafana.forgepay.io
- Status Page: https://status.forgepay.io
- PagerDuty: https://forgepay.pagerduty.com

### Critical Commands

```bash
# View current release
helm list -n forgepay

# Rollback last deployment
helm rollback forgepay -n forgepay

# Check all pod status
kubectl get pods -n forgepay

# Stream logs from all services
kubectl logs -n forgepay -f --all-containers=true -l app=unified-router

# Restart a service
kubectl rollout restart deployment/unified-router -n forgepay

# Scale a deployment
kubectl scale deployment/unified-router --replicas=5 -n forgepay
```

### Deployment Timeline

| Phase | Duration | Owner |
|-------|----------|-------|
| Pre-flight checks | 15 min | On-call |
| Database migrations | 30 min | On-call |
| Service deployment | 20 min | On-call |
| Smoke tests & verification | 20 min | On-call |
| Monitoring & sign-off | 30 min | On-call |
| **Total** | **~2 hours** | |

---

## Additional Resources

- Go-Live Checklist: `forgepay/GO_LIVE_CHECKLIST.md`
- Load Testing: `forgepay/load-testing/LOAD_TESTING.md`
- Helm Charts: `forgepay/infra/helm/`
- Kubernetes Manifests: `forgepay/infra/k8s/`
- Runbooks: `forgepay/infra/runbooks/`
