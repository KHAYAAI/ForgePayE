# OpenPrivy Production Launch Checklist

**Launch Date:** ____________
**On-Call Engineer:** ____________
**Security Lead:** ____________
**Database Lead:** ____________

---

## Pre-Launch (48 hours before)

### Code & Security
- [ ] All staging tests passing
- [ ] Security audit complete
- [ ] No known vulnerabilities
- [ ] Recent dependencies updated
- [ ] Code review sign-off complete

### Infrastructure
- [ ] Production Kubernetes cluster verified
- [ ] All nodes healthy: `kubectl get nodes`
- [ ] Storage provisioned and tested
- [ ] Database backups configured
- [ ] Log aggregation working

### Secrets & Configuration
- [ ] Production secrets created in Kubernetes
- [ ] Database credentials rotated
- [ ] API keys provisioned (Pimlico, Alchemy, etc.)
- [ ] RPC endpoints tested and configured
- [ ] Environment variables set correctly

### Monitoring & Alerting
- [ ] Prometheus deployed to production
- [ ] Alert rules loaded and tested
- [ ] Slack/PagerDuty integration configured
- [ ] Grafana dashboards created
- [ ] Log aggregation (ELK/Splunk) ready

---

## Launch Day - Canary Stages

### Stage 1: 1% Traffic
- [ ] Pod deployed successfully
- [ ] Pod passes health checks
- [ ] Error rate < 5%
- [ ] Latency P95 < 1000ms
- [ ] No alerts triggered

**Time Started:** ________ **Status:** ✓ / ✗

### Stage 2: 10% Traffic
- [ ] All pods running
- [ ] Error rate < 5%
- [ ] Latency stable P95 < 1000ms
- [ ] Database connections healthy
- [ ] No pod restarts

**Time Started:** ________ **Status:** ✓ / ✗

### Stage 3: 50% Traffic
- [ ] ~5 pods running
- [ ] Error rate stable < 5%
- [ ] Latency stable P95 < 1000ms
- [ ] CPU/Memory usage reasonable
- [ ] Zero pod crashes

**Time Started:** ________ **Status:** ✓ / ✗

### Stage 4: 100% Traffic
- [ ] All 10 pods running
- [ ] Error rate < 1%
- [ ] Latency P95 < 500ms
- [ ] No unexpected crashes/restarts
- [ ] 99.5% uptime maintained

**Time Started:** ________ **Status:** ✓ / ✗

---

## Success Criteria (72 hours)

- [ ] 99.5% uptime achieved
- [ ] P95 latency < 500ms
- [ ] Error rate < 1%
- [ ] No critical incidents
- [ ] All customers operational

**Launch Status:** ✓ SUCCESSFUL / ✗ ROLLED BACK

**Sign-off:** _________________ Date: ________
