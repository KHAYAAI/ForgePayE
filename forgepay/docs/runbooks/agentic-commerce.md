# Runbook: Agentic Commerce Incident Response

## Service: agent-identity (port 3010) + agent-negotiation (port 3011)

### Symptom: Negotiation session stuck in "negotiating" state

**Cause:** One agent failed to respond (timed out or crashed).

**Resolution:**
1. Check session state: `GET /v1/sessions/{sessionId}`
2. If `status=negotiating` and `updated_at` is >30 min ago, session is stale
3. Force reject: `POST /v1/sessions/{sessionId}/reject` with `{"reason":"timeout","role":"system"}`
4. If escrow was created: check `GET /v1/escrow/{escrowId}`
5. If escrow is `funded`, manually trigger refund: `POST /v1/escrow/{escrowId}/refund`

### Symptom: Escrow USDC stuck (not released or refunded)

**Cause:** Smart contract interaction failed or dispute not resolved.

**Resolution:**
1. `GET /v1/escrow/{escrowId}` — check status and tx_hash
2. If `status=funded` and no release tx: check Base chain transaction manually
3. If dispute >3 days old: escalate to on-call engineers with escrow address
4. Manual release requires multi-sig admin key (stored in Vault: `forgepay/prod/escrow-admin-key`)

### Symptom: Agent discovery returns empty results

**Cause:** agent-identity pod restarted (in-memory state lost) or DB connection failed.

**Resolution (Phase 2 onward):**
1. `kubectl logs -n forgepay-prod -l app=agent-identity --tail=50`
2. If DB connection error: check PostgreSQL credentials in Vault
3. If pod OOMKilled: increase memory limit in Helm values
4. For immediate fix: agents must re-register (send alert to registered agent operators)
