# ForgePay Pricing Quick Reference

**For Sales, Support, and Customer Success Teams**

---

## The 30-Second Pitch

> "ForgePay is the only all-in-one payment API with cards, stablecoins, crypto, and automatic global tax handling. Start free—no monthly fees, just 2.8% + $0.24 per card transaction. When you scale, upgrade to Standard for unlimited volume, automatic tax compliance in 200+ countries, and advanced billing—all for just $28/month."

---

## Tier Comparison

| Feature | Free | Standard |
|---------|------|----------|
| **Monthly Fee** | $0 | $28 |
| **Card Fee** | 2.8% + $0.24 | 2.4% + $0.24 |
| **Stablecoin / Crypto Fee** | 1.8% | 1.4% |
| **Monthly Volume Limit** | $25,000 | Unlimited |
| **Merchant of Record** | ❌ | ✅ |
| **Tax Automation** | ❌ | ✅ (200+ jurisdictions) |
| **Advanced Analytics** | ❌ | ✅ |
| **Team Members** | 1 | Up to 10 |
| **Support Level** | Community (best effort) | Priority (2-hour SLA) |

---

## Pricing Comparison vs Competitors

### Free Tier
- **vs Stripe**: 50% cheaper (2.8% vs 2.9%)
- **vs Paddle**: 43% cheaper (2.8% vs 5% on cards)
- **vs Coinbase**: Not applicable (Coinbase crypto-only)

### Standard Tier (with MoR)
- **vs Stripe**: 40% cheaper (2.4% vs 2.9%) + includes tax
- **vs Paddle**: 62% cheaper total cost (2.4% + $28/mo vs 2.49% + 5% MoR)
- **vs Coinbase**: Only platform with cards + crypto + tax

---

## When to Suggest Upgrade

### Hard Limits (Automatic Upgrade Required)

1. **Monthly volume reaches $25,000**
   - Message: "You've hit Free tier volume cap. Upgrade to Standard for unlimited."
   - Timing: Occurs naturally for successful merchants in 3-6 months

2. **5+ chargebacks in 30 days**
   - Message: "Upgrade to Standard for dunning management and chargeback protection."
   - Reasoning: Chargeback risk management requires paid tier tools

3. **Attempting to add 2nd team member**
   - Message: "Free tier limited to 1 member. Standard includes up to 10 team members."
   - Positioning: Cost of hiring one person << $28/month

### Soft Triggers (Recommend Upgrade)

1. **International customer (selling outside US)**
   - Message: "Selling to international customers? Standard handles VAT, GST, and local taxes automatically."

2. **First subscription created**
   - Message: "Subscriptions? Upgrade to Standard for Kill Bill integration, dunning, and proration."

3. **Asking about advanced analytics**
   - Message: "LTV tracking, churn prediction, and cohort analysis are Standard-only features."

4. **Tax season approaching (Jan, Apr, Jul, Oct)**
   - Message: "Tax deadline near? Standard automates global tax calculation and filing."

---

## Key Selling Points

### For Free Tier
- ✅ No setup fee
- ✅ Start accepting payments immediately
- ✅ Support cards, stablecoins, and crypto
- ✅ No hidden fees or surprises
- ✅ Natural upgrade path when you grow

### For Standard Tier
- ✅ Automatic tax in 200+ jurisdictions (saves 20-40 hours/quarter)
- ✅ 50% cheaper than Paddle on total cost
- ✅ Only platform combining cards + crypto + tax + subscriptions
- ✅ Priority support (2-hour response for critical issues)
- ✅ Advanced analytics and LTV tracking

### Overall
- ✅ 50% cheaper than Stripe on cards alone
- ✅ Only platform with native crypto/stablecoin support
- ✅ No vendor lock-in (open APIs, portable webhooks)
- ✅ Startup-friendly (bootstrap on Free, upgrade as you grow)

---

## Common Questions

### "Why charge $28/month for Standard?"

The $28/month covers:
- Infrastructure for unlimited volume (no arbitrary caps)
- Merchant of Record (complex tax infrastructure)
- Kill Bill subscription engine (recurring billing)
- Advanced analytics and machine learning
- Priority support and SLA guarantees

**Reality check**: The cost of calculating VAT for one product launch = $28/month.

### "What if I stay on Free tier?"

- Free tier works forever for small merchants
- No forced upgrades (unless you hit hard limits)
- Full featured (cards, stablecoins, crypto, webhooks)
- Natural upgrade when you grow beyond $25k/month

### "Do the transaction fees cover the $28/month?"

**Quick math**:
- $100 average transaction × 250 transactions = $25,000/month volume
- Standard tier: 2.4% + $0.24 = $2.64 per transaction
- Revenue: $660/month at $25k volume
- Monthly fee: $28 (4% of revenue)
- **Breakeven**: $1,167 monthly volume pays for itself

### "Why is Standard cheaper than Stripe?"

1. **No processor middleman**: We're built on Hyperswitch (open-source processor orchestration)
2. **Focused feature set**: We don't try to be everything; we optimize for payments + tax + subscriptions
3. **Efficient infrastructure**: Built for multi-tenant SaaS (not enterprise sprawl)
4. **Volume discounts built-in**: Our processor relationships pass savings to all merchants

### "What about enterprise pricing?"

- Enterprise tier: custom volume discounts, self-hosting, dedicated support
- Typical for merchants with $10M+ ARR
- Contact sales@forgepay.io for discussion

---

## Objection Handling

| Objection | Response |
|-----------|----------|
| "Stripe is cheaper (2.9%)" | Stripe is 2.9%, we're 2.4% on Standard. Plus Stripe doesn't offer stablecoins or tax. If you use Stripe for cards + Coinbase for crypto + tax software, you're paying 7%+. We're 2.4%. |
| "Paddle has MoR and it's cheaper" | Paddle is 2.49% + 5% MoR = 7.49% total. ForgePay Standard is 2.4% + $28/month (spreads to ~3.4% at $10k/month). Still 54% cheaper. |
| "I don't need stablecoins/crypto" | Great! Free tier works perfectly for cards and bank transfers. When you do need crypto (and most founders do eventually), we're here. |
| "Why charge monthly when competitors don't?" | Because we're including infrastructure (unlimited volume, Kill Bill, MoR, priority support) that competitors charge separately for or don't offer. $28/month is the cost of one coffee per week. |
| "Charge me based on volume, not monthly" | We do—transaction fees scale with volume. The $28 monthly fee guarantees infrastructure reliability for all tiers. Think of it like electricity billing (fixed + usage). |
| "I'll just use Stripe" | Totally reasonable. We think you'll come back when you need international customers, stablecoins, or when you're tired of Stripe's price increases and lack of innovation. |

---

## Customer Segmentation

### Perfect for Free Tier
- Solo founder or 2-person startup
- Building MVP or early product
- US-only product initially
- < $10k MRR
- Not worried about taxes yet
- Expected to upgrade to Standard in 3-6 months

### Perfect for Standard Tier
- $10k+ MRR and growing fast
- Selling internationally (VAT/GST required)
- Product has recurring revenue (subscriptions)
- Accepting stablecoins or crypto
- Building multi-team product
- Need compliance audit trail for investors
- Series A / B / C (investors require MoR + audit logs)

---

## Upgrade Workflow

### When Customer Hits Free Tier Limit

1. **Automatic email** (from system)
   - Subject: "Upgrade to Standard for unlimited volume"
   - Tone: Congratulatory (they're growing!)
   - CTA: "Upgrade now" link to billing

2. **Dashboard banner** (appears immediately)
   - Red/yellow banner in top-right
   - Message: "Monthly volume limit exceeded. Upgrade to continue."
   - Button: "See Standard details"

3. **In-app messaging**
   - When merchant tries to process payment over limit
   - Error message with upgrade link
   - Cost calculator showing savings

4. **Support follow-up** (manual, optional)
   - If they don't upgrade in 48 hours
   - Quick check-in: "Hey, want to talk through Standard?"
   - Offer to answer questions or adjust billing

### Standard Upgrade Process

1. Click upgrade link
2. Confirm Standard tier ($28/month billed annually)
3. Add/confirm payment method (card or bank transfer)
4. Instant upgrade (same account, no data loss)
5. Receive welcome email with Standard features
6. Billing email on anniversary date

---

## Talking Points by Audience

### For Developers/Founders
- "Start free, no credit card required."
- "Same API whether you're on Free or Standard."
- "Webhooks work exactly the same."
- "Upgrade is one click—no migration needed."

### For CFOs/Finance
- "One invoice per month (platform fee + transaction fees)."
- "Tax automation saves $X in accountant fees."
- "Audit logs for compliance and investor due diligence."
- "Transparent pricing—no hidden fees or surprise charges."

### For VPs of Growth
- "Free tier unlocks crypto and stablecoin from day one."
- "Customers expect stablecoins—we make it native."
- "International expansion just works (automatic tax)."
- "Churn reduction via dunning and subscription tools."

### For Product Teams
- "Kill Bill integration means flexible billing logic."
- "Advanced analytics inform pricing strategy."
- "Webhook infrastructure scales with customer base."
- "Tax calculation integrates with your product—no customer friction."

---

## Closing the Sale

### For Free Tier Customers

> "Start free today. No credit card, no hidden fees. When you grow beyond $25k/month—which usually takes 3-6 months for successful products—you'll naturally upgrade to Standard for unlimited volume and automatic tax handling. Most founders find that's when they really need us."

### For Standard Tier Customers

> "Standard gives you everything: cards, stablecoins, crypto, subscriptions, and automatic tax in 200+ countries. At $28/month, it's the cost of lunch per week. And honestly, the time you save on tax compliance alone pays for itself in the first week."

---

## Resources

- **Pricing page**: https://forgepay.io/pricing
- **Cost calculator**: https://dashboard.forgepay.io/pricing-calculator
- **Strategy doc**: forgepay/docs/PRICING_STRATEGY.md
- **Implementation guide**: forgepay/docs/PRICING_IMPLEMENTATION_GUIDE.md
- **Competitor comparison**: [Create at: /pages/compare]

---

## Last Updated

May 7, 2026

For questions or updates, contact product@forgepay.io or edit this doc.
