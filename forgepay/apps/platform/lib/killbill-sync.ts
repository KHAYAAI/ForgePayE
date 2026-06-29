import { killbillClient, KBSubscription, KBInvoice, KBAccount } from './killbill';
import { query, queryOne, execute } from './db';

export interface DashboardMetrics {
  payments: PaymentMetrics;
  treasury: TreasuryMetrics;
  creditBureau: CreditBureauMetrics;
}

export interface PaymentMetrics {
  transactions24h: number;
  successRate: number;
  fallbackRate: number;
  avgSettlementTime: number;
  totalGMV: number;
  topPaymentMethods: Array<{ method: string; count: number; rate: number }>;
}

export interface TreasuryMetrics {
  dailyNetting: number;
  pendingSettlements: number;
  ofacStatus: string;
  fxSavings: number;
  agentCount: number;
  totalProcessed: number;
}

export interface CreditBureauMetrics {
  inquiries24h: number;
  avgMode1Score: number;
  avgMode2Score: number;
  varianceAlerts: number;
  inquiryRevenue: number;
}

// Sync Kill Bill subscription data to dashboards
export async function syncKillBillToDashboard(tenantId: string) {
  try {
    console.log(`[Kill Bill Sync] Starting sync for tenant: ${tenantId}`);

    // Get all subscriptions from Kill Bill
    const kbSubscriptions = await killbillClient.getAllSubscriptions(100, 0);

    // Get all customers for this tenant
    const customers = await query(
      `SELECT id, kb_account_id FROM users WHERE tenant_id = $1`,
      [tenantId]
    );

    // Sync subscription state to Postgres
    for (const kbSub of kbSubscriptions) {
      const customer = customers.find((c) => c.kb_account_id === kbSub.accountId);
      if (!customer) continue;

      await execute(
        `INSERT INTO subscriptions (id, customer_id, product, plan_name, billing_amount, status, kb_subscription_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (kb_subscription_id)
         DO UPDATE SET status = $6, plan_name = $4`,
        [
          kbSub.subscriptionId,
          customer.id,
          kbSub.productName.toLowerCase(),
          kbSub.planName,
          kbSub.priceListName === 'DEFAULT' ? 15000 : 40000, // Simplified
          kbSub.state.toLowerCase(),
          kbSub.subscriptionId,
        ]
      );
    }

    console.log(`[Kill Bill Sync] Synced ${kbSubscriptions.length} subscriptions`);
  } catch (error) {
    console.error('[Kill Bill Sync] Error:', error);
    throw error;
  }
}

// Fetch Payments metrics from revenue_events
export async function getPaymentMetrics(): Promise<PaymentMetrics> {
  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Transaction count (24h)
    const txnCount = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM revenue_events
       WHERE event_type = 'TRANSFER' AND created_at > $1`,
      [last24h]
    );

    // Success rate (settlements vs attempts)
    const successMetrics = await queryOne<{ success_count: number; total_count: number }>(
      `SELECT
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        COUNT(*) as total_count
       FROM revenue_events
       WHERE event_type = 'SETTLEMENT' AND created_at > $1`,
      [last24h]
    );

    // Fallback rate
    const fallbackMetrics = await queryOne<{ fallback_count: number }>(
      `SELECT COUNT(*) as fallback_count FROM revenue_events
       WHERE event_type = 'SETTLEMENT' AND metadata->>'method' = 'circle_usdc'
       AND created_at > $1`,
      [last24h]
    );

    // Settlement time (avg latency)
    const settlementTime = await queryOne<{ avg_latency: number }>(
      `SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_latency
       FROM revenue_events
       WHERE event_type = 'SETTLEMENT' AND created_at > $1`,
      [last24h]
    );

    // Total GMV
    const gmv = await queryOne<{ total: number }>(
      `SELECT SUM(COALESCE(amount, 0)) as total FROM revenue_events
       WHERE event_type IN ('TRANSFER', 'SETTLEMENT') AND created_at > $1`,
      [last24h]
    );

    // Payment methods breakdown
    const methods = await query<{ method: string; count: number; rate: number }>(
      `SELECT
        metadata->>'method' as method,
        COUNT(*) as count,
        ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM revenue_events WHERE event_type = 'SETTLEMENT' AND created_at > $1), 2) as rate
       FROM revenue_events
       WHERE event_type = 'SETTLEMENT' AND created_at > $1
       GROUP BY method`,
      [last24h]
    );

    return {
      transactions24h: txnCount?.count || 0,
      successRate: successMetrics
        ? Math.round((successMetrics.success_count / successMetrics.total_count) * 100 * 10) / 10
        : 0,
      fallbackRate: fallbackMetrics?.fallback_count || 0,
      avgSettlementTime: settlementTime?.avg_latency || 0,
      totalGMV: gmv?.total || 0,
      topPaymentMethods: methods || [],
    };
  } catch (error) {
    console.error('[Payments Metrics] Error:', error);
    throw error;
  }
}

// Fetch Treasury metrics
export async function getTreasuryMetrics(): Promise<TreasuryMetrics> {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Daily netting amount (sum of agent settlements today)
    const netting = await queryOne<{ total: number }>(
      `SELECT SUM(COALESCE(amount, 0)) as total FROM revenue_events
       WHERE event_type = 'AGENT_ACTION' AND DATE(created_at) = $1`,
      [today]
    );

    // Pending settlements (not yet transferred)
    const pending = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM revenue_events
       WHERE event_type = 'AGENT_ACTION' AND status = 'pending' AND DATE(created_at) = $1`,
      [today]
    );

    // OFAC status (check last screening)
    const ofacStatus = await queryOne<{ status: string }>(
      `SELECT status FROM revenue_events
       WHERE event_type = 'TRANSFER' AND metadata->>'screening' IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      []
    );

    // FX savings (vs market average)
    const fxSavings = await queryOne<{ savings: number }>(
      `SELECT SUM(COALESCE((metadata->>'fx_saving')::numeric, 0)) as savings
       FROM revenue_events
       WHERE event_type = 'SETTLEMENT' AND DATE(created_at) = $1`,
      [today]
    );

    // Agent count (distinct agents)
    const agents = await queryOne<{ count: number }>(
      `SELECT COUNT(DISTINCT metadata->>'agent_id') as count FROM revenue_events
       WHERE event_type = 'AGENT_ACTION' AND DATE(created_at) = $1`,
      [today]
    );

    // Total processed
    const totalProcessed = await queryOne<{ total: number }>(
      `SELECT SUM(COALESCE(amount, 0)) as total FROM revenue_events
       WHERE event_type IN ('AGENT_ACTION', 'SETTLEMENT') AND DATE(created_at) = $1`,
      [today]
    );

    return {
      dailyNetting: netting?.total || 0,
      pendingSettlements: pending?.count || 0,
      ofacStatus: ofacStatus?.status || 'All Clear',
      fxSavings: fxSavings?.savings || 0,
      agentCount: agents?.count || 0,
      totalProcessed: totalProcessed?.total || 0,
    };
  } catch (error) {
    console.error('[Treasury Metrics] Error:', error);
    throw error;
  }
}

// Fetch Credit Bureau metrics
export async function getCreditBureauMetrics(): Promise<CreditBureauMetrics> {
  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Inquiry count (24h)
    const inquiries = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM revenue_events
       WHERE event_type = 'SCORE_UPDATE' AND created_at > $1`,
      [last24h]
    );

    // Average Mode 1 score
    const mode1Avg = await queryOne<{ avg: number }>(
      `SELECT AVG(COALESCE((metadata->>'mode1_score')::numeric, 0)) as avg
       FROM revenue_events
       WHERE event_type = 'SCORE_UPDATE' AND created_at > $1`,
      [last24h]
    );

    // Average Mode 2 score
    const mode2Avg = await queryOne<{ avg: number }>(
      `SELECT AVG(COALESCE((metadata->>'mode2_score')::numeric, 0)) as avg
       FROM revenue_events
       WHERE event_type = 'SCORE_UPDATE' AND created_at > $1`,
      [last24h]
    );

    // Variance alerts (>50 point difference)
    const variance = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM revenue_events
       WHERE event_type = 'SCORE_UPDATE'
       AND ABS(COALESCE((metadata->>'mode1_score')::numeric, 0) - COALESCE((metadata->>'mode2_score')::numeric, 0)) > 50
       AND created_at > $1`,
      [last24h]
    );

    // Inquiry revenue (25% of inquiry fees)
    const revenue = await queryOne<{ total: number }>(
      `SELECT SUM(COALESCE((metadata->>'inquiry_fee')::numeric, 0) * 0.25) as total
       FROM revenue_events
       WHERE event_type = 'SCORE_UPDATE' AND created_at > $1`,
      [last24h]
    );

    return {
      inquiries24h: inquiries?.count || 0,
      avgMode1Score: Math.round(mode1Avg?.avg || 0),
      avgMode2Score: Math.round(mode2Avg?.avg || 0),
      varianceAlerts: variance?.count || 0,
      inquiryRevenue: revenue?.total || 0,
    };
  } catch (error) {
    console.error('[Credit Bureau Metrics] Error:', error);
    throw error;
  }
}

// Get all dashboard metrics
export async function getAllDashboardMetrics(): Promise<DashboardMetrics> {
  const [payments, treasury, creditBureau] = await Promise.all([
    getPaymentMetrics(),
    getTreasuryMetrics(),
    getCreditBureauMetrics(),
  ]);

  return {
    payments,
    treasury,
    creditBureau,
  };
}

// Sync scheduled every hour
export function startKillBillSyncScheduler(tenantId: string, intervalMinutes: number = 60) {
  setInterval(async () => {
    try {
      await syncKillBillToDashboard(tenantId);
    } catch (error) {
      console.error(`[KB Sync Scheduler] Error after ${intervalMinutes}min:`, error);
    }
  }, intervalMinutes * 60 * 1000);

  console.log(`[KB Sync Scheduler] Started (interval: ${intervalMinutes}min)`);
}
