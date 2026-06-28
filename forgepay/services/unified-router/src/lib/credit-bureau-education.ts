/**
 * Credit Bureau Score Variance Education
 *
 * Mitigates:
 * - "Mode 1/Mode 2 variance misunderstood" (High Risk)
 * - "Pricing perception (too expensive)" (High Risk)
 *
 * Features:
 * - Automatic variance explanation email
 * - Launch discount tracking
 * - Pricing justification email
 */

import { db } from '../db';

export async function explainScoreVariance(
  customerId: string,
  agentId: string,
  mode1Score: number,
  mode2Score: number,
  variance: number
): Promise<void> {
  const confidence = variance <= 50 ? 'HIGH' : variance <= 100 ? 'MEDIUM' : 'LOW';

  if (confidence === 'MEDIUM' || confidence === 'LOW') {
    console.info(`[CB Education] Sending variance explanation for ${agentId} (variance: ${variance}pts, confidence: ${confidence})`);

    // Send email explaining variance
    await sendVarianceEmail(customerId, agentId, mode1Score, mode2Score, variance, confidence);
  }
}

async function sendVarianceEmail(
  customerId: string,
  agentId: string,
  mode1Score: number,
  mode2Score: number,
  variance: number,
  confidence: string
): Promise<void> {
  const emailBody = `
Hi there,

We scored agent ${agentId} and noticed something interesting:

**Mode 1 Score (Off-Chain):** ${mode1Score}
**Mode 2 Score (On-Chain):** ${mode2Score}
**Variance:** ${variance} points
**Confidence:** ${confidence}

Here's what this means:

${mode1Score > mode2Score
  ? `
### Mode 1 is higher - Why?
Mode 1 focuses on FICO factors: payment history, account age, and risk profile.
${agentId} has a strong payment history, so Mode 1 score is higher.

Mode 2, on the other hand, emphasizes recent operational activity.
If ${agentId} has low recent volume, Mode 2 will be lower.

**Action:** This is normal. Monitor if the gap closes as the agent transacts more.
`
  : `
### Mode 2 is higher - Why?
Mode 2 focuses on recent operational activity: transaction volume, success rate, and compliance.
${agentId} has strong recent metrics, so Mode 2 score is higher.

Mode 1 emphasizes longer-term FICO factors like payment history and account age.
If ${agentId} is new, their Mode 1 score may lag until they have a longer history.

**Action:** This is normal for newer agents. Mode 1 score will increase as history builds.
`}

**Recommendation:**
${confidence === 'LOW' ? `We recommend manual review of this agent. Reach out to our team if you'd like guidance.` : `Continue monitoring. The scores should converge as the agent builds more history.`}

Questions? Reply to this email or contact our team.

Best,
FORGE Credit Bureau
`;

  console.info(`[CB Education] Variance email prepared for ${customerId}/${agentId}`);
  // TODO: Send via email service
}

/**
 * Track launch discount usage
 *
 * Offer 10% discount to first 100 customers
 */
export async function applyLaunchDiscount(customerId: string, product: string): Promise<boolean> {
  const discountKey = `launch_discount_${product}_count`;

  // Get current count (simplified - in real app use Redis or DB counter)
  const currentCount = 50; // Simulated

  if (currentCount < 100) {
    console.info(`[Launch Discount] Applied 10% discount to ${customerId} (${currentCount}/100 used)`);

    // TODO: Apply 10% discount via Kill Bill custom plan
    return true;
  }

  console.warn(`[Launch Discount] Discount quota exhausted (100/100 used)`);
  return false;
}

/**
 * Pricing justification email
 *
 * Send to prospects who expressed pricing concerns
 */
export async function sendPricingJustificationEmail(customerId: string, product: string): Promise<void> {
  const justifications: Record<string, string> = {
    payments: `
FORGE Payments costs R15K/month or 1.2% + R5/tx.
Stripe costs 2.9% + R2/tx.

**Your ROI:**
At R1M GMV/month:
- Stripe: R29K/month
- FORGE: R15K + R5K = R20K/month
- **Savings: R9K/month or R108K/year**

Plus instant settlements (vs Stripe's 2-day delay) and support from our team.
`,
    treasury: `
FORGE Treasury costs R40K/month flat.

**Your ROI:**
With just 10 agents settling daily:
- Manual netting cost: R5K/day (CSM overhead) = R150K/month
- Chainalysis OFAC: R2K/month
- FX/bridge fees: R2K/month
- **Total: R154K/month without FORGE**

FORGE saves you R114K/month and reduces risk.

1 year payback? ~4 months.
`,
    'credit-bureau': `
FORGE Credit Bureau costs R8.5K/month.

**Your revenue:**
Earn 25% of lender inquiry fees.
- 100 agents × 20 inquiries/month × R100/inquiry × 25% = R50K/month
- Net: +R41.5K/month profit

Plus improve lending accuracy with on-chain proof.
`,
  };

  console.info(`[Pricing Justification] Sending for ${customerId} (${product})`);
  // TODO: Send email with justification
}
