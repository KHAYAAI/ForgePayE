# Support Team Training Guide

**Document Version:** 1.0  
**Last Updated:** 2026-06-28  
**Audience:** Support Team, Ops, On-Call Engineer

---

## Overview

This guide trains support team members to monitor ForgePay platform health, respond to alerts, and execute escalation procedures.

---

## Part 1: Monitoring Dashboards

### Access the Ops Dashboard
- **URL:** https://forgepay.co.za/dashboard/ops
- **Credentials:** Support team account (MFA required)
- **Refresh Rate:** Auto-refresh every 30 seconds

### Key Metrics to Monitor

#### 1. System Health (Top Section)
```
✅ Operational   = Green light (normal)
🟡 Degraded      = Yellow light (monitor closely)
❌ Down          = Red light (emergency - escalate immediately)
```

**What to look for:**
- ✅ Payment Router: Should always be ✅ (99.97% uptime)
- ✅ Kill Bill Sync: Last sync should be <5 minutes old
- ✅ Email Queue: Queue depth should be <50 jobs
- ✅ Database: Uptime should be >99%

#### 2. Payment Metrics
```
Transactions/hour   : 100-300 normal, >500 = surge
Success Rate        : Target 99.7%, alert if <99%
Settlement Time     : Target <5s, alert if >10s
```

**If success rate drops:**
1. Check if fallback chain is active (Circle USDC usage should increase)
2. Check Stripe status page for outages
3. Verify ACH endpoints are responding
4. Escalate to Platform team if persists >5 min

#### 3. Kill Bill Sync Status
```
Last Sync: Should be within 5 minutes
Divergences: Should be 0 (if >0, sync is catching mismatches)
Reconciliations: Track how many divergences were auto-fixed
```

**If Last Sync >5 minutes:**
1. Click "Retry Sync" button
2. Wait 2 minutes, check again
3. If still failing, escalate to Platform team
4. Create ticket: "Kill Bill Sync Failed"

#### 4. Email Queue Depth
```
Normal: 0-10 jobs (processing quickly)
Alert: >50 jobs (slower than normal)
Critical: >200 jobs (queue backed up)
```

**If queue depth >50:**
1. Check if email processor is running (check Ops Dashboard)
2. Click "Restart Email Processor" if needed
3. Monitor for next 5 minutes
4. If doesn't improve, escalate

---

## Part 2: Alert Response Procedures

### Alert Types & Actions

#### CRITICAL: Payment Processing Failure (>1% failures)
```
ALERT: Payment Success Rate <99%
Severity: 🔴 CRITICAL
Action: IMMEDIATE
```

**Steps:**
1. Open Payments Dashboard
2. Check success rate by method (Stripe vs Circle)
3. If Stripe failing:
   - Check Stripe status page
   - Verify ACH connection settings
   - Restart unified-router pod if needed
4. Escalate to Platform team if not resolved in 5 min
5. Document in ticket: "Payment Failure Alert - [timestamp]"

---

#### CRITICAL: Kill Bill Sync Failed
```
ALERT: Kill Bill Sync Last Sync >10 minutes ago
Severity: 🔴 CRITICAL
Action: IMMEDIATE
```

**Steps:**
1. Login to Ops Dashboard
2. Check "Kill Bill Subscription Sync" section
3. Click "Retry Sync" button
4. Wait 2 minutes
5. If still failing:
   - Check Kill Bill service status (ask Platform team)
   - Verify database connectivity
   - Check Kill Bill API logs
6. Create ticket: "KB Sync Failure - Investigation Required"
7. Escalate to Engineering

---

#### HIGH: Email Queue Backed Up (>100 jobs)
```
ALERT: Email Queue Depth >100
Severity: 🟠 HIGH
Action: 10 MINUTES
```

**Steps:**
1. Check email processor status
2. Look for failed emails in dead letter queue
3. Click "Restart Email Processor"
4. Monitor queue for 5 minutes
5. If improving: no action needed
6. If still backing up:
   - Reduce outbound email volume (coordinate with marketing)
   - Restart email service
   - Create ticket for investigation
   - Do NOT clear queue without approval

---

#### MEDIUM: Support Ticket SLA Breach (>24 hours)
```
ALERT: Support Ticket SLA Breach
Severity: 🟡 MEDIUM
Action: 30 MINUTES
```

**Steps:**
1. Check Support Metrics dashboard
2. Identify which tickets are at risk
3. Prioritize high-value customers
4. Assign to available CSM or support agent
5. Add internal comment: "SLA Risk - Prioritized"
6. Follow up every 2 hours

---

### Escalation Matrix

```
Level 1: Support Team (You)
├─ Can: Monitor dashboards, restart queues, acknowledge alerts
├─ Cannot: Modify database, restart pods, change production config
└─ Escalate if: Issue persists >5 min

Level 2: Platform Team (Engineering)
├─ Can: Restart pods, debug API issues, check logs
├─ Cannot: Change AWS infrastructure
└─ Escalate if: Requires infrastructure changes

Level 3: Devops/Infrastructure
├─ Can: Scale EKS, restart database, change firewall rules
├─ Cannot: Make business decisions
└─ Escalate if: Financial impact or customer SLA breach

Level 4: Founder
├─ Called if: Entire system down, customer escalation
└─ Last resort: Approve emergency decisions
```

---

## Part 3: Troubleshooting Common Issues

### Issue: Payment Success Rate Dropped to 95%

**Diagnosis:**
```
1. Open Payments Dashboard
2. Look at "Success Rate by Method"
   - If Stripe ACH: 95%, Circle USDC: 99%
     → Stripe having issues
   - If Stripe ACH: 99%, Circle USDC: 95%
     → Circle having issues
   - If both: <97%
     → Likely network/routing issue
```

**Fix Steps:**
1. Check external provider status:
   - Stripe: https://status.stripe.com
   - Circle: https://status.circle.com
2. If external provider down: Add status page link to ticket, monitor their site
3. If external provider OK:
   - Restart unified-router deployment
   - Wait 2 minutes, check dashboard
   - If not improving, escalate to Platform team

---

### Issue: Kill Bill Subscription Out of Sync

**Diagnosis:**
```
Symptom: Customer says subscription canceled but dashboard shows active
1. Check Subscriptions table in ops dashboard
2. Look for divergence count >0
3. Check reconciliation log
```

**Fix Steps:**
1. Manual verification:
   - Check customer account in Kill Bill admin
   - Compare with Postgres subscription table
2. If Kill Bill is source of truth:
   - Click "Force Reconcile" to sync Postgres to Kill Bill
   - Verify in dashboard after 1 minute
3. Create ticket: "KB Divergence Resolved - [customer]"

---

### Issue: Email Notifications Not Received

**Diagnosis:**
```
1. Check email queue depth (should be <10)
2. Check if email is in dead letter queue
3. Check SMTP logs for bounce/rejection
```

**Fix Steps:**
1. If in queue: Monitor, likely will send within 5 min
2. If in dead letter queue:
   - Check SMTP error message
   - Common errors:
     - 550: Invalid recipient address
     - 421: Service unavailable
     - 451: Try again later (transient)
3. For invalid address: Coordinate with customer on email fix
4. For transient error: Manually retry from DLQ
5. Document: "Email Failed - [reason]"

---

## Part 4: Customer Communication

### When to Notify Customer

**Notify if:**
- Issue directly impacts their service (payment failures, sync delays)
- Outage lasting >15 minutes
- Data was affected

**Do NOT notify if:**
- Issue resolved within 5 minutes
- No customer impact (internal infrastructure)
- Monitoring alert, but service still functional

### Template Message

**Subject:** Incident Report - ForgePay Service

```
Hello [Customer],

We experienced a brief [Payment Processing / Subscription Sync] incident 
on [DATE] from [START_TIME] to [END_TIME] (UTC).

Impact: [describe what happened]
Root Cause: [brief explanation]
Resolution: [what we did to fix it]

We apologize for any inconvenience. Our team is implementing [preventive measure].

Questions? Reply to this email or contact support@forgepay.co.za
```

---

## Part 5: Shift Handoff Checklist

**At end of shift, check:**
- [ ] All systems green (Ops Dashboard)
- [ ] Kill Bill sync <5 min old
- [ ] Email queue depth <10
- [ ] No critical alerts active
- [ ] Log any issues in #on-call Slack channel
- [ ] Mention any in-progress tickets to next shift
- [ ] Update on-call handoff document

**On-Call Channel:** #on-call (Slack)  
**Escalation Number:** +27-11-XXX-XXXX  
**On-Call Email:** oncall@forgepay.co.za

---

## Part 6: SLA Targets

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Payment Success Rate | 99.7% | <99% |
| Settlement Time | <5s avg | >10s |
| Kill Bill Sync Freshness | <5 min | >10 min |
| Support Ticket Resolution | <24h | >24h |
| Email Delivery | 99% | <95% |
| System Uptime | 99.9% | <99% |

---

## Emergency Contacts

| Role | Name | Phone | Email |
|------|------|-------|-------|
| Platform Lead | [Name] | +27-11-XXX | platform@forgepay.co.za |
| DevOps Lead | [Name] | +27-11-XXX | devops@forgepay.co.za |
| Founder | [Name] | +27-82-XXX | founder@forgepay.co.za |

---

**Last Training:** 2026-06-28  
**Next Training:** 2026-07-05  
**Certified Team Members:** [list]
