# ForgePay Pricing Strategy & Tier Structure

## Overview

ForgePay uses a **dual-tier pricing model** designed to maximize accessibility for startups while capturing value from scaling merchants who need compliance features.

- **Free Tier**: $0/month platform fee, 2.8% + $0.24 per card transaction
- **Standard Tier**: $28/month platform fee ($336/year), 2.4% + $0.24 per card transaction, includes Merchant of Record

## Pricing Tiers

### Free Tier

**Monthly Fee**: $0

**Transaction Fees**:
- Card payments: 2.8% + $0.24 per transaction
- Stablecoin/Crypto: 1.8% + gas fees per transaction

**Features**:
- Card payments (Visa, Mastercard, Amex)
- Stablecoin & crypto payments
- Hosted checkout
- Basic analytics (dashboard view of recent payments)
- Webhook infrastructure
- Community support

**Limits**:
- Monthly transaction volume cap: $25,000
- Chargeback threshold: 5 chargebacks = automatic upgrade to Standard
- Team members: 1 (creator only)
- Tax automation: Not included

**Use Case**: Early-stage SaaS founders, indie developers, side projects, bootstrapped companies

**Competitive Advantage**: 50% cheaper than Paddle on card fees, 3% cheaper than Stripe, no upfront cost

### Standard Tier

**Monthly Fee**: $28/month (billed annually as $336)

**Transaction Fees**:
- Card payments: 2.4% + $0.24 per transaction
- Stablecoin/Crypto: 1.4% + gas fees per transaction

**Features**:
- All Free tier features
- Unlimited monthly transaction volume
- Merchant of Record (automatic tax calculation in 200+ jurisdictions)
- Tax compliance & filing (automatic remittance)
- Subscriptions & usage-based billing
- Advanced analytics (cohort analysis, LTV tracking, churn prediction)
- Priority support (2-hour response SLA)
- Team members: up to 10
- Dunning & chargeback management
- Custom webhook configuration
- API rate limit: 100 req/min (vs 10 req/min free)

**Use Case**: SaaS companies with product-market fit, recurring revenue, international customers, compliance requirements

**Competitive Advantage**: 50% cheaper than Paddle when accounting for MoR fee (Paddle 2.49% + 5% MoR = 7.49% vs ForgePay 2.4% + $28/mo)

---

## Pricing Model Economics

### Free Tier Economics

**Assumptions**:
- Average transaction: $100
- Cards: 80% of volume, Stablecoin/Crypto: 20% of volume

**Gross Margin Calculation** (per $1,000 in revenue):
```
Transaction cost:
  Cards (800): $224 @ 2.8% + $0.24 = $224 + $192 = $416
  Stablecoin (200): $36 @ 1.8% = $36
  Total cost: $452
  Gross revenue: $1,000
  Gross margin: 54.8%

Contribution to platform:
  Per $100 transaction: $2.80 net (54.8% margin)
  Break-even: 560 merchants @ $500/month revenue each
```

**Retention Strategy**:
- Natural upgrade triggers are built in
- Merchants naturally hit $25k/month cap within 3-6 months if successful
- Chargeback threshold forces upgrade at 5 chargebacks
- Tax compliance becomes critical before IPO/Series A

### Standard Tier Economics

**Assumptions**:
- Average transaction: $100
- Annual recurring revenue: $336
- Cards: 85% of volume, Stablecoin/Crypto: 15% of volume

**Gross Margin Calculation** (per $10,000 in annual revenue):
```
Platform fee contribution: $336/year = $28/month

Transaction cost (assuming $100 avg, 12 payments/month/merchant):
  Cards: $240/year @ 2.4% + $0.24 = $240 * 2.4% + $28.80 = $28.80 + $28.80 = $58
  Stablecoin: $20/year @ 1.4% = $0.28
  Total transaction cost: $58.28

Annual gross revenue: $10,000
Annual costs: $336 (platform fee) + $698 (transaction fees) = $1,034
Gross margin: 89.7%

Contribution per merchant:
  Average merchant revenue: $12,000/year
  ForgePay revenue: $336 (platform) + ~$288 (transaction fees @ blended 2.4%) = $624
  Gross contribution: $624 * 0.897 = $560/merchant/year
  Break-even: 1,362 merchants (at 50th percentile $624 revenue per merchant)
```

### Blended Break-Even Model

**Scenario**: 50% Free, 50% Standard customers

```
Free tier cohort (50%):
  Break-even: 560 merchants × 50% = 280 merchants
  Revenue per: $560/year (average)

Standard tier cohort (50%):
  Break-even: 1,362 merchants × 50% = 681 merchants
  Revenue per: $624/year (average)

Total break-even: 961 merchants
Average revenue per merchant: $592/year
Blended acquisition cost target: < $148 (first quarter payback)
```

### Lifetime Value Analysis

**Free → Standard Upgrade Path**:
- **Free tier LTV**: $560/year × 2.5 years (avg retention before upgrade) = $1,400
- **Standard tier LTV**: $624/year × 5 years (avg retention after upgrade) = $3,120
- **Total lifetime value** (Free → Standard pathway): $4,520

**Direct Standard Signup**:
- **LTV**: $624/year × 5 years = $3,120
- **Plus**: Free to Standard upsell path reduces CAC for subsequent tiers

**Churn Rate Impact**:
- Free tier churn (no MoR): 8-12% monthly (typical for $0/month product)
- Standard tier churn: 2-3% monthly (switching costs from integrated MoR)

---

## Upgrade Triggers & Conversion Path

Merchants automatically upgrade from Free to Standard when they hit any of these thresholds:

### Hard Triggers (Automatic Upgrade)

1. **Volume Cap**: $25,000/month transaction volume
   - Message: "You've hit your Free tier volume limit. Upgrade to Standard for unlimited volume."
   - Timing: Sent when monthly volume exceeds cap; Standard required to process additional transactions

2. **Chargeback Threshold**: 5+ chargebacks in 30 days
   - Message: "Your chargeback rate triggered an automatic upgrade to Standard for dunning & chargeback management."
   - Reason: Chargeback management is complex; Free tier can't sustain this risk

3. **Tax Complexity**: Sale to international customer (non-US)
   - Message: "Selling internationally? Upgrade to Standard to handle VAT, GST, and other local taxes automatically."
   - Timing: Appears in checkout when customer country differs from merchant

### Soft Triggers (Recommended Upgrade)

1. **Recurring Revenue**: First subscription created
   - Message: "Subscriptions? Upgrade to Standard to unlock Kill Bill integration for automatic renewals and dunning."

2. **Team Growth**: Attempt to invite second team member
   - Message: "Need team collaboration? Standard tier includes up to 10 team members."

3. **Compliance Deadline**: 90 days before tax filing deadline
   - Message: "Tax deadline approaching. Upgrade to Standard for automatic tax calculation and filing in 200+ jurisdictions."

4. **Growth Analytics**: Attempt to access cohort analysis or LTV calculations
   - Message: "Advanced analytics available in Standard tier to track unit economics and predict churn."

### Marketing-Driven Upgrade

- **Launch announcement**: "ForgePay Standard tier now includes x402 agent payments. Upgrade today."
- **Seasonal**: "Tax season? Upgrade to Standard for automatic global tax compliance."
- **Competitive**: "Stripe raised prices. Get 50% more features at 50% lower cost with Standard."

---

## Positioning & Go-To-Market

### Free Tier Marketing Message

**Headline**: "Start accepting Bitcoin, USDC, and card payments for $0/month"

**Subheadline**: "No monthly fees. No setup fees. Just 2.8% + $0.24 per transaction."

**Target Audience**:
- SaaS founders bootstrapping their first product
- Open-source projects monetizing with Stripe-style payments
- Indie developers building side projects
- International companies avoiding Stripe's high fees in their region

**Distribution**:
- Y Combinator Slack, Hacker News, ProductHunt
- Indie Hackers, Dev.to, Twitter/X
- GitHub README plugins (one-click ForgePay)
- Stripe subreddit: "Free alternative to Stripe for stablecoins"

### Standard Tier Marketing Message

**Headline**: "Compliance, at the cost of a coffee."

**Subheadline**: "Stop worrying about tax. ForgePay handles VAT, GST, and sales tax in 200+ countries. $28/month."

**Target Audience**:
- SaaS companies post-PMF ($10k-100k MRR)
- B2B2C platforms selling internationally
- Subscription software with dunning requirements
- High-chargeback merchants (gaming, crypto, gambling adjacent)

**Distribution**:
- LinkedIn (CFO/VP Finance targeting)
- SaaS industry podcasts (Drift, Defy Ventures, Lenny's Podcast)
- Tax-focused communities (TaxLawyer.com, r/tax, accounting subreddits)
- Paddle competitor communities

---

## Financial Projections (Year 1)

### Assumptions

- **Month 1-2**: 50 Free signups, 5 Standard signups
- **Month 3-6**: 150 Free/mo, 15 Standard/mo (growth from network effects)
- **Month 7-12**: 300 Free/mo, 50 Standard/mo (viral + marketing)
- **Free → Standard upgrade rate**: 20% of Free cohort by 6-month mark
- **Free churn**: 10% monthly (industry standard for $0 products)
- **Standard churn**: 3% monthly (high stickiness from MoR integration)

### Revenue Forecast

| Month | Free Users | Std Users | Free Revenue | Std Revenue | Total | Comment |
|-------|-----------|-----------|-------------|-----------|-------|---------|
| 1 | 50 | 5 | $280 | $140 | $420 | Launch |
| 2 | 90 | 12 | $504 | $336 | $840 | Early adopters |
| 3 | 180 | 40 | $1,008 | $1,120 | $2,128 | Growth accelerates |
| 4 | 270 | 80 | $1,512 | $2,240 | $3,752 | 20% cohort upgrade |
| 5 | 360 | 130 | $2,016 | $3,640 | $5,656 | Compounding growth |
| 6 | 450 | 190 | $2,520 | $5,320 | $7,840 | 6-month mark |
| 12 | 3,600 | 800 | $20,160 | $22,400 | $42,560 | Year 1 run rate |

### Break-Even Analysis

- **Monthly burn rate**: $40k (team + infra + marketing)
- **Break-even**: Month 8-9 (at $40k/month revenue)
- **Month 12 ARR**: $510k
- **Gross margin**: 52% blended (Free 54.8%, Standard 89.7%)
- **Operating margin at M12**: -8% (still investing in growth)

### Series A Metrics (Post-12 months)

- **Total active merchants**: 4,400
- **Annual recurring revenue**: $510k
- **Gross margin**: 52%
- **Customer acquisition cost**: ~$120 (organic + paid mix)
- **Payback period**: 1.2 months (industry excellent at <3 months)
- **Rule of 40**: 78% growth + 12% operating margin = 90 (venture scale)

---

## Competitive Positioning

### vs Stripe

| Dimension | ForgePay | Stripe |
|-----------|----------|--------|
| **Card fee** | 2.4-2.8% + $0.24 | 2.9% + $0.30 |
| **Stablecoin** | 1.4-1.8% native | N/A (doesn't support) |
| **Crypto** | 1.4% native | N/A |
| **Tax automation** | Included (Standard) | Extra software ($X/mo) |
| **Monthly fee** | $0-$28 | $0 |
| **Pricing transparency** | Simple 2-tier | Complex matrix (50+ tiers) |
| **Self-hosting** | Enterprise only | Not available |
| **x402 payments** | Native | No |

**ForgePay advantage**: 40% cheaper on all payment types, includes tax, includes stablecoins/crypto

### vs Paddle

| Dimension | ForgePay | Paddle |
|-----------|----------|--------|
| **Card fee** | 2.4-2.8% | 2.49% |
| **MoR fee** | Included | 5% + $0.50 |
| **Total cost** | 2.4-2.8% | 7.49% |
| **Stablecoin** | 1.4-1.8% | N/A |
| **Team size** | 1-10 members | 1-3 members |
| **Billing** | Kill Bill + Polar | Paddle only |
| **Simplicity** | Straightforward | Requires compliance review |

**ForgePay advantage**: 62% cheaper for MoR, includes crypto, includes advanced billing

### vs Coinbase Commerce

| Dimension | ForgePay | Coinbase |
|-----------|----------|--------|
| **Crypto support** | 50+ coins | 50+ coins |
| **Crypto fee** | 1.4% | 1% |
| **Card payments** | 2.4-2.8% | N/A |
| **Tax automation** | Included | No |
| **Stablecoin** | 1.4-1.8% | Limited |
| **Merchant of Record** | Included (Standard) | No |

**ForgePay advantage**: Only all-in-one: crypto + cards + stablecoins + tax + subscriptions

---

## Pricing Rules & Guidelines

### Rule 1: Always Show Total Cost of Ownership

Marketing should always show the blended cost, not just the per-transaction fee:

```
Stripe: 2.9% + $0.30 per card
ForgePay: 2.4% + $0.24 per card ($0/month)
```

### Rule 2: No Hidden Fees

All fees must be disclosed upfront:
- Transaction fees
- Monthly platform fee
- Gas fees (for crypto/stablecoin)
- Chargeback fees ($15 per chargeback, Free tier only)

### Rule 3: Grandfather Existing Customers

If pricing increases after launch:
- Existing Free tier users get 12 months at locked price
- Existing Standard tier users get 24 months at locked price
- New customers see new pricing immediately

### Rule 4: Annual Discount

Encourage annual billing (Standard tier only):
- Monthly: $28/month = $336/year
- Annual: $336/year = $28/month equivalent (no discount, encourage lock-in)
- Loyalty: Existing customers on annual get 10% discount in year 2+

### Rule 5: No Volume Discounts Below Standard

Free tier customers cannot negotiate volume discounts. Forces upgrade to Standard, which scales with volume.

---

## Future Tiers (Phase 2)

### Enterprise Tier (Planned Q3 2026)

**Monthly Fee**: Custom ($500-5000+)

**Features**:
- All Standard tier features
- Dedicated account manager
- SLA with 99.99% uptime guarantee
- Self-hosting option
- Custom payment routing
- Regulatory compliance reporting
- Custom integrations
- White-label checkout

**Positioning**: For companies with $10M+ ARR, high compliance requirements, or international complexity

---

## Implementation Checklist

- [x] Define Free and Standard tiers in `forgepay/apps/web/src/lib/pricing.ts`
- [x] Update pricing page component (`Pricing.tsx`) with new tiers
- [x] Update marketing messaging on homepage
- [x] Create this pricing strategy document
- [ ] Create pricing calculator tool (monthly volume → estimated cost)
- [ ] Implement upgrade flow in dashboard (detect hard triggers)
- [ ] Set up payment plan options (monthly vs annual)
- [ ] Create upgrade confirmation email templates
- [ ] Add pricing FAQ to website
- [ ] Brief sales/support team on upgrade process
- [ ] Set up analytics to track upgrade conversion rate
- [ ] Create competitor comparison page
- [ ] Launch soft beta with 100 users (validate upgrade triggers)

---

## References

- PRICING_TIERS definition: `forgepay/apps/web/src/lib/pricing.ts`
- Pricing component: `forgepay/apps/web/src/components/Pricing.tsx`
- Dashboard tier display: `forgepay/apps/dashboard/src/components/BillingTierCard.tsx` (to be created)
- Upgrade flow: `forgepay/apps/dashboard/src/routes/settings/billing` (to be created)
