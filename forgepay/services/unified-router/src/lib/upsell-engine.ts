import { db } from '../db';

export interface UpsellSignal {
  product: string;
  tier?: string;
  readiness: 'high' | 'medium' | 'low';
  estimatedMonthlyValue: number;
  message: string;
  urgency: number;
}

export async function getUpsellSignals(customerId: string, tenantId: string): Promise<UpsellSignal[]> {
  const signals: UpsellSignal[] = [];

  // Fetch customer's current products and revenue metrics
  const customer = await db.query(
    tenantId,
    `SELECT products FROM customers WHERE id = $1`,
    [customerId]
  );

  const currentProducts = customer.rows[0]?.products || [];

  // Upsell 1: Payments → Treasury
  if (currentProducts.includes('payments') && !currentProducts.includes('treasury')) {
    const paymentsMetrics = await db.query(
      tenantId,
      `SELECT 
        SUM((metadata->>'amount')::BIGINT) / 100.0 as gmv_zar,
        COUNT(*) as tx_count
       FROM revenue_events
       WHERE product = 'payments' 
         AND event_type = 'TRANSFER'
         AND event_timestamp > NOW() - INTERVAL '30 days'`,
      []
    );

    const gmvZar = paymentsMetrics.rows[0]?.gmv_zar || 0;

    if (gmvZar > 1500000) {
      // GMV > R1.5M/month
      const estimatedSavings = gmvZar * 0.025; // R25/R1K = 2.5% savings via netting
      signals.push({
        product: 'treasury',
        tier: 'standard',
        readiness: 'high',
        estimatedMonthlyValue: estimatedSavings,
        message: `You're processing R${(gmvZar / 1000000).toFixed(1)}M/month. Treasury netting could save R${(estimatedSavings / 1000).toFixed(0)}K/mo.`,
        urgency: 9,
      });
    } else if (gmvZar > 500000) {
      // GMV > R500K/month
      signals.push({
        product: 'treasury',
        tier: 'standard',
        readiness: 'medium',
        estimatedMonthlyValue: gmvZar * 0.015,
        message: `Scale to Treasury: automate agent payouts as you grow.`,
        urgency: 6,
      });
    }
  }

  // Upsell 2: Treasury → Credit Bureau (or standalone)
  if (
    (currentProducts.includes('treasury') || currentProducts.includes('payments')) &&
    !currentProducts.includes('credit-bureau')
  ) {
    // Check if customer has agents
    const agentMetrics = await db.query(
      tenantId,
      `SELECT COUNT(*) as agent_count FROM agents WHERE created_at > NOW() - INTERVAL '30 days'`,
      []
    );

    const agentCount = agentMetrics.rows[0]?.agent_count || 0;

    if (agentCount > 10) {
      signals.push({
        product: 'credit-bureau',
        tier: 'standard',
        readiness: 'high',
        estimatedMonthlyValue: agentCount * 200, // Rough estimate: R200/agent/mo uplift
        message: `You have ${agentCount} agents. Credit Bureau automates scoring + earns 25% inquiry revenue.`,
        urgency: 8,
      });
    }

    if (currentProducts.includes('treasury')) {
      signals.push({
        product: 'credit-bureau',
        tier: 'standard',
        readiness: 'high',
        estimatedMonthlyValue: 3500, // Bundle savings alone
        message: `Bundle Treasury + Credit Bureau: save R3.5K/mo (R45K/mo vs R48.5K/mo).`,
        urgency: 7,
      });
    }
  }

  return signals.sort((a, b) => b.urgency - a.urgency);
}

export async function recordUpsellImpression(
  customerId: string,
  tenantId: string,
  product: string
): Promise<void> {
  await db.query(
    tenantId,
    `INSERT INTO revenue_events 
     (customer_id, tenant_id, product, event_type, metadata, event_timestamp)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      customerId,
      tenantId,
      product,
      'UPSELL_IMPRESSION',
      JSON.stringify({ viewed_at: new Date().toISOString() }),
    ]
  );
}

export async function recordUpsellClick(
  customerId: string,
  tenantId: string,
  product: string
): Promise<void> {
  await db.query(
    tenantId,
    `INSERT INTO revenue_events 
     (customer_id, tenant_id, product, event_type, metadata, event_timestamp)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      customerId,
      tenantId,
      product,
      'UPSELL_CLICK',
      JSON.stringify({ clicked_at: new Date().toISOString() }),
    ]
  );
}
