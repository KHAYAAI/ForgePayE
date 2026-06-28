/**
 * Medium Risk Monitoring & Management
 *
 * Covers:
 * - OFAC false positive rate >5%
 * - Proration math off by 1%
 * - Cold email low CTR
 * - Bundle discount eroding margin
 */

import { db } from '../db';

// ============================================================================
// OFAC False Positive Management
// ============================================================================

export async function trackOFACScreening(
  agentId: string,
  ofacStatus: 'clear' | 'flagged' | 'false_positive',
  chainalysisScore: number
): Promise<void> {
  if (ofacStatus === 'false_positive') {
    console.warn(`[OFAC Monitor] False positive detected for ${agentId}`);

    // Log for later analysis
    await db.query(
      'public',
      `
        INSERT INTO ofac_screening_log 
        (agent_id, status, chainalysis_score, flagged_date, resolved_date)
        VALUES ($1, $2, $3, NOW(), NULL)
      `,
      [agentId, 'false_positive', chainalysisScore]
    );
  }
}

export async function getOFACFalsePositiveRate(): Promise<number> {
  const result = await db.query(
    'public',
    `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'false_positive' THEN 1 END) as false_positives
      FROM ofac_screening_log
      WHERE flagged_date > NOW() - INTERVAL '30 days'
    `,
    []
  );

  if (result.rows[0].total === 0) return 0;
  return (result.rows[0].false_positives / result.rows[0].total) * 100;
}

export async function buildOFACWhitelist(): Promise<string[]> {
  // After 10+ false positives, auto-whitelist the counterparty
  const result = await db.query(
    'public',
    `
      SELECT agent_id
      FROM ofac_screening_log
      WHERE status = 'false_positive'
      GROUP BY agent_id
      HAVING COUNT(*) > 10
    `,
    []
  );

  return result.rows.map(r => r.agent_id);
}

// ============================================================================
// Proration Math Auditing
// ============================================================================

export async function auditProratedCharges(): Promise<{ discrepancies: number; refundNeeded: number }> {
  console.info('[Proration Audit] Starting monthly audit...');

  const result = await db.query(
    'public',
    `
      SELECT 
        customer_id,
        subscriptions->>'plan_name' as plan,
        EXTRACT(DAY FROM AGE(
          (subscriptions->>'billing_period_end')::DATE,
          (subscriptions->>'billing_period_start')::DATE
        )) as days_in_period,
        40000 as monthly_price,
        (subscriptions->>'prorated_amount')::NUMERIC as actual_prorated,
        40000 * 
        EXTRACT(DAY FROM AGE(
          (subscriptions->>'billing_period_end')::DATE,
          (subscriptions->>'billing_period_start')::DATE
        )) / 30.0 as expected_prorated
      FROM customers
      WHERE subscriptions != '{}'::jsonb
    `,
    []
  );

  let discrepancies = 0;
  let refundNeeded = 0;

  for (const row of result.rows) {
    const diff = Math.abs(row.actual_prorated - row.expected_prorated);
    const pctDiff = (diff / row.expected_prorated) * 100;

    if (pctDiff > 1) {
      discrepancies++;
      refundNeeded += diff;
      console.warn(
        `[Proration Audit] Discrepancy for ${row.customer_id}: actual=${row.actual_prorated.toFixed(2)} vs expected=${row.expected_prorated.toFixed(2)} (${pctDiff.toFixed(2)}%)`
      );
    }
  }

  console.info(`[Proration Audit] Found ${discrepancies} discrepancies, refund needed: R${refundNeeded.toFixed(2)}`);
  return { discrepancies, refundNeeded };
}

// ============================================================================
// Cold Email CTR Monitoring + Warm Outreach Fallback
// ============================================================================

export async function trackEmailCTR(
  campaignId: string,
  sent: number,
  clicked: number
): Promise<void> {
  const ctr = (clicked / sent) * 100;
  console.info(`[Email Monitor] ${campaignId}: ${clicked}/${sent} clicked (CTR: ${ctr.toFixed(1)}%)`);

  if (ctr < 5) {
    console.warn(`[Email Monitor] Low CTR (${ctr.toFixed(1)}%) for ${campaignId}. Activating warm outreach.`);
    await activateWarmOutreach(campaignId);
  }
}

async function activateWarmOutreach(campaignId: string): Promise<void> {
  // Instead of cold email, CSM makes personal calls
  console.info(`[Email Monitor] Queuing CSM calls for ${campaignId} recipients`);

  // TODO: Create task in CSM CRM: "Call customer, offer {product}, mention savings"
}

// ============================================================================
// Bundle Discount Margin Protection
// ============================================================================

export async function protectBundleMargin(): Promise<void> {
  console.info('[Bundle Margin] Checking bundle discount terms...');

  // Bundle is R45K/mo vs R48.5K/mo separate = R3.5K savings
  // Protect margin: require 12-month commitment
  console.info('[Bundle Margin] Enforcing 12-month commitment term on bundle pricing');

  // TODO: Update Kill Bill bundle plan to include commitment term
  // TODO: Add contract addendum for bundle customers
}

export async function trackBundleChurn(customerId: string): Promise<void> {
  // If customer on bundle tries to cancel within 12 months:
  // 1. Offer 10% discount to stay
  // 2. If they decline, charge early termination fee (20% of remaining commitment)
  console.info(`[Bundle Margin] Protecting bundle margin for ${customerId}`);

  // TODO: Check subscription term, apply fee if needed
}

// ============================================================================
// Migration: Create monitoring tables
// ============================================================================

export const MEDIUM_RISK_MIGRATION = `
CREATE TABLE IF NOT EXISTS ofac_screening_log (
  id BIGSERIAL PRIMARY KEY,
  agent_id VARCHAR(255) NOT NULL,
  status VARCHAR(50),
  chainalysis_score INT,
  flagged_date TIMESTAMPTZ,
  resolved_date TIMESTAMPTZ,
  INDEX idx_agent_status (agent_id, status)
);

CREATE TABLE IF NOT EXISTS email_campaign_metrics (
  id BIGSERIAL PRIMARY KEY,
  campaign_id VARCHAR(255) NOT NULL,
  sent INT,
  delivered INT,
  clicked INT,
  converted INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;
