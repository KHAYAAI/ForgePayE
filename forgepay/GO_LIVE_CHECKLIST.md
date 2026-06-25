# ForgePay Production Go-Live Readiness Checklist

**Date**: June 25, 2026  
**Version**: 1.0  
**Audience**: Platform engineers, DevOps, security team  

This checklist validates ForgePay production readiness across infrastructure, application, deployment, security, and operational domains.

---

## ✓ Infrastructure Readiness

- [ ] **PostgreSQL**
  - [ ] Primary database configured with replication (standby hot-standby)
  - [ ] Automated backups enabled (daily + weekly retention)
  - [ ] WAL archival configured to S3/cloud storage
  - [ ] PITR (point-in-time recovery) tested
  - [ ] Connection pooling configured (min: 20, max: 100 per service)
  - [ ] Resource limits set: 8+ CPU, 16+ GB RAM
  - [ ] Monitoring: query performance, disk I/O, replication lag
  - [ ] RTO: < 15 minutes, RPO: < 5 minutes documented

- [ ] **Redis**
  - [ ] Cluster mode enabled (minimum 3 master nodes)
  - [ ] Persistence enabled (RDB snapshots + AOF)
  - [ ] Eviction policy set to `allkeys-lru` (or `volatile-lru` if TTLs set)
  - [ ] Memory limit set (48+ GB for production)
  - [ ] Automatic failover configured with Sentinel or native clustering
  - [ ] Replication verified (replica lag < 1s)
  - [ ] Monitoring: memory usage, keyspace stats, replication status

- [ ] **Kubernetes Cluster**
  - [ ] Production cluster running (3+ master nodes for HA)
  - [ ] Node count: minimum 5 nodes (autoscaling 5–20 configured)
  - [ ] Kubelet version ≥ 1.27
  - [ ] RBAC enabled (all ServiceAccounts with minimal permissions)
  - [ ] Network policies deployed (deny-all + allow specific service pairs)
  - [ ] Pod security policies enforced (no root, read-only filesystem)
  - [ ] Resource quotas set per namespace
  - [ ] Logging driver: json-file with max-size, max-file
  - [ ] Cluster monitoring: node health, pod density, API latency

- [ ] **TLS Certificates**
  - [ ] Cert-manager deployed and running
  - [ ] ClusterIssuer configured for Let's Encrypt (prod)
  - [ ] All ingress routes have valid TLS certificates
  - [ ] Certificate renewal automation tested (simulated cert expiry)
  - [ ] OCSP stapling enabled on ingress
  - [ ] Certificate monitoring: alert 30 days before expiry

- [ ] **Prometheus + Grafana**
  - [ ] Prometheus deployed with 30-day retention
  - [ ] Service discovery working (all targets scraping)
  - [ ] Grafana dashboards provisioned for each service
  - [ ] Dashboard data source verified (queries working)
  - [ ] Alert rules deployed and tested
  - [ ] Grafana admin credentials rotated (not default)
  - [ ] LDAP/SSO integration for team access

- [ ] **Alert Routing (PagerDuty / OnCall)**
  - [ ] PagerDuty integration configured with Prometheus AlertManager
  - [ ] Escalation policies defined (on-call rotation)
  - [ ] Critical alerts trigger immediate page
  - [ ] Warning alerts logged but not paged
  - [ ] Silence rules configured (maintenance windows)
  - [ ] Webhook testing: AlertManager → PagerDuty verified

---

## ✓ Application Readiness

- [ ] **Load Testing Baseline**
  - [ ] All services pass load test: 5-minute baseline at target RPS
  - [ ] P99 latency < 2000ms for all services (hard requirement)
  - [ ] Error rate < 1% across all services
  - [ ] Baseline results captured: `forgepay/load-testing/baseline.json`
  - [ ] Results reviewed and approved by platform team
  - [ ] Command: `cd forgepay/load-testing && ./run-load-tests.sh --capture-baseline`

- [ ] **Database Configuration**
  - [ ] Connection pools tuned across all 8+ services
  - [ ] Pool size: 20–50 per service (dependent on concurrency)
  - [ ] Idle timeout: 30 minutes
  - [ ] Max lifetime: 30 minutes
  - [ ] All services using standardized pool config (no hardcoded sizes)

- [ ] **Database Indexes**
  - [ ] All indexes created (reviewed against slow-query logs)
  - [ ] Foreign key indexes verified
  - [ ] Composite indexes for multi-column WHERE/JOIN clauses
  - [ ] Index statistics updated: `ANALYZE` run on all tables
  - [ ] Query planner verified (EXPLAIN output shows index usage)

- [ ] **N+1 Query Prevention**
  - [ ] All N+1 queries identified and fixed
  - [ ] DataLoader or equivalent batch-loading in place
  - [ ] Slow query logging monitored for 48+ hours (< 5% of queries > 500ms)
  - [ ] Query count per endpoint verified (no unexplained increases)

- [ ] **Slow Query Logging**
  - [ ] PostgreSQL `log_min_duration_statement` = 1000ms
  - [ ] Logs rotated daily, retained for 7 days
  - [ ] Monitoring: daily slow-query report generated
  - [ ] Alert: if > 5% of queries exceed 2 seconds

- [ ] **Environment Configuration**
  - [ ] All `.env.example` files populated with production values
  - [ ] No secrets hardcoded in code or config files
  - [ ] All environment variables documented
  - [ ] Fallback defaults provided (never critical without env var)

- [ ] **Secrets Management**
  - [ ] All API keys injected via Vault or AWS Secrets Manager
  - [ ] Kubernetes Secrets used for service-to-service auth (e.g., HMAC keys)
  - [ ] Rotation policy: API keys rotated quarterly (or on compromise)
  - [ ] Key versioning: old keys accepted for 24–48 hours during rotation
  - [ ] Access logs: Vault/Secrets Manager logs reviewed for anomalies

- [ ] **TLS Certificates**
  - [ ] All service-to-service communication uses mTLS
  - [ ] Certificate validity: min 90 days
  - [ ] Certificate renewal tested (cert-manager auto-renewal)
  - [ ] Root CA certificate pinned in critical paths (payment APIs)

---

## ✓ Deployment Readiness

- [ ] **Helm Values**
  - [ ] Production `values.yaml` reviewed and finalized
  - [ ] Replicas set appropriately (min 3 for HA services)
  - [ ] Resource requests/limits verified:
    - Unified Router: 500m CPU, 512Mi RAM (requests), 2000m/2Gi (limits)
    - Mor-layer: 1000m CPU, 1Gi RAM (requests), 4000m/4Gi (limits)
    - Crypto Gateway: 500m CPU, 512Mi RAM (requests), 2000m/2Gi (limits)
    - Stablecoin Gateway: 500m CPU, 512Mi RAM (requests), 2000m/2Gi (limits)
    - Yield Engine: 2000m CPU, 2Gi RAM (requests), 4000m/4Gi (limits)
    - Agent Identity: 500m CPU, 512Mi RAM (requests), 2000m/2Gi (limits)
  - [ ] Liveness probes: endpoint + timeout + failure threshold configured
  - [ ] Readiness probes: endpoint + initial delay + period set
  - [ ] Autoscaling: HPA configured with CPU/memory thresholds
  - [ ] PDB (Pod Disruption Budget): min 2 replicas always available
  - [ ] Node affinity: services spread across zones

- [ ] **Deployment Strategy**
  - [ ] Canary deployment plan documented:
    - [ ] Blue-green: run current + new in parallel, switch traffic
    - [ ] Or Helm rollback: deploy with `--atomic`, auto-rollback on failure
  - [ ] Canary tested in staging environment
  - [ ] Rollback procedure tested (< 2 minutes from decision to old version)
  - [ ] Deployment success criteria defined (health checks, smoke tests pass)

- [ ] **Database Migrations**
  - [ ] All migrations tested against fresh schema (via Docker)
  - [ ] Backward compatibility verified (old code can run with new schema)
  - [ ] Migration idempotency verified (safe to re-run)
  - [ ] Rollback scripts present (for critical migrations)
  - [ ] Migration order documented (dependencies between services)
  - [ ] Pre-deployment: run migrations on standby, verify no errors

- [ ] **Pod Restart Recovery**
  - [ ] All services rebuild state from database (no in-memory state lost)
  - [ ] Cache rebuild on startup: not required for correctness
  - [ ] Session state: stored in Redis or database (recoverable)
  - [ ] In-flight requests: graceful shutdown on SIGTERM (30s grace period)
  - [ ] Pod restart test: kill pod, verify recovery within 1 minute

- [ ] **Failover Testing**
  - [ ] Scenario: one pod dies, traffic shifts to others
  - [ ] Verification: requests complete without error
  - [ ] Time to recover: < 30 seconds
  - [ ] Database connection pool: recovers after pod loss
  - [ ] Redis: reconnects after network partition
  - [ ] Test procedure documented and runnable

- [ ] **Log Aggregation**
  - [ ] All service logs forwarded to centralized system (ELK, DataDog, etc.)
  - [ ] Log format standardized (JSON with timestamp, level, message, context)
  - [ ] Log retention: minimum 30 days
  - [ ] Log sampling: high-volume logs sampled (not all stored)
  - [ ] Log search working (can find requests by transaction ID)
  - [ ] PII masking: card numbers, tokens, passwords redacted

- [ ] **Metrics Scraping**
  - [ ] Prometheus sees all service targets
  - [ ] Scrape interval: 15–30 seconds
  - [ ] Metric retention: 7+ days
  - [ ] Custom metrics: all exported with `prometheus_` prefix
  - [ ] Metric cardinality: < 10k unique label combinations

---

## ✓ Security Readiness

- [ ] **Webhook Signature Verification**
  - [ ] Unified Router: verifies HMAC-SHA256 on all webhook payloads
  - [ ] Mor-layer: verifies Polar webhook signatures
  - [ ] Stablecoin Gateway: verifies internal webhook signatures
  - [ ] Crypto Gateway: verifies blockchain event signatures
  - [ ] Signature verification tested with invalid/expired signatures
  - [ ] Timestamp validation: webhook accepted only if < 5 minutes old
  - [ ] Replay attack prevention: nonce or request ID tracked

- [ ] **API Key Rotation**
  - [ ] All API keys rotated from initial dev values
  - [ ] Keys stored in Vault with access logs
  - [ ] Rotation schedule: quarterly or on exposure
  - [ ] During rotation: old + new keys accepted for 48 hours
  - [ ] Monitoring: alert on unauthorized key access

- [ ] **JWT Secrets**
  - [ ] JWT signing key generated and vaulted
  - [ ] JWT secret never committed to git (checked via pre-commit hook)
  - [ ] Token expiration: 15 minutes (short-lived access)
  - [ ] Refresh token: 7 days (long-lived, rotates on use)
  - [ ] Key rotation plan: new key can validate old tokens for grace period

- [ ] **Database Passwords**
  - [ ] Database passwords vaulted (never in Helm values or env files)
  - [ ] Read-only replica password different from primary
  - [ ] User permissions scoped per service:
    - Unified Router: read/write payment_events, webhooks
    - Mor-layer: read/write checkout_sessions, tax_rates
    - Crypto Gateway: read/write invoices, wallets
    - Etc.
  - [ ] Service cannot access other service's tables
  - [ ] Application user cannot drop tables or modify schema

- [ ] **Network Policies**
  - [ ] Ingress: only allow traffic from load balancer / API gateway
  - [ ] Egress: only allow to internal services + external APIs
  - [ ] Deny-all default policy deployed
  - [ ] Whitelist-based rules for each service pair
  - [ ] Testing: verify denied traffic is blocked (503/timeout)

- [ ] **Rate Limiting**
  - [ ] API endpoints rate-limited by IP or user
  - [ ] Limits: 100 req/min per IP (login), 1000 req/min per user (normal)
  - [ ] Attack test: 1000 req/s → 429 status codes returned
  - [ ] Distributed rate limiting: state stored in Redis (shared across replicas)
  - [ ] Monitoring: alert on spike in 429 responses

- [ ] **PCI Compliance (if handling cards)**
  - [ ] No card numbers in logs (pre-commit hook checks)
  - [ ] No card numbers in database (all stored in Hyperswitch PCI vault)
  - [ ] No card numbers in cache (Redis, browser storage)
  - [ ] All payment APIs use TLS 1.2+
  - [ ] PCI scanning: quarterly vulnerability scans scheduled
  - [ ] Audit: PCI compliance audit completed

- [ ] **Data Privacy**
  - [ ] PII fields identified: email, phone, name, address
  - [ ] PII masked in logs (e.g., `***@gmail.com`)
  - [ ] PII masked in error responses (never leak user details)
  - [ ] Data retention policy: delete inactive accounts after 1 year
  - [ ] GDPR compliance: data export/deletion APIs implemented
  - [ ] Monitoring: alert on bulk data exports

---

## ✓ Operational Readiness

- [ ] **On-Call Runbooks**
  - [ ] Unified Router runbook: common issues + troubleshooting steps
    - Issue: high error rate → check database connection
    - Issue: high P99 latency → check Redis performance
    - Issue: pod restart loop → check Postgres connection
  - [ ] Mor-layer runbook (checkout failures)
  - [ ] Crypto Gateway runbook (invoice lookups failing)
  - [ ] Stablecoin Gateway runbook (deposit transactions stuck)
  - [ ] Yield Engine runbook (position queries slow)
  - [ ] Agent Identity runbook (agent lookups failing)
  - [ ] Database runbook: common Postgres issues
  - [ ] Redis runbook: memory pressure, cluster issues
  - [ ] Kubernetes runbook: node failures, pod evictions
  - [ ] Each runbook includes:
    - Symptoms (what the alert says)
    - Diagnostics (what to check first)
    - Quick fixes (safe steps to resolve)
    - Escalation path (when to call platform team)

- [ ] **Escalation Procedures**
  - [ ] L1 (On-call engineer):
    - [ ] Handles known issues per runbook
    - [ ] Escalates unknown issues immediately
    - [ ] Time to first response: < 5 minutes
  - [ ] L2 (Platform lead):
    - [ ] Complex infrastructure or code issues
    - [ ] Database recovery, cluster failures
    - [ ] On-call 24/7 during critical incidents
  - [ ] L3 (CTO):
    - [ ] Strategic decisions (rollback vs. fix forward)
    - [ ] Business impact assessment
    - [ ] Called only for P1 (complete outage) incidents

- [ ] **Rollback Procedures**
  - [ ] Helm rollback: `helm rollback forgepay` (to previous release)
  - [ ] Procedure documented with exact steps
  - [ ] Tested in staging: rollback reverses all service changes
  - [ ] Time to rollback: < 2 minutes
  - [ ] Data migration rollback: verified safe (no data loss)
  - [ ] Communications template: what to send to customers

- [ ] **Backup/Restore Procedures**
  - [ ] Daily PostgreSQL backups to S3 (encrypted, versioned)
  - [ ] Restore test: quarterly restore to fresh instance, verify data
  - [ ] Restore time: < 30 minutes for full database
  - [ ] Point-in-time recovery: can restore to any point in last 7 days
  - [ ] Redis backup: RDB snapshots to S3
  - [ ] Documentation: how to restore from S3 backup, how long it takes

- [ ] **Incident Response Plan**
  - [ ] Incident severity levels defined:
    - P0: Complete outage, no transactions possible
    - P1: Major degradation, customers affected
    - P2: Minor issue, some users affected
    - P3: Non-customer-impacting, cosmetic issues
  - [ ] P0 response time: < 5 minutes (declare incident)
  - [ ] P0 communication: status page updated every 15 minutes
  - [ ] Post-mortem template: incident report + root cause + prevention
  - [ ] Post-mortem meeting: within 24 hours, all hands present
  - [ ] Prevention action items: assigned owners, due dates

- [ ] **Post-Deployment Smoke Tests**
  - [ ] Automated test suite runs after every deployment
  - [ ] Tests cover critical paths:
    - [ ] Health check: GET /health → 200
    - [ ] Unified Router: POST webhook → accepted
    - [ ] Mor-layer: create checkout session → session created
    - [ ] Crypto Gateway: get invoice → invoice returned
    - [ ] Stablecoin Gateway: deposit → transaction ID returned
    - [ ] Yield Engine: get positions → positions returned
    - [ ] Agent Identity: list agents → agents returned
  - [ ] Failure: automatic rollback if any test fails
  - [ ] Report: pass/fail results sent to Slack

- [ ] **Monitoring and Alerting**
  - [ ] Service availability: alert if any pod unhealthy > 1 minute
  - [ ] Request latency: alert if P99 > 2s for any service
  - [ ] Error rate: alert if > 1% for any service
  - [ ] Database performance: alert if slow queries > 5% of total
  - [ ] Disk space: alert if > 80% used
  - [ ] Memory: alert if > 80% used on any pod
  - [ ] CPU: alert if sustained > 80% for > 5 minutes
  - [ ] All alerts sent to PagerDuty with context
  - [ ] Noise reduction: alert thresholds tuned to minimize false positives

---

## Sign-Off

- [ ] **Platform Team Review**
  - Reviewed by: ________________  
  - Date: ________________  
  - Approval: ☐ Approved ☐ Approved with conditions ☐ Rejected  

- [ ] **Security Team Review**
  - Reviewed by: ________________  
  - Date: ________________  
  - Approval: ☐ Approved ☐ Approved with conditions ☐ Rejected  

- [ ] **Ops Team Review**
  - Reviewed by: ________________  
  - Date: ________________  
  - Approval: ☐ Approved ☐ Approved with conditions ☐ Rejected  

- [ ] **Final Go-Live Decision**
  - Approved for production: ☐ Yes ☐ No  
  - Date: ________________  
  - Notes: _______________________________________________________________

---

## Post-Go-Live Monitoring (First 7 Days)

After production deployment, monitor extra closely:

- [ ] P99 latency stable (no upward trend)
- [ ] Error rate stable (< 0.1%)
- [ ] Database connection pool: peak usage < 80%
- [ ] Redis memory: peak usage < 80%
- [ ] CPU per pod: stable around 30–50%
- [ ] No unexpected pod restarts
- [ ] Webhook processing: latency stable, no backlog
- [ ] Payment success rate: ≥ 99.5%
- [ ] No critical alerts overnight
- [ ] Customer support: zero payment-related complaints

If any issue detected, **DO NOT WAIT** for the next scheduled review—escalate immediately to L2.
