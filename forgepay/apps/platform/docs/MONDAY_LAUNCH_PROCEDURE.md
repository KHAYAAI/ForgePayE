# Monday Launch Procedure

**Launch Date:** Monday, Week 2, 2026  
**Launch Window:** 8:00 AM - 8:00 PM UTC  
**Target:** Payments Beta (50 customers)  
**Go/No-Go Decision:** Sunday 10pm UTC (final sign-off)

---

## PRE-LAUNCH (Sunday Night)

### Sunday 10pm UTC: Final Go/No-Go Decision

**Who decides:** Founder + Platform Lead + Support Lead  
**Decision format:** Slack vote in #leadership

```
@here Final Go/No-Go Decision for Monday 8 AM launch

All sign-offs complete:
☐ Platform health: PASS
☐ CSM readiness: PASS
☐ Support dashboards: PASS
☐ Customer acquisition: PASS
☐ Rollback plan: PASS

Founder decision: GO 🟢 or NO-GO 🔴

React to confirm GO:
🚀 = YES, LAUNCH
🛑 = NO, POSTPONE
```

**If NO-GO:** Postpone to following Monday, retest blockers.

**If GO:** Proceed to 8 AM launch.

---

### Sunday 11pm UTC: Pre-Deployment Checks

**Owner:** Engineering Lead + On-Call Engineer

#### Final Infrastructure Verification
```bash
# 1. Verify EKS cluster is healthy
kubectl get nodes -A
# Expected: All Ready

# 2. Verify all pods running
kubectl get pods -n forgepay
# Expected: All Running, none Pending/CrashLoopBackOff

# 3. Verify database is healthy
aws rds describe-db-instances --db-instance-identifier forgepay-prod \
  --query 'DBInstances[0].DBInstanceStatus'
# Expected: available

# 4. Verify Redis is healthy
redis-cli -h <endpoint> PING
# Expected: PONG

# 5. Verify no alerts
aws cloudwatch describe-alarms --state-value ALARM
# Expected: Empty

# 6. Verify API responding
curl https://api.forgepay.co.za/api/health -v
# Expected: HTTP 200, <1s latency
```

**Checklist:**
- [ ] All infrastructure green
- [ ] All services responding
- [ ] No active alarms
- [ ] Database backups current
- [ ] Rollback plan tested

**Send message to Slack #ops-alerts:**
```
✅ READY FOR LAUNCH
All systems green. Team standby Monday 8 AM.

Platform: ✅
Database: ✅
Monitoring: ✅
Rollback: ✅

Standby team:
- On-call: [Name]
- Support: [Names]
- CSM: [Names]
- Founder: [Name]

Meet in #ops-war-room Monday 8 AM UTC.
```

---

## MONDAY LAUNCH

### 7:00 AM UTC: War Room Opens

**Location:** Slack #ops-war-room  
**Attendees:** Founder, Platform Lead, Support Lead, CSM Lead, On-Call Engineer, Product Manager

```
@channel LAUNCH DAY - 1 HOUR TO GO

Timeline:
- 8:00 AM: Final checks + Deploy
- 8:30 AM: Customer emails send
- 10:00 AM: Monitor dashboards
- 2:00 PM: Customer report meeting
- 8:00 PM: Day 1 wrap-up

Everyone present? React ✅

Founder - Ready to announce?
Platform - Ready to deploy?
Support - Dashboard access working?
CSM - Teams in place?
Engineer - Rollback ready?
```

---

### 8:00 AM UTC: DEPLOY TO PRODUCTION

**Owner:** Platform Lead + On-Call Engineer

#### Step 1: Pre-Deployment Sanity Check (5 min)
```bash
# Verify no changes since Sunday night
git log --oneline -1
# Expected: Same commit as Sunday 11pm

# Verify image is in ECR
aws ecr describe-images --repository-name forgepay/platform \
  --query 'imageDetails[0].imageTags'
# Expected: Current version tag present

# Verify current pods
kubectl get pods -n forgepay
# Expected: 3 platform pods running, current version
```

#### Step 2: Deploy via Helm (3 min)
```bash
# Update Helm release
helm upgrade --install platform forgepay/infra/helm/platform \
  --namespace forgepay \
  --values forgepay/infra/helm/platform/values-prod.yaml \
  --set image.tag=<CURRENT_TAG>

# Expected output:
# Release "platform" has been upgraded. Happy Helming!
```

**Log to Slack:**
```
🚀 DEPLOYING TO PRODUCTION
Image: [tag]
Time: 8:00 AM UTC
Deploying: 3 replicas
Estimated time: 2 minutes
```

#### Step 3: Wait for Rollout (3 min)
```bash
# Monitor rollout status
kubectl rollout status deployment/platform -n forgepay --timeout=5m

# Expected: "deployment "platform" successfully rolled out"

# Verify all pods healthy
kubectl get pods -n forgepay -o wide
# Expected: 3 Running, Ready 1/1, Age 0-2min

# Check pod logs for errors
kubectl logs -n forgepay deployment/platform --tail=20
# Expected: No ERROR level messages
```

**Watch for:**
- ❌ CrashLoopBackOff: Rollback immediately
- ❌ ImagePullBackOff: Rollback immediately
- ❌ OOMKilled: Rollback immediately
- ✅ All pods Running: Continue

#### Step 4: Smoke Test (2 min)
```bash
# Test API health
curl -i https://api.forgepay.co.za/api/health
# Expected: HTTP 200, response <500ms

# Test auth endpoint
curl -X POST https://api.forgepay.co.za/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","name":"Test","password":"Test123456"}'
# Expected: HTTP 201

# Test dashboard
curl https://api.forgepay.co.za/api/dashboard/payments
# Expected: HTTP 200, live metrics

# Test webhooks
curl https://api.forgepay.co.za/api/health/readiness
# Expected: HTTP 200
```

**Log results to Slack:**
```
✅ DEPLOYMENT COMPLETE
All pods healthy: 3/3 Running
API responding: <500ms latency
Smoke test: PASS

Now monitoring metrics...
```

#### Step 5: Initial Monitoring (5 min)
```bash
# Watch key metrics spike

# Transactions (should remain <1/sec for now)
kubectl logs -n forgepay deployment/platform \
  --tail=100 | grep -i transaction

# Errors (should be 0)
aws cloudwatch get-metric-statistics \
  --namespace ForgePay \
  --metric-name ErrorCount \
  --statistics Sum \
  --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60

# Expected: No spikes, stable traffic
```

**Checklist:**
- [ ] Deployment complete
- [ ] All pods healthy
- [ ] Smoke tests pass
- [ ] No errors in logs
- [ ] Metrics normal

**Decision:** ✅ PROCEED TO CUSTOMER ACTIVATION

---

### 8:30 AM UTC: SEND CUSTOMER LAUNCH EMAILS

**Owner:** Founder + Product Manager

#### Email Campaign #1: Launch Announcement

**To:** All 50 beta customers  
**Subject:** You're In! 🎉 ForgePay Payments is Live

```
Hi [Name],

We're thrilled to announce that ForgePay Payments is now available!

You have exclusive early access to our beta. This is your moment to:
✅ Process your first payment
✅ See live dashboards
✅ Experience 99.7% success rates

Get started in 2 minutes:
[Link to https://forgepay.co.za/dashboard/payments]

What to do first:
1. Create a test payment (try R100 ZAR)
2. Watch it settle in <5s
3. See it in your dashboard
4. Reply with questions

We're online all day to help.

Best,
[Founder Name]
CEO, ForgePay
```

**Send at:** 8:30 AM UTC exactly

**Expected response:**
- 50% open rate (25 opens)
- 30% click rate (15 clicks)
- 5-10 immediate test payments

**Track in:**
- Mailchimp analytics
- Dashboard transaction log
- Slack #launches channel

---

### 10:00 AM UTC: CLOSE MONITORING & GATHER METRICS

**Owner:** Support Lead + On-Call Engineer  
**Duration:** 10:00 AM - 2:00 PM (4 hours)

#### Every 15 Minutes: Metrics Check
```bash
# Check dashboard metrics
curl https://api.forgepay.co.za/api/dashboard/payments

# Expected after 30 min:
{
  "transactions24h": 5,
  "successRate": 99.7,
  "fallbackRate": 0,
  "avgSettlementTime": 2.1,
  "totalGMV": 2500,
  "topPaymentMethods": [
    {"method": "stripe", "count": 5, "rate": 100}
  ]
}

# Log to Slack every 15 minutes
curl https://hooks.slack.com/services/XXX -d "{
  \"text\": \"15-min update: 5 txns, 99.7% success, 0 errors\",
  \"channel\": \"#ops-war-room\"
}"
```

#### Watch For Issues

**If payment success <99%:**
```
☐ Check Stripe status page
☐ Verify ACH connectivity
☐ Activate Circle USDC fallback
☐ Page on-call engineer
☐ Notify customers of manual option
```

**If error rate >1%:**
```
☐ Check API logs for errors
☐ Review application metrics
☐ Check database performance
☐ Prepare rollback if persistent
```

**If <3 customers test payment:**
```
☐ Check email delivery
☐ Send manual follow-up email
☐ Check Slack #launches for engagement
☐ Founder calls warm contacts
```

**If Kill Bill sync fails:**
```
☐ Trigger manual sync
☐ Verify API connectivity
☐ Check KB status
☐ Escalate if unresolved
```

#### Create War Room Update

**Slack message every hour:**
```
📊 1-HOUR UPDATE

Customers: 50 activated
Tests: 8 payments processed
Success Rate: 99.7%
Errors: 0
Response Time: 2.3s avg

Dashboards: ✅ All green
Alerts: None active
On-call: Standing by

Next check: 11 AM
```

---

### 2:00 PM UTC: CUSTOMER REPORT MEETING

**Owner:** Founder + CSM Lead  
**Attendees:** All stakeholders  
**Duration:** 1 hour

#### Agenda

1. **Launch Metrics (10 min)**
   - Customer activation: 50/50 ✅
   - Payments processed: 8-15 expected
   - Success rate: Target 99.7%
   - Key learnings so far

2. **Support & CSM Update (15 min)**
   - Customer feedback themes
   - Support tickets: 0-2 expected
   - Churn risk signals: None expected
   - CSM next steps

3. **Technical Health (10 min)**
   - API performance: <3s latency
   - Database: Healthy
   - Email queue: Normal
   - KB sync: On-time

4. **Decisions & Next Steps (15 min)**
   - Continue monitoring through Week 1?
   - Scale to Treasury by Week 3?
   - Any issues for follow-up?
   - Celebrate 🎉

5. **Contingencies (10 min)**
   - How's rollback looking?
   - What would trigger rollback?
   - Any last-minute concerns?

#### Decision: Continue or Rollback?

**Continue if:**
- ✅ Success rate >98%
- ✅ <2 critical support issues
- ✅ <10% churn already
- ✅ No data loss
- ✅ Systems stable

**Rollback if:**
- ❌ Success rate <95%
- ❌ >5 critical issues
- ❌ Data integrity concern
- ❌ Security incident
- ❌ Founder decision

---

### 8:00 PM UTC: DAY 1 WRAP-UP

**Owner:** All leads  
**Duration:** 30 minutes

#### Final Metrics

```
LAUNCH DAY RESULTS

PAYMENTS PROCESSED: [X/50]
  Success rate: [Y%]
  Avg settlement: [Zs]
  Errors: [N]

CUSTOMERS ACTIVE: [50/50]
  Tested payments: [X]
  Real payments: [Y]
  Churn risk: 0

SYSTEMS: ALL HEALTHY
  API: ✅
  Database: ✅
  Email: ✅
  KB Sync: ✅
  Monitoring: ✅

SUPPORT TICKETS: [N]
CRITICAL ISSUES: 0
ROLLBACK TRIGGERED: NO

DECISION: 🟢 CONTINUE TO WEEK 2
```

#### End-of-Day Slack Announcement

```
🎉 DAY 1 LAUNCH SUCCESS 🎉

50 customers activated
[X] payments processed
99.7% success rate
0 critical issues

Amazing work today, team! 🚀

Week 1 focus: Monitor, support, celebrate wins.
Week 3 goal: Scale to Treasury + Credit Bureau.

Standby schedule:
- Mon-Fri: Full team
- Sat-Sun: On-call only

Next standup: Tuesday 10 AM UTC
```

---

## WEEK 1 OPERATIONS

### Daily Standup
**Time:** Tuesday-Friday 10 AM UTC  
**Location:** Slack #ops-war-room  
**Duration:** 15 minutes

```
Metrics:
- Payments processed (YTD)
- Success rate (target: 99.7%)
- Churn risk signals (target: 0)
- Support tickets (SLA tracking)

Issues:
- Any critical alerts?
- Any churn signals?
- Any support blockers?

Next steps:
- Anything for today?
- Tomorrow priorities?
```

### Weekly Revenue Tracking
**Day:** Friday 5 PM UTC  
**Owner:** Finance/Founder

```
WEEK 1 RESULTS

Customers: 50 (all retained) ✅
Revenue: R750K MRR ✅
Payments: [X] processed ✅
Success: [Y]% ✅

Prep for Week 2:
- Monitor payments trend
- Identify hot prospects
- Plan Treasury beta
```

### Post-Launch Review
**Day:** Friday EOD  
**Owner:** All leads

```
What went well:
☐ [Success story 1]
☐ [Success story 2]
☐ [Success story 3]

What to improve:
☐ [Issue 1]
☐ [Issue 2]
☐ [Issue 3]

Lessons learned:
☐ [Learning 1]
☐ [Learning 2]

For Week 2:
☐ Action item 1: Owner, deadline
☐ Action item 2: Owner, deadline
☐ Action item 3: Owner, deadline
```

---

## SUCCESS CRITERIA

### Day 1 (Monday)
- [ ] 50 customers activated
- [ ] >90% email open rate
- [ ] >3 test payments
- [ ] 0 critical errors
- [ ] All systems green

### Week 1 (Mon-Fri)
- [ ] All 50 customers stay
- [ ] >5 real payments processed
- [ ] >99% success rate
- [ ] <5 support tickets
- [ ] <2 churn risk signals

### Post-Week 1 (Fri EOD)
- [ ] Revenue: R750K MRR
- [ ] Payments running smoothly
- [ ] CSM team ready for Treasury
- [ ] Support team trained
- [ ] Ready to scale Week 3

---

## GO/NO-GO DECISION MADE

**Date:** Sunday 10pm UTC  
**Decision:** 🟢 GO FOR LAUNCH

**Signatures:**
- Platform Lead: _______
- Support Lead: _______
- CSM Lead: _______
- Founder: _______

---

**LAUNCH IS LIVE** 🚀  
**Proceed with confidence.**  
**Stand by for Week 2 expansion.**
