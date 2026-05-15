# Runbook: RWA Registry Incident Response

## Service: rwa-registry (port 3008)

### Symptom: NAV refresh failing (prices stale)

**Cause:** Ondo/OpenEden API rate limit or outage.

**Resolution:**
1. Check last refresh: `GET /health` returns `last_nav_refresh` timestamp
2. If >6h stale: manually trigger `POST /v1/nav/refresh`
3. If still failing: check service logs for HTTP error codes
4. If provider API down: display last known NAV to merchants, add "prices may be delayed" banner

### Symptom: Income distribution not accruing

**Cause:** Daily job failed (every 24h at midnight UTC).

**Resolution:**
1. `kubectl logs -n forgepay-prod -l app=rwa-registry --tail=100 | grep "income"`
2. Manually trigger: `POST /v1/income/distribute`
3. Verify positions updated: `GET /v1/positions?merchantId=<any_active_merchant>`
4. If SQLite locked: restart pod (`kubectl rollout restart deployment/rwa-registry`)

### Symptom: Redemption not settling on time

**Cause:** Provider API delayed or settlement date changed.

**Resolution:**
1. `GET /v1/redemptions/{redemptionId}` — check settlement_date and status
2. If `status=pending` past settlement_date: contact Ondo/OpenEden support
3. Notify affected merchant via email
4. If >3 days past settlement: escalate to ForgePay ops team
