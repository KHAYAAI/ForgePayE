# ForgePay Support Runbook

## Pre-Incident Checklist

Before handling any support ticket:
1. Verify customer has active license: `GET /v1/customer/products`
2. Check recent revenue events: filter by `customer_id` + `product` in dashboard
3. Check CSM notes: is this customer flagged as "at-risk"?

---

## Payments Issues

### Issue: Charge failed with 402 error (insufficient funds)

**Diagnosis:**
```
GET /api/v1/payments/charges/{chargeId}
→ Check status: "failed", reason: "insufficient_balance"
```

**Resolution:**
1. Customer needs to top up their payment method (their card/account)
2. Payments is acting as processor—we don't hold funds, Stripe does
3. Link: "Top up your payment method in Dashboard → Settings → Billing"

**Escalation:** Finance if customer disputes charge legitimacy

---

### Issue: Settlement doesn't appear in customer's bank account

**Diagnosis:**
```
GET /v1/customer/dashboard → check "last_settlement_date"
Check revenue_events for SETTLEMENT events in last 48h
```

**Resolution:**
1. **If settlement happened but not in bank:** ACH clearing takes 1-3 days
   - Share: "Settlement processed at {timestamp}. ACH clears in 1-3 business days."
   - Link: Hyperswitch ACH status page (if available)

2. **If no recent settlement:** 
   - Check if they have Payments revenue in last 30d
   - If yes, settlement should run nightly at 00:30 UTC
   - Ask: "When was your last charge?" and verify timestamp

3. **If settlement shows "pending":**
   - Likely Hyperswitch ACH pending
   - ETA: 24-48 hours
   - No action needed

**Escalation:** Hyperswitch support if pending >72h

---

### Issue: Webhook signature verification fails

**Diagnosis:**
Customer report: "POST /webhooks/payments returns 401 Unauthorized"

**Resolution:**
1. Verify customer has webhook configured: `GET /v1/payments/webhooks`
2. Check signature algorithm: should be HMAC-SHA256
3. Verify they're using correct signing key (not API key)
4. Resend webhook from dashboard → Webhooks → "Retry"

**Code example:**
```javascript
// Correct
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha256', WEBHOOK_SIGNING_SECRET)
  .update(request.body)
  .digest('hex');
```

**Escalation:** Engineering if still failing after resend

---

## Treasury Issues

### Issue: Netting settlement didn't run at scheduled time

**Diagnosis:**
```
GET /v1/treasury/positions → check last_settled timestamp
Query revenue_events where product='treasury' and event_type='SETTLEMENT' from last 24h
```

**Root causes:**
1. **No agents/positions to settle**
   - Settlement only runs if balance > R0 for ≥1 agent
   - This is by design (don't waste gas on zero settlements)
   - Resolution: "Settlement will run when you have pending balances."

2. **Settlement scheduled for wrong time**
   - Default: 22:00 UTC (check customer's config)
   - Check: Current UTC time vs scheduled time
   - Resolution: "You can change schedule in Dashboard → Treasury → Settings"

3. **OFAC flagged counterparties**
   - Check: `treasury_positions.ofac_status = 'flagged'`
   - Settlement delays by X hours (config-based)
   - Resolution: "Your settlement is delayed due to sanctions screening. It will proceed after {delay_hours}."

4. **Budget enforcer blocked**
   - Check: ForgeBudgetEnforcer contract on-chain
   - Issue: Agent daily/monthly limit exceeded
   - Resolution: "Agent {agentId} hit daily limit. Settlement will retry tomorrow."

**Escalation:** If OFAC flagged + customer disputes: compliance + CSM

---

### Issue: USDC/USDT conversion showing wrong FX rate

**Diagnosis:**
Customer reports: "I settled 1000 USDC but received 990 USD (should be 1-to-1)"

**Root cause:** Likely bridge slippage or FX fee

**Resolution:**
1. Check: which stablecoin? USDC vs USDT vs other?
2. Verify: FX rate used from Chainlink at settlement time
3. Share: "Slippage of 1% is normal on USDC<>USD conversions. No action needed."
4. If >2% slippage: escalate to MoR Layer team

---

### Issue: Counterparty isn't receiving settlement funds

**Diagnosis:**
- Check `treasury_positions.status` for that agent
- Check blockchain tx hash: did it land on-chain?
- Check recipient wallet: do they have receiving address configured?

**Resolution:**
1. If tx landed on-chain but not in recipient wallet:
   - Recipient address is wrong, or recipient hasn't claimed bridged USDC
   - Share: "Settlement landed on-chain at {tx_hash}. Recipient needs to claim via bridge UI."

2. If tx didn't land on-chain:
   - Check Stablecoin Gateway logs
   - Likely CircleAPI issue
   - Escalate to infrastructure team

---

## Credit Bureau Issues

### Issue: Agent score showing as 0 or not updated

**Diagnosis:**
```
GET /v1/credit-bureau/agents/{agentId}/score
→ Check "mode1_score" and "mode2_score"
→ Check "settled_on_chain" flag
```

**Root causes:**
1. **First settlement hasn't run yet**
   - Scores settle daily at 20:00 UTC
   - Ask: "When did you register the agent?"
   - Resolution: "First score settles tonight. Check back tomorrow at 20:01 UTC."

2. **Agent has no transaction history**
   - Mode 1 score requires payment history (defaults to 0)
   - Mode 2 score requires on-chain tx (defaults to 0)
   - Resolution: "Score is 0 because agent has no history yet. It will improve as they transact."

3. **Score shows high variance (Mode1 ≠ Mode2)**
   - If variance > 100pts, flagged for review
   - Expected: 40-60pt variance is normal
   - Resolution: "Variance is {variance} pts, which is {HIGH/MEDIUM/LOW} confidence. We're monitoring."

4. **On-chain score not updating despite settlements**
   - Check: ForgeReputationRegistry events on-chain
   - Likely: settlement.ts had frozen agent or batch revert
   - Check logs: `/v1/credit-bureau/settlements/{runId}/errors`
   - Resolution: "Settlement retry scheduled for next daily run."

**Escalation:** If agent is frozen incorrectly, escalate to Product

---

### Issue: "Why is FORGE score different from Stripe's machine learning score?"

**Answer:**
> FORGE uses a different model (Mode 1 + Mode 2 consensus) vs Stripe ML.
> 
> Mode 1 focuses on traditional credit (payment history, volume, age).
> Mode 2 focuses on operational metrics (on-chain success rate, compliance).
> 
> They're not comparable—use FORGE for agent scoring, Stripe for card default risk.

---

## Licensing & Billing Issues

### Issue: Customer trying to use /v1/treasury/positions but gets 403

**Diagnosis:**
```
GET /v1/customer/products
→ Check: products array includes 'treasury'?
```

**Root cause:**
- License not granted (didn't purchase)
- OR License expired (subscription canceled)
- OR Kill Bill sync issue

**Resolution:**
1. Check: is Treasury in their products? 
   - If NO: "You don't have Treasury licensed. Purchase here: {checkout_url}"
   - If YES: "Your license is active. Try again (30s cache)"

2. If still 403 after 60s:
   - Kill Bill sync delay
   - Escalate: "There's a slight billing sync delay. Trying again in 5 minutes."

---

### Issue: Subscription cancellation didn't take effect

**Diagnosis:**
```
GET /v1/customer/products
→ Check: products array
GET Kill Bill account subscriptions
→ Check: state (should be CANCELLED)
```

**Root causes:**
1. Kill Bill canceled subscription but Postgres not synced
   - Resolution: "Refresh your browser (we're syncing). Try again in 30 seconds."

2. Customer has multiple subscriptions (shouldn't happen)
   - Resolution: Contact support—engineering investigation needed

**Escalation:** Engineering if Postgres/Kill Bill out of sync

---

## Escalation Paths

### Level 1 → Level 2 (CSM)
- Customer angry about billing
- Feature request or product feedback
- Customer asking about enterprise terms
- At-risk customer (churn signals detected)

### Level 1 → Level 2 (Engineering)
- API 5xx errors (not 4xx)
- On-chain settlement not completing
- Webhook delivery failures
- Performance issues

### Level 1 → Level 2 (Compliance)
- OFAC false positive challenge
- Data privacy request
- Regulatory inquiry

---

## Quick Links

- **CSM Dashboard**: https://dashboard.forgepay.com/admin/csm
- **Kill Bill UI**: https://killbill.forgepay.com/admin (admin-only)
- **On-chain contracts**: https://sepolia.basescan.io (search ForgeReputationRegistry)
- **API Docs**: https://forgepay.com/docs/api
- **Status Page**: https://status.forgepay.com

