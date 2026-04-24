# ForgePay Incident Response Runbooks

On-call playbooks for common production incidents.

**On-call contacts:**
- Primary: #forgepay-oncall Slack channel
- Secondary: ops-team@forgepay.io
- Escalation: engineering-lead@forgepay.io

---

## Incident Severity Classification

| Severity | SLA | Impact | Examples |
|----------|-----|--------|----------|
| **P1 - Critical** | 15 min response | Total outage, data loss risk | MoR layer down, DB corruption |
| **P2 - High** | 30 min response | Degraded service, 50%+ user impact | Blockchain lag >5min, decryption failures |
| **P3 - Medium** | 2 hour response | Limited user impact, <5% affected | Single region down, slow API |
| **P4 - Low** | 24 hour response | Minor issue, cosmetic | UI typo, warning logs |

---

## P1: MoR Layer Down

**Symptoms:**
- `POST /v1/checkout/sessions/shielded` returns 502
- Datadog alert: "mor-layer HTTP error rate > 10%"

**Immediate Actions (first 5 minutes):**

1. **Confirm status:**
   ```bash
   kubectl get pods -n forgepay | grep mor-layer
   kubectl logs -n forgepay deploy/mor-layer --tail=100
   ```

2. **Check health endpoints:**
   ```bash
   curl https://checkout.forgepay.io/healthz
   curl https://checkout.forgepay.io/readyz
   ```

3. **Check dependencies:**
   ```bash
   # Database connectivity
   kubectl exec -it pod/mor-layer-xyz -- psql -h $DB_HOST -U $DB_USER -d forgepay -c "SELECT 1"
   
   # Vault connectivity
   kubectl logs -n forgepay pod/mor-layer-xyz | grep "vault\|secret"
   
   # Hyperswitch connectivity
   kubectl logs -n forgepay pod/mor-layer-xyz | grep "hyperswitch\|payment"
   ```

4. **Restart deployment:**
   ```bash
   kubectl rollout restart deployment/mor-layer -n forgepay
   kubectl rollout status deployment/mor-layer -n forgepay --timeout=5m
   ```

**If restart fails:**

5. **Check recent deployments:**
   ```bash
   kubectl rollout history deployment/mor-layer -n forgepay
   kubectl rollout undo deployment/mor-layer -n forgepay
   ```

6. **Check resource constraints:**
   ```bash
   kubectl top nodes
   kubectl top pods -n forgepay | grep mor-layer
   kubectl describe node <node-name>  # Look for "Pressure" or "Memory/Disk" conditions
   ```

7. **Scale down competing services if needed:**
   ```bash
   kubectl scale deployment stablecoin-gateway -n forgepay --replicas=1
   kubectl scale deployment crypto-gateway -n forgepay --replicas=1
   ```

**Root cause investigation:**
- Check recent code deployments: `git log --oneline -10`
- Review database migrations: `SELECT * FROM alembic_version`
- Check Vault key rotation: `vault kv get secret/forgepay/auditor/keys/current`
- Review error logs for exceptions: `kubectl logs -p pod/mor-layer-xyz` (previous logs)

**Communication:**
- Post in #forgepay-incidents: "MoR Layer Outage: [Status] - investigating DB/Vault/Hyperswitch"
- Notify billing team if affecting production checkout

---

## P2: Blockchain Lag >5 minutes

**Symptoms:**
- Datadog alert: "chain-sync lag > 5 blocks"
- `POST /shielded-deposits` timing out
- Nullifier events not recorded in DB

**Immediate Actions (first 10 minutes):**

1. **Check chain-sync service:**
   ```bash
   kubectl get pods -n forgepay | grep chain-sync
   kubectl logs -n forgepay pod/chain-sync-xyz --tail=50 | grep -E "lag|timeout|error"
   ```

2. **Check RPC provider status:**
   ```bash
   # Manually check RPC endpoints
   curl -X POST https://eth-mainnet.alchemyapi.io/v2/$ALCHEMY_KEY \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   
   # Do this for: Ethereum, Polygon, Base, Arbitrum
   ```

3. **Check contract state:**
   ```bash
   # Verify CommitmentTree root is updating
   etherscan_api_call "https://api.etherscan.io/api" \
     "?module=account&action=txlistinternal&address=$COMMITMENT_TREE_ADDRESS&startblock=0&endblock=99999999&sort=desc"
   
   # Should see recent `updateRoot()` transactions
   ```

4. **Increase RPC provider rate limits (if hitting limits):**
   ```bash
   # Edit Vault
   vault kv patch secret/forgepay/integrations/ethereum-rpc \
     rate_limit_requests_per_sec=100
   
   # Restart chain-sync to pick up new config
   kubectl rollout restart deployment/chain-sync -n forgepay
   ```

5. **Switch to backup RPC provider:**
   ```bash
   # If primary provider is down, failover to secondary
   QUICKNODE_ENDPOINT="$QUICKNODE_ETH_RPC"
   vault kv patch secret/forgepay/integrations/ethereum-rpc \
     endpoint=$QUICKNODE_ENDPOINT
   
   kubectl rollout restart deployment/chain-sync -n forgepay
   ```

**Long-term fix:**
- Scale up RPC provider tier
- Add multiple RPC providers with automatic failover
- Implement local Ethereum node for redundancy

---

## P2: Auditor Decryption Failures

**Symptoms:**
- Datadog alert: "auditor.decrypt_shielded_tx error rate > 1%"
- Customers report "Decryption failed" errors
- MoR layer returns 400 Bad Request

**Immediate Actions:**

1. **Check Vault connection:**
   ```bash
   kubectl exec -it pod/mor-layer-xyz -- \
     curl -H "X-Vault-Token: $VAULT_TOKEN" \
     https://vault.example.com/v1/secret/data/forgepay/auditor/keys/current
   ```

2. **Check auditor key status:**
   ```bash
   vault kv get secret/forgepay/auditor/keys/current
   
   # Verify key hasn't been rotated unexpectedly
   vault kv list secret/forgepay/auditor/keys/archive/
   ```

3. **Verify ECDH/AES-GCM implementation:**
   ```bash
   # Run test decryption
   kubectl exec -it pod/mor-layer-xyz -- python3 -c "
   from src.auditor import AuditorClient
   client = AuditorClient.from_seed('test_seed_xyz')
   # Should successfully load keypair
   "
   ```

4. **Check database corruption:**
   ```bash
   # Verify encrypted_memo in DB is not corrupted
   psql -h $DB_HOST -U $DB_USER -d forgepay -c "
   SELECT id, nullifier, encrypted_memo
   FROM checkout_sessions
   WHERE is_shielded = true AND created_at > NOW() - INTERVAL '1 hour'
   LIMIT 5"
   ```

5. **If all checks pass, restart auditor service:**
   ```bash
   kubectl rollout restart deployment/mor-layer -n forgepay
   ```

**Root cause investigation:**
- Check if Vault key was recently rotated: `vault kv list secret/forgepay/auditor/keys/archive/`
- Verify X25519 crate version hasn't changed: `cargo tree | grep x25519`
- Check if AES-GCM auth tag mismatches increased: `grep "auth_tag.*failed" /var/log/forgepay/*.log`

---

## P1: Smart Contract Bug / Double-Spend

**Symptoms:**
- Datadog alert: "NullifierRegistry: same nullifier recorded twice"
- Customer reports payment submitted twice
- On-chain explorer shows duplicate `PaymentConfirmed` events

**Immediate Actions:**

1. **STOP all proof submissions immediately:**
   ```bash
   kubectl scale deployment stablecoin-gateway -n forgepay --replicas=0
   kubectl scale deployment crypto-gateway -n forgepay --replicas=0
   ```

2. **Check NullifierRegistry state:**
   ```bash
   # Query on-chain state
   etherscan_call "https://api.etherscan.io/api?module=proxy&action=eth_call" \
     "to=$NULLIFIER_REGISTRY_ADDRESS&data=$CALLDATA_for_isSpent($NULLIFIER)" \
     | jq .result  # Should be false if not yet spent
   ```

3. **Verify contract logic (audit trail):**
   ```bash
   # Review recent NullifierRegistry.submitProof() calls
   etherscan_call "NullifierRegistry" "get_events" \
     "PaymentConfirmed" \
     "block_range=latest-1000" \
     | jq '.[] | select(.nullifier == "0x...")'
   ```

4. **If bug is confirmed, freeze the contract:**
   ```bash
   # Execute multisig transaction to pause NullifierRegistry
   # (Requires 2-of-3 approval from security council)
   multisig_propose "pause_nullifier_registry"
   ```

5. **Notify affected merchants & customers:**
   ```
   Subject: [SECURITY] ForgePay Deposit Pause - Investigating Issue
   
   Dear ForgePay Users,
   
   We've paused deposit acceptance while investigating a smart contract issue.
   Your funds are safe. No payments have been lost.
   
   Updates every 1 hour in #forgepay-status.
   ```

**Recovery steps (after fix deployed):**
1. Deploy patched contract to testnet
2. Run exhaustive test suite
3. Get security firm approval
4. Deploy to mainnet with multisig execution
5. Resume payment acceptance

**Post-incident:**
- Schedule security audit of contract logic
- Add formal verification for critical functions
- Implement emergency pause mechanism

---

## P2: Database Disk Full

**Symptoms:**
- Datadog alert: "RDS: Free space < 10%"
- Slow queries
- Write failures on checkout_sessions

**Immediate Actions:**

1. **Check disk usage:**
   ```bash
   aws rds describe-db-instances --db-instance-identifier forgepay-prod \
     | jq '.DBInstances[0].AllocatedStorage, .DBInstances[0].StorageType'
   ```

2. **Find large tables:**
   ```bash
   psql -h $DB_HOST -U $DB_USER -d forgepay -c "
   SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
   FROM pg_tables
   ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
   LIMIT 10;"
   ```

3. **Archive old data:**
   ```bash
   # Archive checkout_sessions older than 90 days
   psql -h $DB_HOST -U $DB_USER -d forgepay -c "
   CREATE TABLE checkout_sessions_archive_2026q1 AS
   SELECT * FROM checkout_sessions WHERE created_at < NOW() - INTERVAL '90 days';
   
   DELETE FROM checkout_sessions WHERE created_at < NOW() - INTERVAL '90 days';"
   
   # Backup archive to S3
   pg_dump forgepay > checkout_sessions_archive_2026q1.sql
   aws s3 cp checkout_sessions_archive_2026q1.sql s3://forgepay-backups/archives/
   ```

4. **Increase RDS storage:**
   ```bash
   aws rds modify-db-instance \
     --db-instance-identifier forgepay-prod \
     --allocated-storage 1000 \
     --apply-immediately
   
   # Monitor: aws rds describe-db-instances (wait for "Modifying" → "Available")
   ```

---

## P4: High API Latency

**Symptoms:**
- P99 latency > 2 seconds
- Datadog trace shows slow crypto operations

**Investigation:**

1. **Check CPU / Memory:**
   ```bash
   kubectl top pods -n forgepay | grep mor-layer
   kubectl describe pod mor-layer-xyz -n forgepay | grep -A 5 "Limits"
   ```

2. **Profile slow requests:**
   ```bash
   # Enable debug logging
   kubectl set env deployment/mor-layer DEBUG=1 -n forgepay
   
   # Capture slow requests
   kubectl logs -n forgepay pod/mor-layer-xyz | grep "duration_ms" | sort -t= -k2 -rn | head -5
   ```

3. **Optimize:**
   - Increase CPU requests for crypto-heavy workloads
   - Add Redis caching for auditor keys
   - Implement proof generation timeout (fallback to server)

---

## Escalation Path

**If incident is not resolved within SLA:**

1. **P1 (15 min):** Escalate to Engineering Lead
2. **P2 (30 min):** Escalate to VP Engineering + Customer Success
3. **P3+ (2+ hours):** Schedule incident postmortem

**All incidents require:**
- Root cause analysis
- Postmortem within 24 hours
- Action items assigned + tracked

---

## Communication Template

**Initial Alert (first 5 minutes):**
```
🚨 INCIDENT: [Service Name]
Severity: P[1-4]
Status: Investigating
Impact: [Description]
ETA: [Time estimate]
```

**Status Update (every 15 min for P1, 30 min for P2):**
```
✏️  UPDATE: [What we've learned]
Actions taken: [What we've done]
ETA: [Revised estimate]
```

**Resolution:**
```
✅ RESOLVED: [Root cause]
Mitigation: [What we did]
Follow-up: [Postmortem link]
```

---

## Appendix: Useful Commands

```bash
# Check all pod statuses
kubectl get pods -n forgepay -o wide

# Get events for debugging
kubectl get events -n forgepay --sort-by='.lastTimestamp'

# Scale services
kubectl scale deployment $SERVICE -n forgepay --replicas=$NUM

# Check Vault
vault kv list secret/forgepay/
vault kv get secret/forgepay/auditor/keys/current

# Check database
psql -h $DB_HOST -U $DB_USER -d forgepay -c "\dt"  # List tables
psql -h $DB_HOST -U $DB_USER -d forgepay -c "\dg"  # List roles

# Check blockchain events
curl -X POST $ETH_RPC_URL -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getLogs","params":[{"address":"$CONTRACT","fromBlock":"latest"}],"id":1}'

# View git diff of last deploy
git diff HEAD~1 HEAD --stat
```
