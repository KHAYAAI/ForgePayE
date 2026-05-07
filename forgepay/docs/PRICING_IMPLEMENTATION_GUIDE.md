# ForgePay Pricing Implementation Guide

## Overview

ForgePay's dual-tier pricing model is implemented across three layers:

1. **Configuration** (`forgepay/config/pricing.yaml`) — defines all tiers, limits, features
2. **Frontend** (website, dashboard) — displays pricing and upgrade options
3. **Backend** (APIs, webhooks) — enforces tier limits and pricing rules

This guide shows how to integrate the pricing model into your application.

## Files & Structure

### Configuration Files

```
forgepay/
├── config/
│   └── pricing.yaml                    # Core pricing config (limits, fees, features)
├── docs/
│   ├── PRICING_STRATEGY.md            # Business strategy, financial projections
│   └── PRICING_IMPLEMENTATION_GUIDE.md # This file
├── apps/
│   ├── web/
│   │   ├── src/lib/pricing.ts         # Pricing constants (Free & Standard tiers)
│   │   └── src/components/Pricing.tsx # Marketing page pricing display
│   └── dashboard/
│       └── src/components/PricingCalculator.tsx # Interactive cost calculator
└── services/
    └── [services]/
        └── src/config.ts              # Load pricing.yaml at startup
```

## Frontend Integration

### 1. Marketing Website Pricing Page

The website displays pricing using `forgepay/apps/web/src/lib/pricing.ts`:

```typescript
import { PRICING } from '@/lib/pricing';

// Access tier details
PRICING.tiers.free.monthlyFee        // "$0"
PRICING.tiers.free.transaction_fees.card  // "2.8% + $0.24"
PRICING.tiers.standard.monthlyFee    // "$28"
PRICING.tiers.standard.features      // Array of feature strings
```

**Component**: `forgepay/apps/web/src/components/Pricing.tsx`
- Displays pricing cards with feature comparisons
- Shows competitor pricing (Stripe, Paddle)
- Responsive design (mobile, tablet, desktop)

To update pricing:
1. Edit `PRICING_TIERS` in `forgepay/apps/web/src/lib/pricing.ts`
2. Update `PLANS` array in `Pricing.tsx` to match new features/limits
3. Deploy website

### 2. Dashboard Pricing Calculator

The dashboard includes an interactive pricing calculator showing merchants their estimated monthly cost:

```tsx
import PricingCalculator from '@/components/PricingCalculator';

<PricingCalculator
  currentMonthlyVolume={5000}  // Their current monthly volume
  chargebackCount={2}          // Current chargeback count
  teamSize={1}                 // Current team size
/>
```

**Features**:
- Slider to adjust monthly volume
- Shows Free vs Standard tier costs
- Highlights upgrade triggers (volume cap, chargebacks, team size)
- Displays estimated annual savings

**Location**: Add to dashboard settings or billing page
```tsx
// pages/dashboard/billing/pricing-calculator.tsx
import PricingCalculator from '@/components/PricingCalculator';

export default function BillingCalculator() {
  const { monthlyVolume, chargebackCount, teamSize } = useAnalytics();
  return <PricingCalculator 
    currentMonthlyVolume={monthlyVolume}
    chargebackCount={chargebackCount}
    teamSize={teamSize}
  />;
}
```

### 3. Tier Indicator Component (Todo)

Create a dashboard component showing current tier and upgrade button:

```tsx
// src/components/TierIndicator.tsx
export default function TierIndicator() {
  const { tier } = useMerchant();
  
  return (
    <div className="bg-navy-800 border border-white/10 rounded-lg p-4">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-gray-400 text-sm">Current Plan</p>
          <p className="text-xl font-bold text-white capitalize">{tier}</p>
        </div>
        {tier === 'free' && (
          <button className="bg-cyan-500 text-navy-800 px-4 py-2 rounded-lg font-semibold">
            Upgrade to Standard
          </button>
        )}
      </div>
    </div>
  );
}
```

## Backend Integration

### 1. Loading Pricing Configuration

In your backend service (Python, TypeScript, Rust):

**TypeScript (Fastify)**:
```typescript
import yaml from 'js-yaml';
import fs from 'fs';

const pricingConfig = yaml.load(
  fs.readFileSync('forgepay/config/pricing.yaml', 'utf8')
);

const freeTier = pricingConfig.tiers.free;
const standardTier = pricingConfig.tiers.standard;
```

**Python (FastAPI)**:
```python
import yaml

with open('forgepay/config/pricing.yaml') as f:
    pricing_config = yaml.safe_load(f)

free_tier = pricing_config['tiers']['free']
standard_tier = pricing_config['tiers']['standard']
```

**Rust**:
```rust
use serde::Deserialize;
use std::fs;

#[derive(Deserialize)]
struct PricingConfig {
    tiers: Tiers,
}

#[derive(Deserialize)]
struct Tiers {
    free: Tier,
    standard: Tier,
}

let config_str = fs::read_to_string("forgepay/config/pricing.yaml")?;
let pricing: PricingConfig = serde_yaml::from_str(&config_str)?;
```

### 2. Enforcing Tier Limits

#### Volume Limit Enforcement

**In payment processing**:
```typescript
// Before processing payment
async function processPayment(merchantId: string, amount: number) {
  const merchant = await db.merchants.get(merchantId);
  const monthlyVolume = await getMonthlyVolume(merchantId);
  
  if (merchant.tier === 'free' && monthlyVolume + amount > 25000) {
    // Reject payment with upgrade message
    throw new Error('Monthly volume limit exceeded. Please upgrade to Standard.');
  }
  
  // Process payment normally
  return processPaymentIntent(amount);
}
```

#### Team Member Limit Enforcement

**In team management API**:
```typescript
async function addTeamMember(merchantId: string, email: string) {
  const merchant = await db.merchants.get(merchantId);
  const teamSize = await db.teamMembers.count({ merchantId });
  
  const limits = pricingConfig.tiers[merchant.tier].limits;
  if (teamSize >= limits.max_team_members) {
    throw new Error(
      `Free tier limited to 1 team member. Upgrade to Standard for up to 10.`
    );
  }
  
  // Add team member
  return db.teamMembers.create({ merchantId, email });
}
```

#### Feature Access Control

**In dashboard/API**:
```typescript
async function getAdvancedAnalytics(merchantId: string) {
  const merchant = await db.merchants.get(merchantId);
  const features = pricingConfig.tiers[merchant.tier].features;
  
  if (!features.advanced_analytics) {
    throw new Error('Advanced analytics requires Standard tier.');
  }
  
  // Return analytics data
  return getAnalytics(merchantId);
}
```

### 3. Automatic Upgrade Triggers

Implement upgrade checks in a background job or middleware:

```typescript
// cron job that runs daily
async function checkUpgradeTriggers() {
  const freeMerchants = await db.merchants.where({ tier: 'free' });
  
  for (const merchant of freeMerchants) {
    // Check volume
    const monthlyVolume = await getMonthlyVolume(merchant.id);
    if (monthlyVolume > 25000) {
      await triggerUpgrade(merchant.id, 'volume_exceeded');
    }
    
    // Check chargebacks
    const chargebacks = await db.chargebacks.count({
      merchantId: merchant.id,
      createdAt: { $gte: 30DaysAgo }
    });
    if (chargebacks >= 5) {
      await triggerUpgrade(merchant.id, 'chargeback_threshold');
    }
    
    // Check team size
    const teamSize = await db.teamMembers.count({ merchantId: merchant.id });
    if (teamSize > 1) {
      await triggerUpgrade(merchant.id, 'team_exceeded');
    }
  }
}

async function triggerUpgrade(merchantId: string, reason: string) {
  // Send email notification
  await sendEmail(merchantId, `upgrade_${reason}`);
  
  // Show dashboard banner
  await db.banners.create({
    merchantId,
    type: 'upgrade_required',
    message: upgradeTriggerMessages[reason]
  });
  
  // Set flag for dashboard to show prominent banner
  await cache.set(`upgrade_required:${merchantId}`, true, 30 * 60);
}
```

### 4. Transaction Fee Calculation

**Unified across all services**:

```typescript
interface TransactionFeeCalculation {
  gross_amount: number;      // Amount customer enters
  tier: 'free' | 'standard';
  payment_method: 'card' | 'stablecoin' | 'crypto';
}

function calculateTransactionFee(input: TransactionFeeCalculation): number {
  const tierFees = pricingConfig.tiers[input.tier].fees[input.payment_method];
  
  const percentageFee = input.gross_amount * (tierFees.percentage / 100);
  const fixedFee = tierFees.fixed;
  
  return percentageFee + fixedFee;
}

// Example usage
const fee = calculateTransactionFee({
  gross_amount: 100,
  tier: 'free',
  payment_method: 'card'
});
// Returns: 2.8 + 0.24 = 3.04
```

### 5. Support SLA Management

Enforce response times based on tier:

```typescript
async function createTicket(merchantId: string, subject: string) {
  const merchant = await db.merchants.get(merchantId);
  const supportConfig = pricingConfig.tiers[merchant.tier].support;
  
  const ticket = await db.supportTickets.create({
    merchantId,
    subject,
    priority: merchant.tier === 'standard' ? 'high' : 'low',
    slaMinutes: supportConfig.response_time_sla || 1440, // 24h for free
  });
  
  // Route to correct support queue
  if (merchant.tier === 'standard') {
    await assignToHighPriorityQueue(ticket);
  }
  
  return ticket;
}
```

## API Endpoints for Tier Management

### Get Current Merchant Tier

```
GET /v1/merchant/tier
```

Response:
```json
{
  "tier": "free",
  "monthly_fee": 0,
  "features": {
    "merchant_of_record": false,
    "tax_automation": false,
    "subscriptions_allowed": true,
    "webhooks": true
  },
  "limits": {
    "monthly_volume": 25000,
    "remaining_volume": 18500,
    "max_team_members": 1,
    "current_team_members": 1
  },
  "upgrade_required": false,
  "upgrade_reason": null
}
```

### Upgrade Merchant to Standard

```
POST /v1/merchant/upgrade
Content-Type: application/json

{
  "tier": "standard"
}
```

Response:
```json
{
  "success": true,
  "tier": "standard",
  "monthly_fee": 28,
  "effective_date": "2026-05-07",
  "next_billing_date": "2026-06-07"
}
```

## Testing Pricing Rules

### Unit Tests

```typescript
// pricing.test.ts
describe('Pricing', () => {
  it('calculates Free tier card fee correctly', () => {
    const fee = calculateTransactionFee({
      gross_amount: 100,
      tier: 'free',
      payment_method: 'card'
    });
    expect(fee).toBe(3.04); // 2.8% + $0.24
  });

  it('calculates Standard tier card fee correctly', () => {
    const fee = calculateTransactionFee({
      gross_amount: 100,
      tier: 'standard',
      payment_method: 'card'
    });
    expect(fee).toBe(2.64); // 2.4% + $0.24
  });

  it('rejects Free tier payment over volume limit', async () => {
    const merchant = { id: 'test', tier: 'free' };
    await setMonthlyVolume('test', 25001);
    
    expect(() => processPayment('test', 100))
      .toThrowError('Monthly volume limit exceeded');
  });

  it('blocks Free tier from accessing advanced analytics', async () => {
    const merchant = { id: 'test', tier: 'free' };
    
    expect(() => getAdvancedAnalytics('test'))
      .toThrowError('Advanced analytics requires Standard tier');
  });
});
```

### Integration Tests

```typescript
// integration.test.ts
describe('Upgrade Flow', () => {
  it('automatically upgrades merchant when volume cap exceeded', async () => {
    // Create merchant on Free tier
    const merchant = await createMerchant({ tier: 'free' });
    
    // Process $25,000 in transactions
    for (let i = 0; i < 250; i++) {
      await processPayment(merchant.id, 100);
    }
    
    // Verify still on Free
    expect((await getMerchant(merchant.id)).tier).toBe('free');
    
    // Process one more transaction (exceeds $25k)
    expect(() => processPayment(merchant.id, 100))
      .toThrowError('Monthly volume limit exceeded');
  });

  it('sends upgrade email when chargeback threshold exceeded', async () => {
    const merchant = await createMerchant({ tier: 'free' });
    
    // Create 5 chargebacks
    for (let i = 0; i < 5; i++) {
      await createChargeback(merchant.id);
    }
    
    // Run upgrade check
    await checkUpgradeTriggers();
    
    // Verify email sent
    const emails = await getEmailsSent(merchant.id);
    expect(emails).toContainEqual(
      expect.objectContaining({ subject: /chargeback.*upgrade/i })
    );
  });
});
```

## Monitoring & Analytics

### Key Metrics to Track

1. **Tier Distribution**: % Free vs % Standard
2. **Upgrade Conversion Rate**: Free → Standard by trigger type
3. **LTV by Acquisition Method**: Free signup vs direct Standard
4. **Churn Rate**: By tier and MoR usage
5. **Feature Adoption**: By tier (MoR, advanced analytics, etc.)

### Dashboard Queries

```sql
-- % of merchants on each tier
SELECT tier, COUNT(*) as count, COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as pct
FROM merchants
GROUP BY tier;

-- Revenue by tier
SELECT 
  tier,
  COUNT(*) as merchants,
  SUM(monthly_fee) as monthly_fees,
  SUM(estimated_transaction_revenue) as transaction_revenue,
  SUM(monthly_fee) + SUM(estimated_transaction_revenue) as total_mrr
FROM merchants
JOIN monthly_transactions USING (merchant_id)
GROUP BY tier;

-- Upgrade conversion by trigger
SELECT 
  upgrade_trigger,
  COUNT(*) as upgrades,
  AVG(days_to_upgrade) as avg_days_before_upgrade
FROM upgrade_events
WHERE created_at > NOW() - INTERVAL 30 DAY
GROUP BY upgrade_trigger;
```

## Deployment Checklist

- [ ] Update `forgepay/config/pricing.yaml` with new tier structure
- [ ] Update `forgepay/apps/web/src/lib/pricing.ts` with tier constants
- [ ] Update pricing page component (`Pricing.tsx`)
- [ ] Deploy pricing calculator to dashboard
- [ ] Implement tier limit enforcement in payment processing
- [ ] Implement feature access control based on tier
- [ ] Set up automatic upgrade trigger checks
- [ ] Create tier indicator component for dashboard
- [ ] Test all pricing rules with unit + integration tests
- [ ] Set up monitoring for tier distribution and upgrade metrics
- [ ] Brief support team on upgrade process and messaging
- [ ] Launch with marketing campaign emphasizing Free tier

## Support Scripts

### Generate Pricing Summary

```bash
# Show current pricing tiers
cat forgepay/config/pricing.yaml | grep -A 20 "^tiers:"
```

### Bulk Upgrade Merchants

```python
# For special promotions or corrections
from database import db
from pricing import PricingConfig

merchants = db.merchants.where({'tier': 'free', 'created_at': {'$lt': 30_days_ago}})
for merchant in merchants:
    merchant.tier = 'standard'
    merchant.upgraded_at = datetime.now()
    merchant.upgrade_reason = 'promotional_offer'
    db.merchants.update(merchant)
```

### Test Pricing Calculator Locally

```bash
cd forgepay/apps/dashboard
npm run test -- PricingCalculator.test.tsx
```

## Common Issues & Solutions

### Issue: "Monthly volume limit exceeded"

**Cause**: Customer on Free tier and monthly volume > $25,000

**Solution**: 
1. Show in-app notification to upgrade
2. Check dashboard calculator to show savings
3. If legitimate high-volume merchant, offer manual override (contact sales)

### Issue: "Cannot add team member"

**Cause**: Free tier limited to 1 team member

**Solution**:
1. Prompt upgrade to Standard ($28/mo unlocks 10 team members)
2. Show that other team members can be in read-only mode (free)
3. If urgent, contact sales for manual override

### Issue: Pricing calculations don't match

**Cause**: Stale pricing.yaml or frontend-backend sync issue

**Solution**:
1. Verify both frontend and backend load latest pricing.yaml
2. Check that fee calculations match: `(amount * percentage/100) + fixed`
3. Test with known amounts ($100 transaction should be $3.04 for Free card tier)

## References

- Pricing config: `forgepay/config/pricing.yaml`
- Marketing pricing: `forgepay/apps/web/src/lib/pricing.ts`
- Website pricing page: `forgepay/apps/web/src/components/Pricing.tsx`
- Dashboard calculator: `forgepay/apps/dashboard/src/components/PricingCalculator.tsx`
- Strategy & economics: `forgepay/docs/PRICING_STRATEGY.md`
