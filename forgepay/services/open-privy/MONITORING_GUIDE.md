# OpenPrivy Monitoring & Observability Guide

## Overview

This guide covers monitoring, alerting, and observability for OpenPrivy in both staging and production environments.

---

## Prometheus Setup

### Access Prometheus UI

**Staging:**
```bash
kubectl port-forward -n openprivy-staging svc/prometheus 9090:9090
# Visit http://localhost:9090
```

**Production:**
```bash
kubectl port-forward -n openprivy svc/prometheus 9090:9090
# Visit http://localhost:9090
```

### Key Metrics to Monitor

#### Application Metrics

**Request Rate:**
```promql
rate(openprivy_requests_total[5m])
```
- Target: >100 RPS under load testing
- Alert: < 10 RPS for 5 minutes (possible outage)

**Error Rate:**
```promql
rate(openprivy_errors_total[5m])
```
- Target: < 0.5% error rate
- Alert: > 5% for 5 minutes (defined in prometheus-rules.yaml)

**Request Latency (P95):**
```promql
histogram_quantile(0.95, rate(openprivy_request_duration_seconds_bucket[5m]))
```
- Target: < 500ms
- Alert: > 1000ms for 5 minutes (high latency alert)

**Request Latency (P99):**
```promql
histogram_quantile(0.99, rate(openprivy_request_duration_seconds_bucket[5m]))
```
- Target: < 1000ms
- Alert: > 2000ms

**Availability:**
```promql
1 - (rate(openprivy_errors_total[30m]) / rate(openprivy_requests_total[30m]))
```
- Target: > 99.5% uptime
- Alert: < 99.5% for 15 minutes (SLO violation)

#### Infrastructure Metrics

**Pod CPU Usage:**
```promql
rate(container_cpu_usage_seconds_total{pod=~"backend.*",namespace="openprivy"}[5m]) * 100
```
- Target: < 70% under load
- Alert: > 80% for 5 minutes

**Pod Memory Usage:**
```promql
(container_memory_usage_bytes{pod=~"backend.*",namespace="openprivy"} /
 container_spec_memory_limit_bytes{pod=~"backend.*",namespace="openprivy"}) * 100
```
- Target: < 70% under load
- Alert: > 85% for 5 minutes

**Pod Restarts:**
```promql
rate(kube_pod_container_status_restarts_total{namespace="openprivy",pod=~"backend.*"}[15m])
```
- Target: 0 restarts
- Alert: > 0.1 restarts/minute (pod crash looping)

**Database Availability:**
```promql
up{job="postgres"}
```
- Target: 1 (up)
- Alert: 0 (database down) for 1 minute

**Disk Space:**
```promql
(node_filesystem_avail_bytes{fstype=~"ext[234]|btrfs|xfs|zfs"} /
 node_filesystem_size_bytes) * 100
```
- Target: > 20% free
- Alert: < 10% free for 5 minutes

#### Security Metrics

**Failed Login Attempts:**
```promql
rate(openprivy_auth_failures_total{reason="invalid_password"}[5m])
```
- Target: < 1 per second under normal load
- Alert: > 10 per second (brute force attempt)

**Unauthorized Access Attempts (401):**
```promql
rate(http_requests_total{status="401"}[5m])
```
- Target: < 10 per second
- Alert: > 50 per second

**Potential DDoS:**
```promql
rate(http_requests_total[5m])
```
- Target: 1000-5000 RPS under load testing
- Alert: > 10000 RPS for 2 minutes

---

## Alert Rules Overview

All alerts are defined in `k8s/prometheus-rules.yaml`. See that file for full details.

### Critical (P1) Alerts

1. **HighErrorRate** - Error rate > 5% for 5 minutes
   - Runbook: https://openprivy.io/runbooks/high-error-rate
   - Action: Page on-call engineer immediately

2. **PodCrashLooping** - Pod restarting > 0.1 times/minute
   - Runbook: https://openprivy.io/runbooks/pod-crash-loop
   - Action: Investigate pod logs and events

3. **DatabaseUnavailable** - PostgreSQL down for > 1 minute
   - Runbook: https://openprivy.io/runbooks/database-unavailable
   - Action: Page database team immediately

4. **HighLatency** - P95 latency > 1 second for 5 minutes
   - Runbook: https://openprivy.io/runbooks/high-latency
   - Action: Check database slow queries, investigate

### High (P2) Alerts

1. **HighMemoryUsage** - Pod memory > 85% of limit
2. **HighCPUUsage** - Pod CPU > 80%
3. **DiskSpaceCritical** - Disk free < 10%
4. **FailedLoginAttemptsSpike** - > 10 failed logins/second
5. **HighGasSponsorship** - Gas sponsorship > 1 ETH/hour

### Medium (P3) Alerts

1. **SlowDatabaseQueries** - Query avg time > 1000ms
2. **LowAvailabilitySLO** - Availability < 99.5% over 30m
3. **LatencySLOViolation** - P95 latency > 500ms over 30m
4. **UnauthorizedAccessAttempts** - 401 responses > 50/second
5. **PotentialDDoS** - Request rate > 10000/second

---

## Dashboarding

### Create Grafana Dashboard

1. **Add Prometheus Data Source**
   ```
   Name: Prometheus
   URL: http://prometheus:9090
   Access: Server (default)
   ```

2. **Create Dashboard Panels**

   **Panel 1: Request Rate (Gauge)**
   ```promql
   sum(rate(openprivy_requests_total[5m]))
   ```
   - Target: > 100 RPS
   - Thresholds: Red > 10, Yellow > 5

   **Panel 2: Error Rate (%)**
   ```promql
   (sum(rate(openprivy_errors_total[5m])) / sum(rate(openprivy_requests_total[5m]))) * 100
   ```
   - Target: < 0.5%
   - Thresholds: Red > 5, Yellow > 1

   **Panel 3: P95 Latency (ms)**
   ```promql
   histogram_quantile(0.95, rate(openprivy_request_duration_seconds_bucket[5m])) * 1000
   ```
   - Target: < 500ms
   - Thresholds: Red > 1000, Yellow > 500

   **Panel 4: Pod Status (Table)**
   ```promql
   kube_pod_status_phase{namespace="openprivy",pod=~"backend.*"}
   ```

   **Panel 5: CPU Usage by Pod**
   ```promql
   rate(container_cpu_usage_seconds_total{namespace="openprivy",pod=~"backend.*"}[5m]) * 100
   ```

   **Panel 6: Memory Usage by Pod**
   ```promql
   (container_memory_usage_bytes{namespace="openprivy",pod=~"backend.*"} /
    container_spec_memory_limit_bytes{namespace="openprivy",pod=~"backend.*"}) * 100
   ```

   **Panel 7: Request Timeline (Graph)**
   ```promql
   rate(openprivy_requests_total[1m])
   ```

   **Panel 8: Error Timeline (Graph)**
   ```promql
   rate(openprivy_errors_total[1m])
   ```

---

## Logging

### Application Logs

**View Backend Logs:**
```bash
# Current logs
kubectl logs -n openprivy -l app=backend -f

# Last 100 lines
kubectl logs -n openprivy -l app=backend --tail=100

# Specific pod
kubectl logs -n openprivy backend-abc123-def456 -f

# Previous pod (if crashed)
kubectl logs -n openprivy backend-abc123-def456 --previous
```

**Log Levels:**
- `error` - Critical issues requiring attention
- `warn` - Potential issues to investigate
- `info` - General operation information
- `debug` - Detailed debugging information (staging only)

**Common Log Patterns:**

Error connecting to database:
```
ERROR: Failed to connect to PostgreSQL
```
Action: Check DATABASE_URL secret, verify PostgreSQL pod health

High error rate spike:
```
ERROR: [endpoint] request failed
ERROR: [endpoint] validation error
```
Action: Check error logs for specific failures, review recent changes

Rate limit warnings:
```
WARN: Rate limit exceeded for IP xxx.xxx.xxx.xxx
WARN: Too many failed login attempts from IP xxx.xxx.xxx.xxx
```
Action: Normal under load testing, investigate if suspicious

### Structured Logging

The backend uses structured JSON logging with fields:
```json
{
  "timestamp": "2026-06-30T12:00:00Z",
  "level": "error",
  "service": "openprivy-backend",
  "pod": "backend-abc123",
  "endpoint": "/api/wallets",
  "method": "POST",
  "status": 500,
  "duration_ms": 45,
  "error": "Database connection timeout",
  "user_id": "user123",
  "request_id": "req_abc123"
}
```

---

## Debugging Production Issues

### 1. High Error Rate

```bash
# Check which endpoints are failing
kubectl logs -n openprivy -l app=backend | grep ERROR | cut -d' ' -f5 | sort | uniq -c | sort -rn

# Query Prometheus for error breakdown
# In Prometheus UI:
# increase(openprivy_errors_total[5m]) by (endpoint)

# Check for recent deployments
kubectl rollout history deployment/backend -n openprivy

# Rollback if needed
kubectl rollout undo deployment/backend -n openprivy
```

### 2. High Latency

```bash
# Check for slow database queries
kubectl exec -n openprivy postgres-0 -- psql -c "
  SELECT query, calls, mean_exec_time
  FROM pg_stat_statements
  ORDER BY mean_exec_time DESC
  LIMIT 10;
"

# Check pod resource usage
kubectl top pods -n openprivy -l app=backend

# Check node resource availability
kubectl top nodes

# Check for CPU/memory throttling
kubectl describe pod <pod-name> -n openprivy

# Scale up if needed
kubectl scale deployment backend --replicas=5 -n openprivy
```

### 3. Pod Crashes

```bash
# Get pod events
kubectl describe pod <pod-name> -n openprivy

# Check previous logs
kubectl logs <pod-name> -n openprivy --previous

# Check resource limits
kubectl get pod <pod-name> -n openprivy -o yaml | grep -A 10 resources

# Check for OOMKilled
kubectl describe pod <pod-name> -n openprivy | grep -i oom

# If OOM: increase memory limit in backend.yaml and redeploy
```

### 4. Database Issues

```bash
# Connect to PostgreSQL
kubectl exec -it postgres-0 -n openprivy -- psql -U openprivy

# Check active connections
SELECT pid, usename, application_name, state FROM pg_stat_activity;

# Check locks
SELECT * FROM pg_locks WHERE NOT granted;

# Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

# Check for missing indexes
SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0;

# Monitor query performance
SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
```

### 5. Network Issues

```bash
# Check service endpoints
kubectl get endpoints backend -n openprivy

# Check service load balancer
kubectl describe svc backend -n openprivy

# Test DNS resolution
kubectl run -it --image=alpine test -- nslookup backend.openprivy.svc.cluster.local

# Check network policies
kubectl get networkpolicies -n openprivy

# Verify CORS configuration
curl -I -H "Origin: https://example.com" http://backend:3001
```

---

## Performance Tuning

### Database Optimization

1. **Add Missing Indexes:**
   ```sql
   CREATE INDEX idx_users_email ON users(email);
   CREATE INDEX idx_wallets_user_id ON wallets(user_id);
   CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
   CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
   ```

2. **Analyze Query Plans:**
   ```sql
   EXPLAIN ANALYZE SELECT * FROM wallets WHERE user_id = $1;
   ```

3. **Configure Connection Pooling:**
   ```
   max_connections = 200
   shared_buffers = 256MB
   effective_cache_size = 1GB
   ```

### Application Optimization

1. **Enable Caching:**
   - Redis for session storage
   - Memcached for frequent queries
   - HTTP caching headers

2. **Optimize Dependencies:**
   - Lazy load heavy modules
   - Remove unused packages
   - Update vulnerable packages

3. **Rate Limiting:**
   - Already configured in rate-limit.middleware.ts
   - Global: 100 req/min per IP
   - Per-user: 1000 req/min
   - Sensitive endpoints: stricter limits

### Infrastructure Scaling

1. **Horizontal Scaling:**
   ```bash
   kubectl scale deployment backend --replicas=5 -n openprivy
   ```

2. **Vertical Scaling:**
   Edit `k8s/backend.yaml`:
   ```yaml
   resources:
     requests:
       cpu: 500m → 1000m
       memory: 512Mi → 1Gi
     limits:
       cpu: 2000m → 4000m
       memory: 1Gi → 2Gi
   ```

3. **Auto-scaling (HPA):**
   Already configured in backend.yaml with:
   - Min replicas: 3
   - Max replicas: 10
   - Target CPU: 70%
   - Target memory: 80%

---

## Incident Response

### Severity Levels

| Severity | Impact | Response Time |
|----------|--------|----------------|
| P1 | Service down/unavailable | 15 minutes |
| P2 | Degraded performance | 30 minutes |
| P3 | Minor issues | 1-4 hours |

### Incident Checklist

1. **Assess Impact**
   - What services affected?
   - How many users impacted?
   - Revenue impact?

2. **Gather Information**
   ```bash
   # Collect diagnostics
   kubectl cluster-info dump > cluster-dump.txt
   kubectl get all -n openprivy -o yaml > resources-dump.yaml
   kubectl logs -n openprivy --all-containers=true --timestamps=true > logs.txt
   ```

3. **Implement Temporary Fix**
   - Restart services if needed
   - Scale up resources
   - Disable non-critical features
   - Rollback recent changes

4. **Root Cause Analysis**
   - Review logs and metrics
   - Check recent changes
   - Identify preventive measures

5. **Communicate**
   - Update status page
   - Notify customers
   - Document incident
   - Post-mortem within 24 hours

---

## Runbooks

Quick reference for common alerts:

### High Error Rate
**Alert:** `HighErrorRate`
**Severity:** P1
**Action:**
1. Check recent changes: `kubectl rollout history deployment/backend -n openprivy`
2. Review error logs: `kubectl logs -n openprivy -l app=backend | grep ERROR`
3. Check database: `kubectl exec -it postgres-0 -n openprivy -- psql -c "SELECT state FROM pg_stat_activity;"`
4. If recent deployment: `kubectl rollout undo deployment/backend -n openprivy`
5. Increase replicas: `kubectl scale deployment backend --replicas=5 -n openprivy`

### Database Unavailable
**Alert:** `DatabaseUnavailable`
**Severity:** P1
**Action:**
1. Check pod status: `kubectl get pods -l app=postgres -n openprivy`
2. Check resource usage: `kubectl top pod postgres-0 -n openprivy`
3. Check logs: `kubectl logs postgres-0 -n openprivy`
4. Restart: `kubectl delete pod postgres-0 -n openprivy`
5. Verify backup: `ls -la /mnt/backup/`
6. If corrupted: restore from backup

### Pod Crash Looping
**Alert:** `PodCrashLooping`
**Severity:** P1
**Action:**
1. Check events: `kubectl describe pod <pod-name> -n openprivy`
2. Check logs: `kubectl logs <pod-name> -n openprivy --previous`
3. Check resource limits: Are they hit? OOMKilled?
4. Check configuration: Are secrets/ConfigMaps mounted?
5. Scale down: `kubectl scale deployment backend --replicas=1 -n openprivy`
6. Debug: `kubectl run -it --image=openprivy-backend:latest debug -- /bin/sh`

---

## References

- Prometheus Documentation: https://prometheus.io/docs/
- Kubernetes Monitoring: https://kubernetes.io/docs/tasks/debug-application-cluster/
- Alert Rules: `k8s/prometheus-rules.yaml`
- Deployment Scripts: `scripts/deploy-staging.sh`, `scripts/deploy-production.sh`
