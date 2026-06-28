# ForgePay CSM Playbooks

## Product Overview

### FORGE Payments
- **Entry point**: Most customers start here
- **Buyer**: Finance/Ops leads or Payment processors
- **Motivation**: Lower fees, faster settlements
- **Upsell trigger**: GMV > R1.5M/month → suggest Treasury

### FORGE Treasury
- **Buyer**: Finance/Operations teams managing cash flow
- **Price**: R40K/month (R80K with Credit Bureau separate)
- **ROI**: 2-3 months to payback (saves R100K+ annually on netting)
- **Upsell trigger**: Multiple agents/vendors → suggest Credit Bureau

### FORGE Credit Bureau
- **Buyer**: Agent networks, fintech lending platforms
- **Price**: R8.5K/month (R17K with Treasury separate)
- **Revenue**: 25% of inquiry fees = passive income from lenders
- **Upsell trigger**: None (it's the final product)

---

## Playbook 1: Payments → Treasury (High-Volume Customers)

### Trigger
- Customer with Payments GMV > R1.5M/month
- No Treasury license yet

### Prep (Day 1)
1. Pull customer's last 30-day GMV from CSM dashboard
2. Calculate estimated netting savings: GMV * 2.5% = monthly savings
3. Check if they have multiple vendors/agents (enables Treasury ROI)

### Outreach (Day 2-3)
**Call script:**
> "Hi {name}, I noticed you're processing R{gmv}M/month with Payments. That's fantastic growth. 
> 
> Most customers at your volume use Treasury to automate vendor/agent settlements. You could save ~R{savings}K/month on netting fees.
> 
> Can we chat about whether that makes sense for you?"

**Email:** Day 0 → Day 7 → Day 14 with treasury-upsell sequence

### Closing
- Offer 14-day free trial (no card required)
- Pair with onboarding: 30-min call to wire Plaid + set netting schedule
- Expected close rate: 60-70% at GMV >R2M

---

## Playbook 2: Single Product → Bundle (Treasury + Credit Bureau)

### Trigger
Customer has both Treasury and Credit Bureau purchased separately

### Opportunity
- Save R3.5K/month (3.9% savings)
- Simpler billing (one Stripe line item instead of two)
- Bundled workflows: netting → credit bureau scoring

### Outreach
**Email subject:** "You're paying R48.5K/mo. We can help you save R3.5K."

**Body:**
> Hi {name},
>
> Quick billing optimization: bundling Treasury + Credit Bureau costs R45K/mo instead of R48.5K.
>
> That's R3.5K savings—paid for via link below:
> [Upgrade to Bundle Button]
>
> No downtime, instant effective date.

### Closing
- Click one button in CSM dashboard: `/api/v1/bundle/upgrade-to-bundle`
- Automated: old subscriptions canceled, bundle subscription created
- Customer sees billing change next invoice
- Close rate: 85%+ (it's pure savings)

---

## Playbook 3: Churn Prevention (At-Risk Customer)

### Trigger
- CSM dashboard flags customer as "at-risk" (MRR down >20% month-over-month)
- OR: subscription approaching cancellation date (Kill Bill alert)

### Root Cause Analysis
1. Check revenue events: which product saw usage decline?
2. Check support tickets: any recent issues?
3. Check CSM notes: did customer mention budget cuts or pivots?

### Intervention (Priority: High)
**Call script:**
> "Hi {name}, I saw your settlement volume dipped last month. Just checking in—everything okay?
> 
> [Listen for: budget pressure, technical issues, business pivot, or just seasonal]
> 
> If it's budget, let's talk about options. If it's technical, our support team can help today."

### Retention Options (in order of preference)
1. **Pause, don't cancel**: "Can we put it on hold for 30 days while you evaluate?"
2. **Downgrade**: "Move to lower tier temporarily" (only for Payments; T & CB are tier-less)
3. **Extend trial**: "Another 14 days free while you ramp usage?"
4. **Discount**: "10% off if you commit to 6 months?" (use sparingly)

### Avoid
- Hard sell another product (they're already churning)
- Blame them for low usage
- Make it hard to cancel

---

## Playbook 4: New Customer Onboarding (Org-wide)

### Day 0: Welcome email + product-specific onboarding flow
- Payments: 6 steps (tier → API key → test → go live)
- Treasury: 5 steps (bank connect → counterparties → OFAC → schedule → go live)
- Credit Bureau: 4 steps (agents → policy → webhooks → review → go live)

### Day 1: CSM intro call (30 min)
- Walk through their first transaction/settlement/score
- Set expectations: GMV threshold for upsell? Agent count for credit bureau?
- Get their phone number, Slack handle

### Day 7: Check-in email
- Celebrate: "You've processed R{amount}!" or "First settlement run!"
- Offer deeper training: docs, API, webhooks
- Soft upsell if metrics support it

### Day 30: Quarterly business review (QBR)
- Summarize: GMV, settlements, scores, cost savings
- Share: upsell recommendations from CSM dashboard
- Ask: "What's your priority for Q{next}?"

---

## Playbook 5: Enterprise Deals (Multiple Products + Custom Terms)

### Signals
- Customer asking for volume discounts
- Enterprise buyer (Fortune 500)
- Multi-year commitment interest
- Annual revenue >R5M

### Process
1. **Engage**: Hand off from product to Account Executive
2. **Scope**: Which products? Which tiers? Multi-year discount?
3. **Customize**: Kill Bill custom plans (e.g., "R50K/mo with 15% volume bonus")
4. **Close**: VP sign-off, then implement in Kill Bill

### Don't do:
- Promise features not in the roadmap
- Discount below 20% (erodes margin)
- Agree to 3-year without CAC payback guarantee

---

## Support Escalation Matrix

### Payments issues
- API errors, failed charges, webhooks → Support Tier 1 (Fastify knowledge)
- Fee disputes, settlement delays → Support Tier 2 + CSM sign-off

### Treasury issues
- Netting not running, OFAC false positives, FX conversion → Support Tier 1 (MoR Layer)
- Counterparty disputes → CSM + Finance

### Credit Bureau issues
- Score discrepancy, on-chain settlement delays → Support Tier 1 (Agent Credit Bureau svc)
- Mode 1 vs Mode 2 variance >100pts → Escalate to ML team for review

### Cross-product issues
- "Payments should feed treasury automatically" → Product Manager (future roadmap)
- "Why is my credit bureau score different from Stripe?" → Comparative analysis doc

---

## Support Team Training Checklist

- [ ] All three products overview (fees, pricing, use cases)
- [ ] Product-specific API docs (Payments charges, Treasury settlements, CB scores)
- [ ] Common integration errors and solutions
- [ ] How to check customer's license via `GET /v1/customer/products`
- [ ] Upsell triggers and how to flag CSM
- [ ] Churn prevention scenarios and de-escalation
- [ ] Dashboard navigation (onboarding flows, settings, API keys)
- [ ] Kill Bill account creation and subscription management (admin-only)

---

## CSM Dashboard Weekly Checks

**Every Monday:**
1. Login to CSM dashboard: `/admin/csm`
2. Review: "at-risk" customers (MRR down >20%)
3. Review: "high-upsell-potential" (GMV >1.5M, no Treasury)
4. Review: "bundle-eligible" (both Treasury + CB, not bundled)
5. Reach out to top 5 by urgency score

**Every Friday:**
- Summarize wins: new licenses, upgrades, bundle conversions
- Share in #sales Slack
- Celebrate: customer stories, ROI testimonials

