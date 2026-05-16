# ForgePay Agent Services Runbooks

Operational playbooks for the autonomous-agent service stack:

| Service | Port | Role |
|---|---|---|
| `agent-identity` | 3010 | Agent registry, reputation scoring |
| `agent-negotiation` | 3011 | Quote → accept → pay → escrow flow |
| `agent-decision-framework` | 3013 | Risk scoring, autonomous-action policy gates |
| `agent-liquidity-manager` | 3014 | Multi-asset portfolio rebalancing, sweep/liquidate |
| `agent-credit-lines` | 3016 | Net-30/60 credit, draw + repay + default tracking |

---

## P2: Agent Decision Framework Returning Excessive Rejects

**Symptoms**
- `/v1/decisions/evaluate` returns `decision: 'reject'` for legitimate traffic
- Spike in `policy_violations` log entries
- Customer agent volume drops

**Immediate Actions**

1. **Inspect recent decisions:**
   ```bash
   curl http://agent-decision-framework:3013/v1/decisions/history?limit=50 | jq '.data[] | {agentId, decision, score, reasons}'
   ```

2. **Verify agent-identity reachability** — the risk scorer fetches reputation from agent-identity. If it's unreachable, scores default to 50 (high) which can trip approval thresholds:
   ```bash
   curl http://agent-identity:3010/health
   ```

3. **Check policy state:**
   ```bash
   curl http://agent-decision-framework:3013/v1/policies | jq '.data[] | select(.enabled == true)'
   ```

**Mitigations**

- If a policy was just added with too-strict thresholds, disable it: `PUT /v1/policies/:id` with `enabled: false`
- If agent-identity is down: restart its pod and verify reputation cache repopulates
- For an individual agent locked out by velocity: clear their window via `DELETE /v1/agents/:agentId/velocity` (admin endpoint)

---

## P2: Liquidity Manager Sweep Loop

**Symptoms**
- Same agent appears repeatedly in `/v1/agents/:id/history` with sweep + liquidate alternating every minute
- Yield-engine sees thrashing deposits/withdrawals
- Gas costs rise

**Immediate Actions**

1. Check the agent's policy:
   ```bash
   curl http://agent-liquidity-manager:3014/v1/agents/$AGENT_ID/policy
   ```
   Look for `minLiquidStableUsd` close to `autoLiquidateBelowUsd` — the hysteresis gap is too narrow.

2. **Pause auto-sweep** for the agent:
   ```bash
   curl -X PUT http://agent-liquidity-manager:3014/v1/agents/$AGENT_ID/policy \
     -H 'Content-Type: application/json' \
     -d '{"sweepEnabled": false}'
   ```

3. **Investigate root cause** — usually means target allocation drifts beyond the 2% rebalance threshold while another rule pulls in the opposite direction.

**Resolution**

Widen the gap so `autoLiquidateBelowUsd <= minLiquidStableUsd * 0.5`. Re-enable sweep.

---

## P1: Credit Line Mass Default

**Symptoms**
- `POST /v1/draws/check-overdue` reports `defaulted > 5` in a single cycle
- `/v1/agent/summary` shows default_rate climbing past 2%
- Alert: `agent_credit_lines.defaults_total` rate exceeded

**Immediate Actions**

1. **Freeze new draws** — set all active credit lines to suspended:
   ```bash
   curl http://agent-credit-lines:3016/v1/credit-lines | \
     jq -r '.data[] | select(.status == "active") | .id' | \
     xargs -I {} curl -X POST http://agent-credit-lines:3016/v1/credit-lines/{}/suspend
   ```

2. **Identify root cause:**
   ```bash
   curl http://agent-credit-lines:3016/v1/draws?status=defaulted | jq '.data[] | {agentId, amountUsd, defaultedAt}'
   ```

3. **Coordinate with agent-identity** — defaulted agents should have a reputation penalty applied (the credit-lines service does this automatically via `/v1/agents/:id/penalty`; verify it landed).

**Post-Incident**

- If defaults are concentrated in agents created in the last 7 days: tighten `assessAgent` thresholds in `src/assessor.ts`
- If defaults are concentrated by counterparty: add that counterparty to global blocklist in agent-decision-framework
- File incident report; review credit assessment matrix

---

## P3: Negotiation Stuck in `quoted` State

**Symptoms**
- `/v1/negotiations?status=quoted` shows sessions older than 24h
- Buyer agent reports "quote not accepted" or "no response"

**Diagnosis**

Quotes auto-expire after 24h. If they're stuck, the expiry sweep isn't running:
```bash
kubectl logs -n forgepay deploy/agent-negotiation --tail=200 | grep -i expire
```

**Mitigation**

Manually expire:
```bash
curl -X POST http://agent-negotiation:3011/v1/sessions/sweep-expired
```

If the issue recurs, check the setInterval cleanup loop in `src/index.ts`.

---

## On-Call Cheat Sheet

| Symptom | Likely Service | First Check |
|---|---|---|
| Agents can't pay | agent-decision-framework | `/v1/decisions/history` recent rejects |
| Yields not earning | agent-liquidity-manager | sweep history + yield-engine health |
| Credit applications failing | agent-credit-lines | agent-identity reachability |
| Reputation stale | agent-identity | DB persistence + recent transactions endpoint |
| Reports incomplete | institutional-reporting | upstream `data_source_errors` field |

## Escalation

- P1: page on-call → engineering-lead within 15 min
- P2: Slack #forgepay-agents → on-call within 30 min
- P3: file ticket in `agent-platform` board
