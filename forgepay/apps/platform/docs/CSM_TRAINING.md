# Customer Success Manager Training Guide

**Document Version:** 1.0  
**Last Updated:** 2026-06-28  
**Audience:** CSM Team, Account Managers, Retention Specialists

---

## Overview

This guide trains CSM team members to identify churn risk, execute retention playbooks, and maximize customer lifetime value.

---

## Part 1: Churn Risk Detection

### Where to Find Churn Signals

**Admin Dashboard:** https://forgepay.co.za/dashboard/admin
- **Churn Risk Queue:** Real-time alerts (HIGH, MEDIUM, CRITICAL)
- **Team Assignment:** Your assigned customers
- **Upsell Opportunities:** Cross-sell recommendations

**Analytics Dashboard:** https://forgepay.co.za/dashboard/analytics
- **Churn Rate:** Track by product, target <3%
- **Churn Signals:** MRR decline, API inactivity, cancellation requests
- **Email CTR:** Track campaign engagement

---

### Four Churn Signals to Monitor

#### Signal 1: Cancellation Request (CRITICAL)
```
Severity: 🔴 CRITICAL
Response Time: IMMEDIATE (same day)
Detection: Customer opens support ticket requesting cancellation
```

**Actions:**
1. Acknowledge receipt within 1 hour
2. Schedule call within 24 hours
3. Understand reason: pricing, features, competitive, or just testing?
4. Execute appropriate playbook (see Part 2)
5. Document outcome

---

#### Signal 2: MRR Decline >20% (HIGH)
```
Severity: 🟠 HIGH
Response Time: 4 HOURS
Detection: Monthly recurring revenue down 20%+ vs previous month
Example: Customer was paying R40K/mo, now R32K/mo
```

**Possible Reasons:**
- Downgraded plan (Treasury R40K → Payments R15K)
- Reduced usage or agent count
- Churn after trial period
- Budget freeze

**Actions:**
1. Review subscription history (when did change happen?)
2. Send email: "We noticed a change, wanted to check in"
3. Schedule call within 24 hours if no response
4. Offer pause/downgrade/discount options
5. Document in CRM

---

#### Signal 3: API Inactivity 7+ Days (MEDIUM)
```
Severity: 🟡 MEDIUM
Response Time: 24 HOURS
Detection: Payments product - no charges in 7 days
           Treasury product - no netting events in 7 days
```

**Possible Reasons:**
- Customer on vacation/pause
- Implementing internally
- Satisfied with competitor
- Forgotten about product

**Actions:**
1. Send check-in email with recent activity stats
2. Include quick tip: "Did you know you can..."
3. Offer free 14-day trial extension or walkthrough
4. If no response in 48 hours: Schedule low-pressure call
5. Document engagement level

---

#### Signal 4: Low Usage / Underutilization (LOW)
```
Severity: 🟢 LOW
Response Time: 48 HOURS
Detection: Customer not using key features
Example: Treasury customer with 5 agents but only settling 1
```

**Possible Reasons:**
- Didn't understand value prop
- Integration incomplete
- Feature missing for their use case
- Not trained on platform

**Actions:**
1. Send education email with ROI calculation
2. Offer video walkthrough of key features
3. Provide case study of similar customer
4. Suggest upsell opportunity if applicable
5. Document feature adoption

---

## Part 2: Retention Playbooks

### Playbook Selection Matrix

```
Churn Signal          → Recommended Playbook
─────────────────────────────────────────────
Cancellation Request  → Playbook 1 (Executive Call)
MRR Decline >20%      → Playbook 2 (Discount) or 3 (Downgrade)
API Inactivity 7d     → Playbook 4 (Extended Trial)
Low Usage            → Playbook 5 (Pause) or 6 (Custom Plan)
Budget Constraints   → Playbook 2 (Discount)
Competitive Threat   → Playbook 1 (Executive Call)
```

---

### Playbook 1: Executive Call (85% Retention)

**Use When:** CRITICAL churn risk, cancellation request, competitive threat  
**Duration:** 45 minutes  
**Expected Outcome:** 85% stay or downgrade gracefully

**Preparation (30 min before call):**
1. Review customer account history
2. Calculate customer lifetime value
3. Prepare ROI calculation for their use case
4. Check recent support tickets for pain points
5. Identify 1-3 potential improvements

**Call Structure:**

```
0-5 min:   Rapport building ("How's business? Using payments much?")
5-10 min:  Problem discovery ("Tell me what's not working...")
10-15 min: Acknowledge concerns ("I completely understand...")
15-25 min: Present solution ("Here's what we could do for you...")
25-40 min: Negotiate & close (commitment: stay, downgrade, or pause)
40-45 min: Follow-up (email next steps, schedule implementation)
```

**Talking Points:**
- "Your account is on track to save R[X] annually"
- "Here's what similar customers (Y) are doing..."
- "I'd like to personally ensure you succeed"
- "Let's do a custom plan/extended trial/pause"

**Follow-up:**
- Send call summary within 24 hours
- Schedule next check-in (30 days)
- Document decision in CRM

---

### Playbook 2: 10% Discount (6-Month Commitment) (72% Retention)

**Use When:** Budget constraints, price sensitivity  
**Discount:** 10% off for 6 months  
**Lock-in:** 6-month commitment (or 20% early termination fee)  
**Expected Outcome:** 72% retention rate

**Email Template:**

```
Subject: Special Offer - Committed Partnership Pricing

Hi [Name],

I noticed you're considering other options. Before you decide,
I'd like to offer a special rate reserved for our committed partners.

For the next 6 months, we can lock in **10% off** your current plan
in exchange for a 6-month commitment.

[Product] at 10% off:
- Payments: R13,500/mo → saves R18K
- Treasury: R36K/mo → saves R48K
- Bundle: R40.5K/mo → saves R54K

This offer is only valid for 48 hours. Reply to confirm.
```

**Follow-up if Accepted:**
1. Generate new SOW (Statement of Work) with discount
2. Send via DocuSign for signature
3. Update subscription in Kill Bill
4. Schedule kick-off call

**Follow-up if Declined:**
- Offer Playbook 3 (Downgrade) or Playbook 5 (Pause)
- Document: "Price-sensitive, may convert later"

---

### Playbook 3: Downgrade Tier (60% Retention)

**Use When:** Budget constraints, overprovisioned customer  
**Example:** Treasury R40K → Payments R15K  
**Expected Outcome:** 60% retention, upsell opportunity later

**Email Template:**

```
Subject: Tailored Plan for Your Current Usage

Hi [Name],

I reviewed your account and realized you might be better served with
a more tailored plan that matches your current usage.

We can downgrade to [Product] at [Price/mo], which includes:
- [Feature 1]
- [Feature 2]
- [Feature 3]

You can always upgrade later as your business grows.
Would you like to explore this option?
```

**Follow-up:**
- Update subscription in Kill Bill (auto-proration)
- Schedule 30-day check-in to discuss upsell
- Document as "downgrade - retention candidate"

---

### Playbook 4: Extended Trial (38% Retention)

**Use When:** Low usage, incomplete onboarding  
**Duration:** 14 additional free days  
**Expected Outcome:** 38% retention, gives customer more time to integrate

**Email Template:**

```
Subject: Let's Get You Up and Running - Extended Trial

Hi [Name],

I reviewed your account and noticed you haven't had much time to
explore [Feature]. I'd like to extend your trial by 14 days so you
can fully evaluate our platform.

During this extension:
- You'll get 14 extra days free
- I'll personally walk you through setup
- We'll identify quick wins in your workflow

No obligation. If it's not right, we'll part as friends.
Ready to give it another shot?
```

**Follow-up:**
1. Schedule 30-minute walkthrough (video call)
2. Set specific milestones: "Use X feature by Day 3"
3. Check in at Day 7: "How's it going?"
4. Pre-close at Day 13: "Ready to commit?"

---

### Playbook 5: 30-Day Pause (45% Retention)

**Use When:** Temporary budget constraint, seasonal business  
**Commitment:** Pause subscription for exactly 30 days  
**Cost:** Free (no charge for 30 days)  
**Expected Outcome:** 45% retention, keeps door open

**Email Template:**

```
Subject: Let's Pause and Regroup

Hi [Name],

I understand cash flow is tight right now. Here's what I propose:

**30-Day Pause Plan:**
- Your subscription pauses for exactly 30 days
- No charges during pause
- You keep your data and configuration
- On Day 31, we'll check in

This gives you breathing room without losing your setup.
Sound fair?
```

**Follow-up:**
- Mark calendar for Day 25 check-in call
- During pause, send monthly value emails (no hard sell)
- Day 25 call: "Ready to resume? Or need more time?"
- Document: "Paused - re-engage in [date]"

---

### Playbook 6: Custom Plan (90% Retention)

**Use When:** Enterprise customer, unique requirements  
**Process:** Custom negotiations required  
**Expected Outcome:** 90% retention, high-touch engagement

**Steps:**
1. Escalate to Founder/CEO
2. Understand customer's specific constraints
3. Design bespoke pricing/features
4. Present as "VIP Program"
5. Sign custom contract
6. Assign dedicated support

---

## Part 3: Upsell Opportunities

### Identify Upsell Triggers

**Trigger 1: Payment Customer → Add Treasury**
```
Condition: Payments customer with 10+ agents
Opportunity: Treasury (R40K/mo saves R114K/mo)
Approach: "You're processing X transactions. Let me show you 
           how Treasury automates agent payouts..."
```

**Trigger 2: Any Product → Add Credit Bureau**
```
Condition: Any customer with lending/credit decisions
Opportunity: Credit Bureau (R8.5K/mo + revenue share)
Approach: "I noticed you evaluate customer credit. Our scores 
           could improve your decision accuracy..."
```

**Trigger 3: Single Product → Bundle Discount**
```
Condition: Treasury + Credit Bureau separately
Opportunity: Bundle (R45K/mo saves R3.5K)
Approach: "If you commit to both for 12 months, we can offer 
           a R3.5K/mo bundle discount..."
```

### Upsell Process

1. **Identify** (look at Admin Dashboard Upsell Opportunities)
2. **Educate** (send case study or ROI calculator)
3. **Propose** (schedule 20-minute call)
4. **Present** (show specific features & pricing)
5. **Close** (offer 30-day free trial)
6. **Execute** (upgrade in Kill Bill, schedule onboarding)

---

## Part 4: Metrics & KPIs

### Track Your Performance

| KPI | Target | Your Score |
|-----|--------|-----------|
| Churn Rate (assigned customers) | <3% | __ |
| Avg Response Time to Churn Signal | <4 hours | __ |
| Retention Playbook Success Rate | 65%+ | __ |
| Upsell Conversion Rate | 15%+ | __ |
| Customer NPS | >50 | __ |

### Monthly Reporting

**Send to CSM Manager:**
```
CSM Scorecard - [Month]

Assigned Customers: 15
Churn Signals Handled: 3 (2 retained, 1 downgraded)
Upsells Closed: 1 (R40K/mo)
MRR Managed: R95K
Churn Rate: 2.1% (target: <3%)
Retention Playbook Success: 66.7% (2/3)

Highlights:
- Saved [Customer Name] with Playbook 1 (Executive Call)
- Upsold Treasury to [Customer]

Challenges:
- 1 customer escalated despite intervention
- Action: [next attempt]
```

---

## Part 5: Customer Communication Templates

### Email: Churn Risk Alert

```
Subject: Quick Check-In

Hi [Name],

I noticed your [Product] activity decreased last month. Everything OK?

Just want to make sure we're still delivering value. If there's
anything we can improve, I'd love to hear it.

Free to jump on a quick call this week?

[Link to calendar]
```

### Email: Retention Offer

```
Subject: Special Offer - Partnership Pricing

Hi [Name],

I reviewed your account and want to make sure we're a good fit.
I have a few ideas I think could help:

Option 1: [Discount]
Option 2: [Downgrade]
Option 3: [Pause]

Let's find the right fit. I'm free to chat [times].
```

### Email: Post-Call Summary

```
Subject: Next Steps - Call Summary

Hi [Name],

Thanks for taking the time yesterday. Here's what we discussed:

Your Challenge: [summarize]
Our Recommendation: [summarize]
Next Steps:
1. [Action item - CSM]
2. [Action item - Customer]
3. [Action item - Customer]

I'll follow up on [date]. Questions?
```

---

## Part 6: Emergency Escalation

### When to Escalate to Founder

**Escalate if:**
- CRITICAL churn risk (enterprise customer, >R50K/mo MRR)
- Cancellation request from top 10 customer
- Competitive threat (customer switching to competitor)
- Product complaint (critical feature missing)
- Contract/pricing negotiation needed

**Escalation Process:**
1. Document: situation, customer value, your recommendation
2. Send to Founder with subject: "CHURN ESCALATION - [Customer]"
3. Founder responds within 4 hours
4. Execute founder's recommendation
5. Document outcome

---

## Part 7: Shift Handoff Checklist

**At end of week, check:**
- [ ] All high-churn customers have action plans
- [ ] No overdue check-in calls
- [ ] Upsell opportunities documented
- [ ] Customer communications logged
- [ ] KPIs tracked and reported
- [ ] Competitive intelligence shared with team

**CSM Channel:** #csm-team (Slack)  
**Weekly Standup:** Monday 10am (Slack Huddle)  
**Monthly Reporting:** Last Friday of month

---

**Last Training:** 2026-06-28  
**Next Training:** 2026-07-12  
**Certified CSMs:** [list]
