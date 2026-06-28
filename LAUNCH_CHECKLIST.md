# ForgePay 3-Product Launch Checklist

## Overview

This is the **master launch checklist** for the ForgePay three-product separation: Payments, Treasury, Credit Bureau.

**Timeline:** 12 weeks  
**Phase 1-4 Status:** ✅ All code & documentation complete  
**Next Step:** Execute phase-by-phase in production

---

## Rollout Plan

### Week 1: Internal Testing (Pre-Launch)
- [ ] Deploy Phase 1 to staging: Kill Bill catalogs, middleware, customer endpoints
- [ ] Test flow: Sign up customer → Grant Payments → Verify 403 on unlicensed endpoints
- [ ] Test flow: Upgrade Payments → Treasury → verify proration works
- [ ] Load test: 1000 concurrent license grant requests
- [ ] Load test: /v1/csm/dashboard with 100 customers

### Week 2: Beta Release (Payments Only)
- [ ] Deploy Phase 2: Landing page + checkout + onboarding
- [ ] Launch: /checkout/payments (link from main landing page)
- [ ] Beta cohort: 50 internal users + 10 friendly early customers
- [ ] Monitor: Onboarding completion rate, API key generation, test payment success
- [ ] Fix: Any 4xx errors in onboarding flow

### Week 3: Phase 1-2 GA (Payments + Landing Pages)
- [ ] Announce: "FORGE Payments is live"
- [ ] Content: Publish blog post + update pricing page
- [ ] Monitor: Sign-up rate, churn rate, API usage

### Weeks 4-6: Phase 2 Full Release (Onboarding Flows + Checkouts)
- [ ] Deploy: Treasury onboarding flow
- [ ] Deploy: Credit Bureau onboarding flow
- [ ] Deploy: /checkout/treasury and /checkout/credit-bureau
- [ ] Email: Launch email sequences (Tier 1: Day 0 welcome)
- [ ] Monitor: Upsell impression CTR from dashboard

### Weeks 7-10: Phase 3 Revenue Optimization
- [ ] Deploy: Upsell engine, CSM dashboard, bundle upgrade
- [ ] Email: Launch Tier 2 sequences (Day 7 upsell, GMV threshold triggers)
- [ ] CSM: First manual upsell outreach to top 10 high-GMV customers
- [ ] Monitor: Upsell signal accuracy (how many convert?)

### Weeks 11-12: Phase 4 GTM & Support Training
- [ ] Deploy: Email sequences (Day 14 sequence)
- [ ] Training: Support team on runbook (4 hours)
- [ ] Training: CSM team on playbooks (2 hours)
- [ ] Launch: /admin/csm dashboard for CSM team
- [ ] Announce: Full three-product suite (press, social, sales deck)

---

## Pre-Launch Infrastructure Checklist

### Databases
- [ ] Run migration: `001_add_customer_products.sql` in production
- [ ] Verify: `customers.products` column exists and is empty
- [ ] Verify: `customers.subscriptions` JSONB exists
- [ ] Verify: `revenue_events` table indexed on (customer_id, product, event_type)
- [ ] Backup: Full database snapshot before launch

### Kill Bill
- [ ] Upload catalog.xml to Kill Bill instance
- [ ] Create test Kill Bill account
- [ ] Verify: Test subscription creation works end-to-end
- [ ] Verify: Proration calculation correct (mid-month upgrade should credit)
- [ ] Set up: Kill Bill → webhook → Postgres sync (for subscription changes)

### Redis
- [ ] Verify: Redis running and accessible
- [ ] Verify: Idempotency cache working (setex + get on test key)
- [ ] Set: TTL policy (3600s for idempotency, 1h for scores)

### Unified Router
- [ ] Deploy: `requireProduct()` middleware
- [ ] Deploy: Customer subscription endpoints
- [ ] Deploy: CSM dashboard endpoints
- [ ] Deploy: Bundle upgrade endpoint
- [ ] Test: Middleware actually returns 403 for unlicensed access
- [ ] Test: 401 for invalid JWT, 403 for right JWT but wrong product

### Dashboard
- [ ] Deploy: ProductGate component
- [ ] Deploy: Sidebar navigation
- [ ] Deploy: UpgradePrompt component
- [ ] Deploy: UpsellCard component
- [ ] Deploy: Onboarding flows (all 3)
- [ ] Test: Gated pages show upgrade prompt when unlicensed

### Web App (Marketing)
- [ ] Deploy: Product landing pages (/products/payments, /treasury, /credit-bureau)
- [ ] Deploy: Checkout pages (/checkout/payments, /treasury, /credit-bureau, /bundle)
- [ ] Update: Main landing page links to /products/payments
- [ ] Update: Pricing page shows three products

### Email Service
- [ ] Deploy: Email sequences config (sequences.yaml)
- [ ] Connect: Kill Bill webhooks → email service triggers
- [ ] Test: Trigger email-on-license-grant, verify Day 0 email sends
- [ ] Verify: Email template variables interpolate correctly

---

## Feature Flag Toggles

Use feature flags for gradual rollout (if available):

```yaml
# Suggested flags
features:
  require_product_middleware: true      # Enable 403 checks
  show_upsell_signals: false            # Start false, enable at week 7
  email_sequences_enabled: false        # Start false, enable at week 4
  bundle_pricing_enabled: false         # Start false, enable at week 7
  csm_dashboard_visible: false          # Start false, enable at week 11
```

---

## Launch Day (Week 3, Day 1)

### 6:00 AM
- [ ] Deploy Phase 1-2 to production
- [ ] Smoke test: CSM dashboard loads, middleware 403 works
- [ ] Verify: No 5xx errors in logs

### 7:00 AM
- [ ] Send email to internal team: "FORGE Payments is live"
- [ ] Update: Status page (if applicable)
- [ ] Slack: #announcements with launch message

### 9:00 AM
- [ ] Publish: Blog post on FORGE Payments
- [ ] Social: Tweet + LinkedIn post
- [ ] Monitor: Sign-up funnel (check /checkout/payments traffic)

### 5:00 PM
- [ ] Check: Onboarding completion rate (target: >50% Day 1)
- [ ] Check: API key generation rate
- [ ] Check: Support queue (if any errors)

---

## Post-Launch Monitoring

### Week 1: Critical Metrics
- [ ] Sign-up rate: 10+ new Payments customers
- [ ] Onboarding completion: >40% of sign-ups complete flow
- [ ] Error rate: <0.1% 4xx on requireProduct() middleware
- [ ] Email delivery: >95% of Day 0 welcome emails delivered

### Week 2: Revenue Metrics
- [ ] GMV processed via Payments: Baseline from Week 1
- [ ] Subscription churn: <5% churn rate in first 30 days
- [ ] Upsell impression CTR: Measure (once dashboard upsells enabled)

### Week 4+: Growth Metrics
- [ ] Treasury sign-ups: Target 5+ per week (from Payments upsell)
- [ ] Credit Bureau sign-ups: Target 2+ per week
- [ ] Bundle conversions: Track when enabled in week 7
- [ ] At-risk churn: <2% win-back rate on at-risk customers

---

## Rollback Plan

If critical production issue:

1. **Middleware failing (403 on legitimate requests)**
   - Disable: `require_product_middleware` flag
   - Redeploy: Unified Router without requireProduct hook

2. **Kill Bill integration broken**
   - Disable: Bundle/upsell features
   - Keep: Payments working (doesn't depend on Bundle)
   - Restore: /v1/customer/products endpoint from snapshot

3. **Entire checkout flow broken**
   - Revert: Last stable deploy tag
   - Expected: 15min downtime, customers see "unavailable" page
   - Communication: Status page + email to affected signups

---

## Success Criteria (30 Days Post-Launch)

- [ ] 100+ Payments sign-ups
- [ ] 5+ Treasury conversions (from Payments upsell)
- [ ] 2+ Credit Bureau sign-ups
- [ ] <5% onboarding abandonment rate
- [ ] <3% 30-day churn rate
- [ ] 0 production outages due to three-product separation
- [ ] Support team trained and handling all 3 products
- [ ] CSM team running playbooks (weekly at-risk outreach)

---

## Post-Launch Tasks (Weeks 13+)

These are not required for launch, but recommended shortly after:

1. **Analytics & Insights**
   - Track: Upsell conversion rate by customer segment
   - Measure: Feature adoption by product
   - Optimize: Email sequence subject lines A/B test

2. **Product Improvements**
   - Quiz: Add /products/quiz for product selector
   - ROI Calculators: Add to /products/treasury and /products/credit-bureau
   - Comparative Analysis: "FORGE vs Stripe" doc for Payments
   - Partner Program: 25% revenue share for Credit Bureau inquiry referrals

3. **Scale Operations**
   - Hire: 1 CSM per 50 customers
   - Automate: At-risk detection → auto-email (not manual outreach)
   - Expand: Sales team by product (Payments rep, Treasury rep, Credit Bureau rep)

4. **International Expansion**
   - Pricing: Add USD, GBP, EUR price tiers
   - Compliance: Add EU GDPR opt-in, CCPA disclosures
   - Localization: Translate onboarding flows to Spanish, French (if applicable)

---

## Questions Before Launch?

**Who to ask:**

- Architecture / integrations → Engineering
- Kill Bill setup → Billing engineer
- Customer success playbooks → CSM lead
- Email sequences → Marketing ops
- Support training → Support lead
- Risk / compliance → Legal

