# OpenPrivy Operations Runbooks

## Incident Response Flow

```
Alert fires (PagerDuty)
    ↓
On-call engineer acknowledges
    ↓
Assess severity (P1/P2/P3)
    ↓
Page incident commander if P1
    ↓
Investigate root cause
    ↓
Implement mitigation
    ↓
Fix root cause
    ↓
Post-incident review (24hrs for P1, 48hrs for P2)
    ↓
Update runbooks/monitoring
```

## P1 Incidents (Critical)

### Database Unavailable

**Detection:** PostgreSQL service down, connection timeout errors  
**Time to Resolve:** 15 minutes  
**Impact:** All operations blocked

#### Steps

1. **Verify database state**
```bash
kubectl exec -n openprivy postgres-0 -- pg_isready
# If down, check pod status
kubectl describe pod postgres-0 -n openprivy
```

2. **Check disk space**
```bash
kubectl exec -n openprivy postgres-0 -- df -h /var/lib/postgresql/data
# If >90%, delete old backups or WAL files
```

3. **Attempt restart**
```bash
# Kill zombie connections
kubectl exec -n openprivy postgres-0 -- psql -U openprivy -d openprivy -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
   WHERE datname = 'openprivy' AND pid != pg_backend_pid();"

# Restart pod
kubectl delete pod postgres-0 -n openprivy
```

4. **If still down, failover to read replica**
```bash
# Promote read replica to primary
aws rds promote-read-replica --db-instance-identifier openprivy-replica

# Update connection string
kubectl set env deployment/backend \
  DATABASE_URL=postgresql://openprivy:pass@openprivy-replica.rds.amazonaws.com/openprivy \
  -n openprivy

# Verify connections
kubectl logs deployment/backend -n openprivy | grep "connected"
```

5. **Restore from backup if corrupted**
```bash
# Restore to new instance
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier openprivy-restore \
  --db-snapshot-identifier openprivy-snapshot-latest

# Point backend to new instance
kubectl set env deployment/backend \
  DATABASE_URL=postgresql://openprivy:pass@openprivy-restore.rds.amazonaws.com/openprivy \
  -n openprivy
```

---

### API Service Down (All Endpoints)

**Detection:** All API requests returning 502/503  
**Time to Resolve:** 10 minutes  
**Impact:** Mobile app non-functional

#### Steps

1. **Check pod health**
```bash
kubectl get pods -n openprivy -o wide
# Look for CrashLoopBackOff, Pending, or Failed states
```

2. **View pod logs**
```bash
kubectl logs -n openprivy deployment/backend -f --tail=100
# Look for panic, fatal errors, or repeated messages
```

3. **If out of memory**
```bash
# Check memory usage
kubectl top pods -n openprivy

# Increase memory limits
kubectl set resources deployment/backend \
  --limits=memory=2Gi \
  -n openprivy

# Force restart pods
kubectl rollout restart deployment/backend -n openprivy
```

4. **If database connection issue**
```bash
# Test database connectivity from pod
kubectl exec -n openprivy deployment/backend -- psql $DATABASE_URL -c "SELECT 1"

# Check environment variables
kubectl exec -n openprivy deployment/backend -- env | grep DATABASE_URL
```

5. **If configuration issue**
```bash
# Describe deployment to see env vars
kubectl describe deployment backend -n openprivy

# Recreate secrets if corrupted
kubectl delete secret backend-secrets -n openprivy
kubectl create secret generic backend-secrets \
  --from-literal=DATABASE_URL=$DB_URL \
  --from-literal=JWT_SECRET=$JWT_SECRET \
  -n openprivy
```

6. **Rollback last deployment if recent change**
```bash
kubectl rollout undo deployment/backend -n openprivy
kubectl rollout status deployment/backend -n openprivy
```

---

### High Error Rate (>5%)

**Detection:** Prometheus alert `HighErrorRate`  
**Time to Resolve:** 30 minutes  
**Impact:** Users experiencing failures

#### Steps

1. **Identify error pattern**
```bash
# Query Prometheus
curl http://prometheus:9090/api/v1/query?query=rate(openprivy_errors_total[5m])

# Check logs for error spike
kubectl logs -n openprivy deployment/backend \
  --since=5m | grep ERROR | head -50
```

2. **Determine affected operations**
```bash
# Query by operation type
kubectl logs -n openprivy deployment/backend \
  --since=5m | grep -E "wallet_create|send_transaction|auth_login" | tail -20
```

3. **Check recent deployments**
```bash
kubectl rollout history deployment/backend -n openprivy
# If recent change, investigate changes or rollback
```

4. **Check external dependencies**
```bash
# Test RPC endpoints
curl -s https://eth-mainnet.g.alchemy.com/v2/KEY \
  -X POST -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'

# Test Pimlico paymaster
curl -s https://api.pimlico.io/v1/mainnet/rpc?apikey=KEY \
  -X POST -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

5. **Scale up if traffic spike**
```bash
kubectl autoscale deployment backend --min=5 --max=10 -n openprivy
# Or manually
kubectl scale deployment backend --replicas=10 -n openprivy
```

---

## P2 Incidents (High)

### High API Latency (P95 > 1s)

**Detection:** Prometheus alert `HighLatency`  
**Time to Resolve:** 1 hour  
**Impact:** Slow user experience

#### Steps

1. **Identify slow endpoint**
```bash
# Query latency by path
kubectl logs -n openprivy deployment/backend \
  --since=5m | grep "duration" | sort -t= -k3 -rn | head -10
```

2. **Check database query performance**
```bash
# Enable slow query log
kubectl exec postgres-0 -n openprivy -- psql -U openprivy -d openprivy -c \
  "ALTER SYSTEM SET log_min_duration_statement = 1000;"

# View slow queries
kubectl exec postgres-0 -n openprivy -- psql -U openprivy -d openprivy -c \
  "SELECT query, mean_exec_time FROM pg_stat_statements 
   ORDER BY mean_exec_time DESC LIMIT 10;"
```

3. **Add indexes if needed**
```sql
-- Analyze missing indexes
EXPLAIN ANALYZE SELECT * FROM wallets WHERE user_id = '...' AND chain = 'ethereum';

-- Add index if missing
CREATE INDEX idx_wallets_user_chain ON wallets(user_id, chain);
```

4. **Check cache hit rate**
```bash
# Monitor Redis hits/misses
kubectl exec redis-0 -n openprivy -- redis-cli INFO stats | grep hit_ratio
# Target: >80%
```

5. **Scale database if CPU high**
```bash
# Check CPU usage
kubectl top pod postgres-0 -n openprivy

# Scale if needed
aws rds modify-db-instance \
  --db-instance-identifier openprivy \
  --db-instance-class db.t3.xlarge \
  --apply-immediately
```

---

### Redis Cluster Unhealthy

**Detection:** Redis connection errors, cache misses  
**Time to Resolve:** 30 minutes  
**Impact:** Cache layer down, increased database load

#### Steps

1. **Check Redis status**
```bash
kubectl get pods -n openprivy -l app=redis
kubectl logs redis-0 -n openprivy
```

2. **Check replication**
```bash
kubectl exec redis-0 -n openprivy -- redis-cli INFO replication
# Should show: role:master
```

3. **Monitor memory usage**
```bash
kubectl exec redis-0 -n openprivy -- redis-cli INFO memory
# Check maxmemory_policy (should be allkeys-lru)
```

4. **Clear old cache data**
```bash
kubectl exec redis-0 -n openprivy -- redis-cli FLUSHDB
# Or selectively
kubectl exec redis-0 -n openprivy -- redis-cli KEYS "session:*" | xargs redis-cli DEL
```

5. **If corrupted, restore from RDB**
```bash
kubectl delete pod redis-0 -n openprivy
# Volume will be recreated from PVC
```

---

## P3 Incidents (Medium)

### SSL Certificate Expiring Soon

**Detection:** Monitoring alert (30 days before expiry)  
**Time to Resolve:** 1 week  
**Impact:** None (preventive)

#### Steps

1. **Check certificate expiry**
```bash
openssl s_client -connect api.openprivy.io:443 -showcerts | \
  grep "Expire" | grep "Not After"
```

2. **Renew certificate (cert-manager handles automatically)**
```bash
# Verify cert-manager is running
kubectl get pods -n cert-manager

# Check certificate status
kubectl get certificate -n openprivy

# Manually trigger renewal if needed
kubectl delete certificate openprivy-tls -n openprivy
# cert-manager will recreate it
```

---

### Failed Test Suite

**Detection:** CI/CD pipeline failure on develop branch  
**Time to Resolve:** 2 hours  
**Impact:** Blocks merge to develop

#### Steps

1. **View test output**
```bash
# From GitHub Actions
# Check failed test logs

# Or locally
cd services/backend
npm test -- --verbose --bail
```

2. **Identify flaky tests**
```bash
# Tests that pass/fail randomly
npm test -- --detectOpenHandles
```

3. **Fix test**
```bash
# Common issues:
# - Database not seeded
# - Race conditions
# - Mock not configured
# - Timeout too short

# Increase timeout if needed
jest.setTimeout(10000);
```

4. **Commit fix**
```bash
git add -A
git commit -m "fix: flaky test in wallet.e2e.test.ts"
git push
```

---

## Common Tasks

### Deploy New Version

1. **Build and push image**
```bash
docker build -t openprivy-backend:v1.0.1 -f services/backend/Dockerfile .
docker tag openprivy-backend:v1.0.1 \
  gcr.io/openprivy/backend:v1.0.1
docker push gcr.io/openprivy/backend:v1.0.1
```

2. **Update Kubernetes deployment**
```bash
kubectl set image deployment/backend \
  backend=gcr.io/openprivy/backend:v1.0.1 \
  -n openprivy

# Wait for rollout
kubectl rollout status deployment/backend -n openprivy
```

3. **Verify deployment**
```bash
curl https://api.openprivy.io/health
kubectl logs deployment/backend -n openprivy | tail -20
```

---

### Scale Deployment

**Horizontal Scaling (more pods)**
```bash
kubectl scale deployment backend --replicas=10 -n openprivy
kubectl get hpa -n openprivy  # Check autoscaler
```

**Vertical Scaling (more CPU/memory)**
```bash
kubectl set resources deployment backend \
  --requests=cpu=1000m,memory=1Gi \
  --limits=cpu=2000m,memory=2Gi \
  -n openprivy
```

---

### Rotate Secrets

```bash
# Generate new secret
NEW_JWT_SECRET=$(openssl rand -hex 32)

# Update Kubernetes secret
kubectl patch secret backend-secrets \
  -p='{"data":{"JWT_SECRET":"'$(echo -n $NEW_JWT_SECRET | base64)'"}}'  \
  -n openprivy

# Restart pods to pick up new secret
kubectl rollout restart deployment/backend -n openprivy

# Verify update took effect
kubectl exec deployment/backend -n openprivy -- \
  env | grep JWT_SECRET
```

---

### Database Backup & Restore

**Manual backup**
```bash
kubectl exec postgres-0 -n openprivy -- \
  pg_dump -U openprivy openprivy > backup-$(date +%s).sql

# Upload to S3
aws s3 cp backup-*.sql s3://openprivy-backups/
```

**Restore from backup**
```bash
# Get backup from S3
aws s3 cp s3://openprivy-backups/backup-1234567890.sql .

# Restore
kubectl exec -i postgres-0 -n openprivy -- \
  psql -U openprivy openprivy < backup-1234567890.sql
```

---

## Monitoring Dashboards

### Key Dashboard: openprivy-overview
- **Request Rate (RPS)** - Should be steady
- **Error Rate** - Target <0.1%
- **P95 Latency** - Target <500ms
- **Pod CPU** - Target <70%
- **Pod Memory** - Target <80%
- **DB Connections** - Target <150/200

### Query Examples

```promql
# Request rate
rate(openprivy_requests_total[5m])

# Error rate
rate(openprivy_errors_total[5m]) / rate(openprivy_requests_total[5m])

# P95 latency
histogram_quantile(0.95, rate(openprivy_request_duration_seconds_bucket[5m]))

# Pod CPU
rate(container_cpu_usage_seconds_total{pod=~"backend.*"}[5m]) * 100

# DB connections
pg_stat_activity_count
```

---

**Last Updated:** June 30, 2026  
**Version:** 1.0.0  
**Maintained By:** OpenPrivy Operations Team

---

**Emergency Contacts:**
- Page on-call: PagerDuty app or +1-555-ONCALL
- Slack: #incidents
- War room: https://zoom.us/j/openprivy-incidents
