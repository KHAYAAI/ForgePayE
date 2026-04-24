# ForgePay Disaster Recovery Plan

## Executive Summary

**RTO (Recovery Time Objective):** 1 hour
**RPO (Recovery Point Objective):** 15 minutes
**Tested:** Quarterly (next: Q3 2026)

This plan covers recovery from:
- Regional outage (us-east-1 → us-west-2)
- Database corruption or loss
- Smart contract bug requiring pause + redeployment
- Auditor key compromise

---

## Infrastructure Recovery

### Database Recovery

**Automated Daily Backups:**
- PostgreSQL automated backups (AWS RDS): Daily at 2 AM UTC
- Retention: 30 days
- Encrypted: AES-256
- Multi-region: Replicated to us-west-2
- Location: `s3://forgepay-backups/rds-daily/`

**Point-in-Time Recovery (PITR):**

```bash
# Recover to specific timestamp (e.g., 2 hours ago)
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier forgepay-prod \
  --target-db-instance-identifier forgepay-prod-restored-$(date +%s) \
  --restore-time 2026-04-24T12:00:00Z \
  --no-multi-az  # Speed up recovery

# Wait for recovery
aws rds describe-db-instances --query 'DBInstances[0].DBInstanceStatus'

# Restore completed, now promote:
# 1. Update Kubernetes secrets to point to new RDS endpoint
kubectl set env deployment/mor-layer DB_HOST=forgepay-prod-restored.c9akciq32.us-east-1.rds.amazonaws.com

# 2. Restart services
kubectl rollout restart deployment/mor-layer

# 3. Verify data integrity
kubectl exec -it pod/mor-layer-xyz -- psql -c "SELECT COUNT(*) FROM checkout_sessions"

# 4. Once verified, delete old instance
aws rds delete-db-instance --db-instance-identifier forgepay-prod --skip-final-snapshot
```

**Backup Verification (weekly):**
```bash
#!/bin/bash
# Automated backup test - runs every Monday 3 AM UTC
BACKUP_SNAPSHOT=$(aws rds describe-db-snapshots \
  --db-instance-identifier forgepay-prod \
  --query 'DBSnapshots[0].DBSnapshotIdentifier')

# Restore to test instance
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier forgepay-backup-test \
  --db-snapshot-identifier $BACKUP_SNAPSHOT

# Test query after 10 minutes
sleep 600
psql -h forgepay-backup-test.c9akciq32.us-east-1.rds.amazonaws.com \
  -U $DB_USER -d forgepay -c "SELECT COUNT(*) FROM checkout_sessions" > /tmp/backup_test.log

# Clean up
aws rds delete-db-instance --db-instance-identifier forgepay-backup-test --skip-final-snapshot
```

---

### Kubernetes Cluster Recovery

**Scenario: Cluster becomes unhealthy (etcd corruption, network partition)**

```bash
# 1. Create new EKS cluster in same region
terraform apply -var="create_new_cluster=true" -auto-approve

# 2. Wait for cluster to be ready (~15 minutes)
aws eks describe-cluster --name forgepay-prod-new \
  --query 'cluster.status'

# 3. Deploy all Helm charts to new cluster
helm repo add forgepay file:///forgepay/infra/helm
helm install forgepay-stack forgepay/forgepay-stack \
  --namespace default \
  --values forgepay/infra/helm/values-prod.yaml \
  -f forgepay/infra/helm/values-mainnet.yaml

# 4. Update RDS security group to allow new cluster's security group
aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG_ID \
  --source-group $NEW_CLUSTER_SG_ID \
  --protocol tcp \
  --port 5432

# 5. Run database migration to ensure schema is up-to-date
kubectl run -it --rm debug --image=python:3.11 --restart=Never -- \
  alembic upgrade head

# 6. Verify all pods are running
kubectl get pods -n default

# 7. Update DNS to point to new cluster's load balancer
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch '{...}'  # Update ALB endpoint

# 8. Monitor error rate (should drop to <1% within 5 minutes)
# CloudWatch: checkout_success rate
```

**Post-Recovery Checklist:**
- [ ] All pods healthy (0 restarts)
- [ ] Database query latency < 100ms
- [ ] Redis responding (PING)
- [ ] Payment processing working
- [ ] Shielded checkout decrypting successfully
- [ ] Blockchain event listeners running
- [ ] Alerts firing and Slack integration working
- [ ] Delete old cluster once stable for 24 hours

---

### Regional Failover (us-east-1 → us-west-2)

**If entire us-east-1 region is down:**

**Pre-failover preparation (done quarterly):**
```bash
# 1. Replicate RDS snapshot to us-west-2
aws rds copy-db-snapshot \
  --source-db-snapshot-identifier forgepay-prod-snapshot \
  --target-db-snapshot-identifier forgepay-prod-snapshot-west \
  --source-region us-east-1 \
  --destination-region us-west-2

# 2. Create standby RDS instance in us-west-2 (stopped)
# Terraform: variable regional_failover_enabled = true

# 3. Pre-build EKS cluster in us-west-2 (scaled down to 0 nodes)
# Terraform: variable secondary_region_enabled = true, node_desired_size = 0
```

**Failover activation:**
```bash
# 1. Promote standby RDS to primary
aws rds promote-read-replica \
  --db-instance-identifier forgepay-prod-west-replica

# 2. Update RDS endpoint in Vault
vault kv patch secret/forgepay/database/postgres \
  host=forgepay-prod-west.c9akciq32.us-west-2.rds.amazonaws.com

# 3. Scale up EKS cluster in us-west-2
kubectl scale nodes --all --replicas=3 -n default

# 4. Deploy Helm charts
helm install forgepay-stack forgepay/forgepay-stack \
  --namespace default \
  --values forgepay/infra/helm/values-west.yaml

# 5. Update global DNS (CloudFlare)
curl -X PUT https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$DNS_RECORD_ID \
  -H "Authorization: Bearer $CLOUDFLARE_TOKEN" \
  -d '{"content":"api.us-west-2.forgepay.io","type":"CNAME"}'

# 6. Verify metrics in us-west-2 region
# DataDog: Filter by region=us-west-2
```

**RTO: ~45 minutes (mostly waiting for RDS promotion + EKS node startup)**

---

## Smart Contract Recovery

**Scenario: Critical bug in NullifierRegistry allows double-spending**

**Immediate Actions (first 5 minutes):**
```bash
# 1. PAUSE contract (multisig execution)
# Requires 2-of-3 approval from security council
multisig_execute "pause_nullifier_registry" $PAUSE_TRANSACTION_HASH

# 2. Stop all payment acceptance
kubectl scale deployment stablecoin-gateway --replicas=0
kubectl scale deployment crypto-gateway --replicas=0

# 3. Notify merchants + customers
# Post: #forgepay-status "Payment processing paused - investigating contract issue"
```

**Fix & Redeploy (1-2 hours):**
```bash
# 1. Fix bug in Solidity
# File: forgepay/infra/contracts/NullifierRegistry.sol

# 2. Test exhaustively on local hardhat fork
hardhat test --grep "double-spend prevention"

# 3. Deploy to testnet (Sepolia)
npm run deploy:testnet -- --network sepolia

# 4. Get security firm approval
# Slack: @security-auditors "Ready for review: PR #xyz"

# 5. Deploy to mainnet (multisig approval)
npm run deploy:mainnet -- --network ethereum --confirm

# 6. Verify on-chain
etherscan_verify_contract $NEW_NULLIFIER_REGISTRY_ADDRESS

# 7. Update Helm to point to new contract address
kubectl set env deployment/chain-sync \
  NULLIFIER_REGISTRY_ADDRESS=$NEW_REGISTRY_ADDRESS
kubectl set env deployment/stablecoin-gateway \
  NULLIFIER_REGISTRY_ADDRESS=$NEW_REGISTRY_ADDRESS

# 8. Resume payment processing
kubectl scale deployment stablecoin-gateway --replicas=2
kubectl scale deployment crypto-gateway --replicas=2

# 9. Monitor error rates
# Should drop to <1% within 10 minutes
```

---

## Auditor Key Compromise

**Scenario: Auditor secret key is leaked (e.g., developer's laptop stolen)**

**Immediate Actions (first 5 minutes):**
```bash
# 1. REVOKE current key (immutable on blockchain, but rotates in Vault)
vault kv put secret/forgepay/auditor/keys/current \
  status="REVOKED" \
  revoked_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  revocation_reason="SECURITY_INCIDENT"

# 2. Generate new keypair
NEW_SEED=$(openssl rand -hex 32)
vault kv put secret/forgepay/auditor/keys/current \
  seed="$NEW_SEED" \
  public_key="$(derive_x25519_public_key $NEW_SEED)" \
  activated_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  rotation_count=1

# 3. Log rotation event (immutable audit trail)
vault kv put secret/forgepay/auditor/keys/rotation-log \
  event_id="$(uuidgen)" \
  old_public_key="$OLD_PUBLIC_KEY" \
  new_public_key="$NEW_PUBLIC_KEY" \
  rotation_reason="SECURITY_INCIDENT" \
  initiated_by="$INITIATOR" \
  approved_by="$APPROVER" \
  effective_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

# 4. Restart auditor service to load new key
kubectl rollout restart deployment/mor-layer

# 5. Notify all merchants
# Email: "ForgePay Security Alert: Auditor key rotated"
```

**Post-incident Investigation:**
```bash
# 1. Determine who had access to compromised key
git log --all --grep="auditor.*key" --oneline

# 2. Audit all decryption events from compromised key
SELECT * FROM auditor_key_rotation_log
WHERE old_public_key = '$COMPROMISED_KEY'
ORDER BY created_at DESC;

# 3. Check if any fraudulent transactions occurred
# Filter checkout_sessions by created_at between key_activation and key_revocation
SELECT * FROM checkout_sessions
WHERE is_shielded = true
AND created_at BETWEEN $OLD_ACTIVATION AND $REVOCATION
AND audit_timestamp IS NOT NULL;

# 4. File security incident report
```

**Recovery Timeline:**
- 0–5 min: Revoke key + generate new key
- 5–15 min: Restart services + notify customers
- 15–60 min: Investigate unauthorized decryptions
- 1–24 hours: Post-incident analysis + remediation plan

---

## Testing & Validation

**Quarterly Disaster Recovery Drill:**

```bash
#!/bin/bash
# Q3 2026 DR Drill: Regional Failover Simulation

echo "Starting Q3 2026 DR Drill: us-east-1 → us-west-2 failover"

# 1. Snapshot current state
kubectl get nodes -o wide > /tmp/dr-drill-east-nodes.txt
kubectl get pods -A > /tmp/dr-drill-east-pods.txt

# 2. Trigger failover to us-west-2
# (This is a test, so we don't actually pause services)
echo "Simulating failover..."

# 3. Verify us-west-2 cluster comes up
kubectl --context=forgepay-west-2 get nodes
kubectl --context=forgepay-west-2 get pods -A

# 4. Run smoke tests against west-2
bash forgepay/tests/smoke-tests.sh --region us-west-2

# 5. Failback to us-east-1
echo "Failing back to us-east-1..."

# 6. Verify east-1 cluster is healthy
kubectl get nodes -o wide | wc -l

# 7. Record results
RTO_ACTUAL=$(date -d @$((END_TIME - START_TIME)) -u +'%H:%M:%S')
echo "DR Drill Complete. Actual RTO: $RTO_ACTUAL (Target: < 1 hour)"

# 8. File report
cat > /tmp/dr-drill-report-q3-2026.md << EOF
# Q3 2026 Disaster Recovery Drill Report

**Date:** $(date)
**Scenario:** Regional failover (us-east-1 → us-west-2)
**Actual RTO:** $RTO_ACTUAL
**Actual RPO:** 15 minutes (point-in-time recovery)
**Status:** PASS / FAIL

**Issues Found:**
- [ ] None
- [ ] RDS failover took longer than expected
- [ ] EKS nodes slow to boot
- [ ] DNS propagation delay

**Action Items:**
1. ...
2. ...
EOF

# 9. Upload report to S3
aws s3 cp /tmp/dr-drill-report-q3-2026.md s3://forgepay-backups/dr-reports/
```

**Sign-off Criteria:**
- [ ] Database recovered to specified point-in-time
- [ ] All pods healthy in 30 minutes
- [ ] Checkout endpoint responding
- [ ] Shielded checkout decrypting successfully
- [ ] Blockchain event listeners synced
- [ ] No data loss
- [ ] RTO < 1 hour

---

## Contact Information

**On-Call Engineer:** $ONCALL_EMAIL (Slack: #forgepay-oncall)
**VP Engineering:** engineering-lead@forgepay.io
**Incident Commander:** ops-team@forgepay.io

**Escalation:**
- T+15 min: Page VP Engineering
- T+30 min: Page CEO (if P1)
- T+1 hour: File incident report

---

## References

- [AWS RDS Disaster Recovery](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html)
- [Kubernetes Cluster Recovery](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
- [Smart Contract Security](https://docs.openzeppelin.com/contracts/5.x/)
- [ForgePay Incident Response Runbooks](./INCIDENT_RESPONSE.md)

