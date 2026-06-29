# Pre-Launch 48-Hour Verification (Friday-Sunday)

**Launch Date:** Monday, Week 2  
**Verification Window:** Friday 5pm - Sunday 11pm UTC  
**Decision Deadline:** Sunday 11:59pm UTC

---

## 1. PLATFORM LEAD: System Health Check

**Owner:** Platform Engineering Lead  
**Timeline:** Friday 5pm-8pm UTC (3 hours)  
**Goal:** Verify all core systems operational, no degradation

### Checklist

#### A. API Health (30 min)
```bash
# Test each endpoint
curl https://api.forgepay.co.za/api/health
# Expected: HTTP 200, uptime >99.9%

curl -X POST https://api.forgepay.co.za/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","name":"Test","password":"Test123456"}'
# Expected: HTTP 201, user created

curl https://api.forgepay.co.za/api/dashboard/payments
# Expected: HTTP 200, live metrics returned
```

**Pass Criteria:**
- [ ] All endpoints responding <1s
- [ ] No 5xx errors
- [ ] All metrics populated
- [ ] Database connections healthy

#### B. Database Health (20 min)
```bash
# Check RDS status
aws rds describe-db-instances --db-instance-identifier forgepay-prod \
  --query 'DBInstances[0].[DBInstanceStatus,Engine,MultiAZ,BackupRetentionPeriod]'
# Expected: available, PostgreSQL, true, 30
```

**Pass Criteria:**
- [ ] Status: `available`
- [ ] Multi-AZ: enabled
- [ ] Backup retention: 30 days
- [ ] Free storage: >50GB
- [ ] CPU: <30%
- [ ] Connections: <100/max 200

#### C. Kubernetes Cluster (20 min)
```bash
# Check EKS status
aws eks describe-cluster --name forgepay-prod \
  --query 'cluster.[name,status,resourcesVpcConfig.subnetIds]'
# Expected: ACTIVE, 3 subnets (multi-AZ)

# Check pod status
kubectl get pods -n forgepay
# Expected: All Running, none Pending/CrashLoopBackOff

# Check node status
kubectl get nodes
# Expected: All Ready, all SchedulingEnabled
```

**Pass Criteria:**
- [ ] Cluster status: ACTIVE
- [ ] All nodes: Ready
- [ ] All pods: Running
- [ ] No pending pods
- [ ] No node pressure

#### D. Redis Cluster (15 min)
```bash
# Check Redis health
redis-cli -h <redis-endpoint> PING
# Expected: PONG

redis-cli -h <redis-endpoint> INFO stats
# Expected: connected_clients <50, keys_in_database shows email queue
```

**Pass Criteria:**
- [ ] PING response: PONG
- [ ] Connected clients: <50
- [ ] Queue depth: <10 jobs
- [ ] No evictions
- [ ] Memory usage: <70%

#### E. Load Balancer (15 min)
```bash
# Check ALB status
aws elbv2 describe-load-balancers --names forgepay-alb \
  --query 'LoadBalancers[0].[State,Scheme]'
# Expected: active, internet-facing

# Check target groups
aws elbv2 describe-target-groups --load-balancer-arn <arn> \
  --query 'TargetGroups[0].[HealthCheckEnabled,Matcher.HttpCode]'
# Expected: true, 200-299
```

**Pass Criteria:**
- [ ] ALB state: active
- [ ] Health checks: enabled
- [ ] Targets: all healthy
- [ ] No unhealthy targets

#### F. Monitoring & Alerts (10 min)
```bash
# Check CloudWatch alarms
aws cloudwatch describe-alarms --alarm-name-prefix forgepay \
  --query 'MetricAlarms[].StateValue'
# Expected: OK (no ALARM)

# Check Slack integration
# Manually send test alert to #ops-alerts channel
```

**Pass Criteria:**
- [ ] No alarms in ALARM state
- [ ] Slack integration working
- [ ] SNS topics active
- [ ] All metric dashboards populated

#### G. Security Verification (15 min)
```bash
# Check SSL/TLS certificate
openssl s_client -connect api.forgepay.co.za:443 -servername api.forgepay.co.za \
  | openssl x509 -noout -dates
# Expected: notBefore before today, notAfter after today

# Check WAF rules
aws wafv2 describe-web-acl --name forgepay-waf --scope REGIONAL
# Expected: active, rules present
```

**Pass Criteria:**
- [ ] SSL certificate valid
- [ ] TLS 1.3 enabled
- [ ] WAF rules active
- [ ] No security groups blocking traffic

### Sign-Off

**Platform Lead:** ___________________  
**Timestamp:** ___________________  
**Overall Result:** ☐ PASS ☐ FAIL

**If FAIL:** Document issue, notify team, troubleshoot, retest.

---

## 2. CSM LEAD: Retention Playbook Readiness

**Owner:** CSM Team Lead  
**Timeline:** Saturday 10am-1pm UTC (3 hours)  
**Goal:** Verify all CSMs ready to execute retention playbooks

### Checklist

#### A. Playbook Documentation (30 min)
```
All 6 playbooks documented and accessible?
☐ Playbook 1: Executive Call (85% retention)
☐ Playbook 2: 10% Discount (72% retention)
☐ Playbook 3: Downgrade Tier (60% retention)
☐ Playbook 4: Extended Trial (38% retention)
☐ Playbook 5: 30-Day Pause (45% retention)
☐ Playbook 6: Custom Plan (90% retention)

All templates prepared?
☐ Churn alert email
☐ Retention offer email
☐ Follow-up call script
☐ Post-call summary email
☐ CRM task templates
```

**Pass Criteria:**
- [ ] All 6 playbooks in Google Drive / Notion
- [ ] All email templates in Mailchimp
- [ ] Call scripts printed and available
- [ ] CRM fields configured for playbook tracking

#### B. Team Certification (60 min)
```
Each CSM tested on playbook execution:

CSM #1: ___________________
☐ Can identify churn signals
☐ Knows which playbook to use
☐ Can send retention email
☐ Can schedule follow-up call
Score: __/4 (must pass 4/4)

CSM #2: ___________________
☐ Can identify churn signals
☐ Knows which playbook to use
☐ Can send retention email
☐ Can schedule follow-up call
Score: __/4 (must pass 4/4)

CSM #3: ___________________
☐ Can identify churn signals
☐ Knows which playbook to use
☐ Can send retention email
☐ Can schedule follow-up call
Score: __/4 (must pass 4/4)
```

**Pass Criteria:**
- [ ] All CSMs scored 4/4
- [ ] All can execute playbook workflow
- [ ] All understand escalation path

#### C. Tools Access (30 min)
```
Admin Dashboard access verified?
☐ CSM #1: ___________________  Password reset ☐
☐ CSM #2: ___________________  Password reset ☐
☐ CSM #3: ___________________  Password reset ☐

CRM system ready?
☐ Churn risk queue created
☐ Retention playbook field added
☐ Upsell opportunities viewable
☐ Customer MRR tracking enabled

Communication tools?
☐ Slack #csm-team working
☐ Email templates in Mailchimp
☐ Calendar integration working
☐ Customer notes system ready
```

**Pass Criteria:**
- [ ] All CSMs can login to Admin Dashboard
- [ ] All dashboards loading
- [ ] All email templates tested
- [ ] All communication channels working

#### D. Customer Assignment (30 min)
```
50 beta customers assigned to CSMs?

Assignments for 50 Payments customers:

CSM #1: ___________________
Assigned: 17 customers (R28.5K MRR)
☐ Customer list pulled
☐ Intro emails drafted
☐ Initial contact scheduled

CSM #2: ___________________
Assigned: 16 customers (R24K MRR)
☐ Customer list pulled
☐ Intro emails drafted
☐ Initial contact scheduled

CSM #3: ___________________
Assigned: 17 customers (R25.5K MRR)
☐ Customer list pulled
☐ Intro emails drafted
☐ Initial contact scheduled
```

**Pass Criteria:**
- [ ] All 50 customers assigned (roughly equal distribution)
- [ ] Intro emails drafted
- [ ] First check-in calls scheduled
- [ ] Customer context documented

#### E. Escalation Chain (20 min)
```
Is escalation clear?

If customer at risk, CSM escalates to:
☐ Founder (if CRITICAL: cancellation request, >R50K customer)
☐ Platform team (if technical issue)
☐ Support team (if customer issue)

Escalation email templates prepared?
☐ Urgent escalation template
☐ Founder contact info listed
☐ On-call number available
☐ Backup contacts identified
```

**Pass Criteria:**
- [ ] Escalation path documented
- [ ] All contacts listed and verified
- [ ] Emergency procedures clear
- [ ] Backup CSM identified

### Sign-Off

**CSM Lead:** ___________________  
**Timestamp:** ___________________  
**Overall Result:** ☐ PASS ☐ FAIL

**If FAIL:** Re-train, verify certification, retest.

---

## 3. SUPPORT LEAD: Dashboard Access Verification

**Owner:** Support Team Lead  
**Timeline:** Saturday 2pm-5pm UTC (3 hours)  
**Goal:** Verify all support staff can access monitoring dashboards

### Checklist

#### A. Ops Dashboard Access (45 min)
```
For each support team member:

Support #1: ___________________
☐ Can login to https://forgepay.co.za/dashboard/ops
☐ Can see "System Health" metrics
☐ Can see "Payment Metrics" (last 24h)
☐ Can see "Kill Bill Sync" status
☐ Can see "Email Queue" depth
☐ Can see "Alerts" section
Password: Reset ☐

Support #2: ___________________
☐ Can login to https://forgepay.co.za/dashboard/ops
☐ Can see all sections above
Password: Reset ☐

Support #3: ___________________
☐ Can login to https://forgepay.co.za/dashboard/ops
☐ Can see all sections above
Password: Reset ☐

Support #4: ___________________
☐ Can login to https://forgepay.co.za/dashboard/ops
☐ Can see all sections above
Password: Reset ☐

Support #5: ___________________
☐ Can login to https://forgepay.co.za/dashboard/ops
☐ Can see all sections above
Password: Reset ☐
```

**Pass Criteria:**
- [ ] All 5 support staff can login
- [ ] All can view all dashboard sections
- [ ] Dashboards auto-refresh every 30s
- [ ] No permission errors

#### B. Alert System Testing (45 min)
```
Test alert notification flow:

Trigger test alert:
aws cloudwatch put-metric-alarm --alarm-name test-alert \
  --alarm-description "Test" --threshold 1

Verify notifications received in:
☐ #ops-alerts Slack channel
☐ Support team email
☐ CloudWatch console
☐ SNS topic

Resolve test alert:
aws cloudwatch delete-alarms --alarm-names test-alert

Verify notifications received:
☐ Slack: Alert resolved
☐ Email: All clear
```

**Pass Criteria:**
- [ ] All notification channels working
- [ ] Alert received <1 minute
- [ ] Resolution confirmed <1 minute
- [ ] No duplicate notifications

#### C. Runbook Accessibility (30 min)
```
Are all runbooks accessible to support team?

Runbook locations:
☐ Payment Failure: https://docs.forgepay.co.za/support/payment-failure
☐ KB Sync Failure: https://docs.forgepay.co.za/support/kb-sync
☐ Email Queue Backed Up: https://docs.forgepay.co.za/support/email-queue
☐ Support SLA Breach: https://docs.forgepay.co.za/support/sla-breach
☐ Troubleshooting: https://docs.forgepay.co.za/support/troubleshooting

Are all documents printed/bookmarked?
☐ Support #1: Runbooks available
☐ Support #2: Runbooks available
☐ Support #3: Runbooks available
☐ Support #4: Runbooks available
☐ Support #5: Runbooks available
```

**Pass Criteria:**
- [ ] All runbooks online and accessible
- [ ] All support staff have offline copies
- [ ] Phone numbers for escalation available
- [ ] Shift handoff template prepared

#### D. Communication Channels (20 min)
```
Are all support channels working?

Email:
☐ support@forgepay.co.za inbox monitored
☐ Auto-response set up
☐ Ticket system tracking

Slack:
☐ #support-urgent channel created
☐ #on-call channel configured
☐ Bot integrations working
☐ Escalation flow clear

Phone:
☐ Support hotline: +27-11-XXX-XXXX
☐ Voicemail configured
☐ On-call roster posted
☐ Emergency contact numbers listed
```

**Pass Criteria:**
- [ ] All channels operational
- [ ] Response templates ready
- [ ] Auto-escalation configured
- [ ] Coverage 24/7

#### E. Customer Communications (20 min)
```
Are customer communication templates ready?

Email templates:
☐ Payment failure notification
☐ Service restored notification
☐ SLA breach acknowledgment
☐ Incident root cause report

Status page:
☐ https://status.forgepay.co.za live
☐ Incidents can be posted
☐ Subscriptions can be created
☐ Historical incidents visible

Communication plan:
☐ Who decides to notify customers?
☐ What's the threshold for notification?
☐ Timeline: notify within 15 minutes?
☐ Follow-up: root cause within 24h?
```

**Pass Criteria:**
- [ ] All templates written and tested
- [ ] Status page fully functional
- [ ] Communication decision matrix clear
- [ ] Support team knows procedures

### Sign-Off

**Support Lead:** ___________________  
**Timestamp:** ___________________  
**Overall Result:** ☐ PASS ☐ FAIL

**If FAIL:** Fix access issues, re-verify, retest.

---

## 4. FOUNDER: Customer Acquisition Finalized

**Owner:** Founder/CEO  
**Timeline:** Saturday 6pm-9pm UTC (3 hours)  
**Goal:** Confirm 50 beta customers ready to launch

### Checklist

#### A. Customer List Finalized (30 min)
```
50 Beta Customers Confirmed:

Tier 1: Enterprise (5 customers, >R40K/mo potential MRR):
☐ Customer 1: _____________________ (contact: _______________)
☐ Customer 2: _____________________ (contact: _______________)
☐ Customer 3: _____________________ (contact: _______________)
☐ Customer 4: _____________________ (contact: _______________)
☐ Customer 5: _____________________ (contact: _______________)

Tier 2: Mid-Market (20 customers, R15-40K/mo potential):
☐ [List all 20 with contacts]

Tier 3: SMB (25 customers, <R15K/mo potential):
☐ [List all 25 with contacts]

Total: 50 customers ✓
```

**Pass Criteria:**
- [ ] Exactly 50 customers on list
- [ ] All have valid email addresses
- [ ] All are warm contacts (not cold outreach)
- [ ] All have business case for product
- [ ] Contact person identified for each

#### B. Onboarding Sequence Ready (45 min)
```
Pre-Launch (Sunday):
☐ Founder sends personal email to all 50
   Subject: "Join ForgePay Beta - Exclusive Launch Access"
   Content: Value prop, link to sign up, personal note
   Response rate target: 50%+

Launch Day (Monday):
☐ 8:30 AM: Email campaign #1 (sign-up link)
☐ 12:00 PM: Slack announcement (if applicable)
☐ 2:00 PM: Email campaign #2 (quick tips)

Post-Launch:
☐ Day 1: CSM assigns customers to team
☐ Day 2: First check-in calls scheduled
☐ Day 3: Onboarding flow begins
☐ Day 7: 14-day trial tracking starts
```

**Pass Criteria:**
- [ ] Email templates written
- [ ] Email list segmented
- [ ] Scheduling confirmed with marketing
- [ ] CSM assignments ready
- [ ] Onboarding flow documented

#### C. Launch Communications (30 min)
```
External Communications:

Product Hunt:
☐ Account set up
☐ Product page prepared
☐ Launch time scheduled (Monday 8 AM UTC)
☐ Media/screenshots ready
☐ Tagline finalized

LinkedIn:
☐ Personal post draft written
☐ Company post draft written
☐ Founder quote prepared
☐ Post scheduled for Monday 9 AM

Twitter/X:
☐ Thread written (5-7 tweets)
☐ Scheduled for Monday 8:30 AM
☐ Hashtags: #fintech #payments #africatech

Blog:
☐ Launch post written
☐ SEO optimized
☐ Published Sunday night
☐ Shared in email campaign

Press Release:
☐ Written and proofread
☐ Sent to press contacts (Friday EOD)
☐ Embargo: Monday 8 AM
```

**Pass Criteria:**
- [ ] All announcements written
- [ ] All platforms scheduled
- [ ] Founder review/approval done
- [ ] Media assets ready
- [ ] Timing coordinated

#### D. Success Metrics Defined (20 min)
```
Week 1 Success Targets:

Sign-ups:
☐ Target: 50 active customers
☐ Expected: 50 (all beta list converts)
☐ Success: >45 (90%+)

Onboarding:
☐ Target: 40/50 complete first payment
☐ Expected: 40/50 (80%)
☐ Success: >35 (70%+)

Retention:
☐ Target: 48/50 stay through Week 1
☐ Expected: 48/50 (96%)
☐ Success: >47 (94%+)

Revenue:
☐ Target: 50 * R15K = R750K MRR
☐ Expected: R750K (50 active)
☐ Success: >R650K (86%+)

NPS:
☐ Target: >50
☐ Expected: >50
☐ Success: >40
```

**Pass Criteria:**
- [ ] All metrics defined
- [ ] Targets are realistic
- [ ] Tracking method clear
- [ ] Weekly reporting schedule set

#### E. Contingency Plans (15 min)
```
If sign-up rate <50%:
☐ Reach out to warm network
☐ Offer extended trial
☐ Offer discount incentive
☐ Activate backup customer list

If payment success <95%:
☐ Activate payment fallback chain
☐ Notify customers of manual option
☐ Escalate to platform team
☐ Daily monitoring 24/7

If churn spike >10%:
☐ CSM outreach to at-risk customers
☐ Offer pause or downgrade
☐ Schedule executive calls
☐ Gather feedback for improvements
```

**Pass Criteria:**
- [ ] All contingencies documented
- [ ] Trigger conditions defined
- [ ] Response owners identified
- [ ] Escalation path clear

### Sign-Off

**Founder:** ___________________  
**Timestamp:** ___________________  
**Overall Result:** ☐ PASS ☐ FAIL

**If FAIL:** Discuss with team, decide go/no-go, adjust plan.

---

## 5. ENGINEERING: Rollback Plan Documented

**Owner:** Engineering Lead  
**Timeline:** Sunday 2pm-5pm UTC (3 hours)  
**Goal:** Ensure rollback is fast, safe, documented

### Checklist

#### A. Rollback Procedure (60 min)
```
Rollback triggers (any of these requires rollback):
☐ Payment success rate drops <98% for 5+ minutes
☐ Kill Bill sync fails for 10+ minutes
☐ Email queue backs up >1000 jobs
☐ Database connectivity lost >1 minute
☐ More than 1% of requests failing (5xx errors)
☐ Critical security vulnerability discovered
☐ Customer data integrity issue detected

Who can trigger rollback?
☐ On-call engineer (immediate)
☐ Platform lead (immediate)
☐ Founder (immediate)

Rollback command:
```bash
# Step 1: Initiate rollback
helm rollback platform 1 --namespace forgepay

# Step 2: Wait for pods to restart
kubectl rollout status deployment/platform -n forgepay --timeout=3m

# Step 3: Run smoke test
curl https://api.forgepay.co.za/api/health
# Expected: HTTP 200

# Step 4: Verify metrics
# Check dashboards: all green
# Check payment success: >99%
# Check error rate: <1%

# Step 5: Notify team
# Post to Slack #ops-alerts
# Email founders
# Document incident
```

**Pass Criteria:**
- [ ] Rollback procedure documented
- [ ] Command tested (dry-run)
- [ ] Estimated time: <2 minutes
- [ ] Everyone knows who decides

#### B. Pre-Deployment Backup (30 min)
```
Before deploying, save current state:

Database snapshot:
☐ RDS: Automated backup running
aws rds describe-db-snapshots --query 'DBSnapshots[-1].[SnapshotCreateTime,DBSnapshotIdentifier]'
# Expected: Recent backup exists

Kubernetes state:
☐ Helm history saved
helm history platform -n forgepay
# Expected: Can rollback to release 1

Configuration backup:
☐ All secrets backed up
aws secretsmanager list-secrets | jq '.SecretList[]'
# Expected: All secrets present

Application state:
☐ Customer data exported
☐ Subscription list backed up
☐ Revenue events table frozen (read-only briefly)
```

**Pass Criteria:**
- [ ] All backups current (<1 hour old)
- [ ] Database snapshot exists
- [ ] Helm release history clean
- [ ] Secrets encrypted and secured
- [ ] Customer data exportable

#### C. Post-Rollback Verification (30 min)
```
After rollback completes, verify:

API Endpoints:
☐ /api/health returns 200
☐ /api/auth/login responds
☐ /api/payments returns data
☐ /api/dashboard/payments returns metrics
All latency <1 second

Database:
☐ All customers still present
☐ All subscriptions intact
☐ No data loss
☐ Backups current

Dashboards:
☐ Ops Dashboard showing green
☐ All metrics fresh
☐ No data gaps

Customer Impact:
☐ 0 customers affected
☐ No failed payments
☐ No lost data
☐ Full service restored
```

**Pass Criteria:**
- [ ] All systems online
- [ ] Zero customer impact
- [ ] Data integrity confirmed
- [ ] Full functionality restored

#### D. Communication Plan (20 min)
```
If rollback is needed, notify:

Internal:
☐ Post to #ops-alerts (immediately)
☐ Email founders (immediately)
☐ Message CSM team (within 5 min)
☐ Message support team (within 5 min)

External (if customer-facing):
☐ Post incident on status.forgepay.co.za
☐ Send customer email (if needed)
☐ Tweet status update (if prolonged)

Content:
"We experienced an incident on [date] at [time]. Our on-call team immediately
rolled back to a stable version. Service is now fully restored. We apologize
for any inconvenience. Root cause analysis is underway."

Post-Incident:
☐ Publish incident report within 24 hours
☐ Include root cause
☐ Include prevention measures
☐ Timeline of events
```

**Pass Criteria:**
- [ ] Templates written
- [ ] Notification channels tested
- [ ] Timing guidelines clear
- [ ] Approval process defined

#### E. Testing Rollback (30 min)
```
DRY-RUN ROLLBACK TEST (no actual deployment):

Pre-test verification:
☐ Current version: v1.0.0
☐ Helm history has at least 2 releases
☐ Previous release is stable

Test rollback:
helm rollback platform --dry-run -n forgepay
# Should show "dry-run: 1 release would be rolled back"

Verify command works:
☐ No errors
☐ Output is clear
☐ Rollback time estimated <2 min

Document:
☐ Rollback confirmed to work
☐ Estimated time: 90 seconds
☐ All verification steps passed
☐ Ready for production if needed
```

**Pass Criteria:**
- [ ] Dry-run rollback succeeds
- [ ] Actual rollback command tested
- [ ] Estimated time documented
- [ ] Team trained on procedure

#### F. Incident Post-Mortem (10 min)
```
If rollback was triggered, within 4 hours:

Template (saved in Notion/Docs):
☐ Incident name
☐ Duration (start time - end time)
☐ Systems affected
☐ Customer impact (Y/N, how many)
☐ Root cause
☐ Timeline of events
☐ Resolution steps
☐ Prevention measures
☐ Owner (who fixes)
☐ Deadline (next week)

Example:
"Payment Processing Failure - June 29, 2026
Duration: 8:15 AM - 8:22 AM UTC (7 minutes)
Impact: 0 customers (failure detected in <5 min, manual payments enabled)
Root Cause: Stripe API timeout due to ACH rate limiting
Prevention: Implement circuit breaker, lower timeout from 30s to 10s
Owner: Platform team
Fix deadline: June 30, 2026"
```

**Pass Criteria:**
- [ ] Template written
- [ ] Owner assigned
- [ ] Deadline set
- [ ] Prevention measures identified

### Sign-Off

**Engineering Lead:** ___________________  
**Timestamp:** ___________________  
**Overall Result:** ☐ PASS ☐ FAIL

**If FAIL:** Fix rollback procedure, test again, retest.

---

## ALL SIGN-OFFS COMPLETE

**When all 5 leads have signed off:**

```
☐ Platform Lead: System health check PASS
☐ CSM Lead: Retention playbook readiness PASS
☐ Support Lead: Dashboard access verified PASS
☐ Founder: Customer acquisition finalized PASS
☐ Engineering: Rollback plan documented PASS

Final Decision: 🟢 GO / 🔴 NO-GO
```

**Send to:** Founder + All Leads  
**Timeline:** Sunday 8pm UTC  
**Deadline:** Sunday 10pm UTC final decision
