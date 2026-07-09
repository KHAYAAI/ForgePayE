/**
 * Churn Monitoring & Prevention Playbook
 *
 * Mitigates: "Churn >10% in first 30d" (High Risk)
 *
 * Monitors:
 * - Subscription cancellations
 * - MRR decline (>20% month-over-month)
 * - Feature adoption (API calls, settlement runs, scores settled)
 * - Engagement score
 */

import { db } from '../db';
import { createCrmTask, sendSlackAlert } from './notifications.js';

export interface ChurnSignal {
  customerId: string;
  product: string;
  signalType: 'cancellation_request' | 'low_usage' | 'mrr_decline' | 'api_inactivity';
  severity: 'high' | 'medium' | 'low';
  reason: string;
  recommendedAction: string;
}

const CHURN_SIGNALS: ChurnSignal[] = [];

export async function detectChurnRisk(): Promise<ChurnSignal[]> {
  console.info('[Churn Prevention] Running churn risk detection...');

  const signals: ChurnSignal[] = [];

  // Signal 1: MRR declined >20% month-over-month
  const mrrDeclineSignals = await detectMRRDecline();
  signals.push(...mrrDeclineSignals);

  // Signal 2: No API calls in last 7 days (Payments)
  const apiInactivitySignals = await detectAPIInactivity();
  signals.push(...apiInactivitySignals);

  // Signal 3: No settlements in last 14 days (Treasury)
  const settlementInactivitySignals = await detectSettlementInactivity();
  signals.push(...settlementInactivitySignals);

  // Signal 4: Cancellation request submitted
  const cancellationSignals = await detectCancellationRequests();
  signals.push(...cancellationSignals);

  console.info(`[Churn Prevention] Detected ${signals.length} churn signals`);

  // Store signals
  CHURN_SIGNALS.push(...signals);

  // Alert ops for high-severity signals
  for (const signal of signals) {
    if (signal.severity === 'high') {
      console.error(`[Churn Prevention] HIGH RISK: ${signal.customerId} - ${signal.reason}`);
      await notifyCSM(signal);
    }
  }

  return signals;
}

async function detectMRRDecline(): Promise<ChurnSignal[]> {
  const signals: ChurnSignal[] = [];

  const result = await db.query(
    'public',
    `
      WITH monthly_mrr AS (
        SELECT 
          customer_id,
          DATE_TRUNC('month', event_timestamp)::DATE as month,
          product,
          CASE 
            WHEN product = 'payments' THEN SUM((metadata->>'amount')::BIGINT) / 100.0
            ELSE 40000  -- Treasury/CB flat fees
          END as mrr
        FROM revenue_events
        WHERE event_type IN ('TRANSFER', 'SETTLEMENT')
        GROUP BY customer_id, DATE_TRUNC('month', event_timestamp), product
      )
      SELECT 
        customer_id,
        product,
        LAG(mrr) OVER (PARTITION BY customer_id, product ORDER BY month) as prev_mrr,
        mrr as curr_mrr
      FROM monthly_mrr
      WHERE month >= NOW()::DATE - INTERVAL '60 days'
    `,
    []
  );

  for (const row of result.rows) {
    if (row.prev_mrr && row.curr_mrr / row.prev_mrr < 0.8) {
      // MRR declined >20%
      signals.push({
        customerId: row.customer_id,
        product: row.product,
        signalType: 'mrr_decline',
        severity: 'high',
        reason: `MRR declined ${((1 - row.curr_mrr / row.prev_mrr) * 100).toFixed(0)}% (R${row.prev_mrr.toLocaleString()} → R${row.curr_mrr.toLocaleString()})`,
        recommendedAction: 'Call customer: "We noticed your usage is down. Everything okay? Anything we can help with?"',
      });
    }
  }

  return signals;
}

async function detectAPIInactivity(): Promise<ChurnSignal[]> {
  const signals: ChurnSignal[] = [];

  const result = await db.query(
    'public',
    `
      SELECT 
        customer_id,
        MAX(event_timestamp) as last_activity
      FROM revenue_events
      WHERE product = 'payments' AND event_type = 'TRANSFER'
      GROUP BY customer_id
      HAVING MAX(event_timestamp) < NOW() - INTERVAL '7 days'
    `,
    []
  );

  for (const row of result.rows) {
    signals.push({
      customerId: row.customer_id,
      product: 'payments',
      signalType: 'api_inactivity',
      severity: 'medium',
      reason: `No API activity for ${Math.floor((Date.now() - new Date(row.last_activity).getTime()) / (1000 * 60 * 60 * 24))} days`,
      recommendedAction: 'Email: "Noticed you haven\'t processed charges lately. Need help getting started?"',
    });
  }

  return signals;
}

async function detectSettlementInactivity(): Promise<ChurnSignal[]> {
  const signals: ChurnSignal[] = [];

  const result = await db.query(
    'public',
    `
      SELECT 
        customer_id,
        MAX(event_timestamp) as last_settlement
      FROM revenue_events
      WHERE product = 'treasury' AND event_type = 'SETTLEMENT'
      GROUP BY customer_id
      HAVING MAX(event_timestamp) < NOW() - INTERVAL '14 days'
    `,
    []
  );

  for (const row of result.rows) {
    signals.push({
      customerId: row.customer_id,
      product: 'treasury',
      signalType: 'api_inactivity',
      severity: 'medium',
      reason: `No settlement in ${Math.floor((Date.now() - new Date(row.last_settlement).getTime()) / (1000 * 60 * 60 * 24))} days`,
      recommendedAction: 'Call: "Noticed netting isn\'t running. Is there a configuration issue we can fix?"',
    });
  }

  return signals;
}

async function detectCancellationRequests(): Promise<ChurnSignal[]> {
  const signals: ChurnSignal[] = [];

  // Check for cancellation events in revenue_events
  const result = await db.query(
    'public',
    `
      SELECT 
        customer_id,
        product,
        event_timestamp
      FROM revenue_events
      WHERE event_type = 'SUBSCRIPTION_CANCELLED'
      AND event_timestamp > NOW() - INTERVAL '7 days'
    `,
    []
  );

  for (const row of result.rows) {
    signals.push({
      customerId: row.customer_id,
      product: row.product,
      signalType: 'cancellation_request',
      severity: 'high',
      reason: `Cancellation requested ${Math.floor((Date.now() - new Date(row.event_timestamp).getTime()) / (1000 * 60 * 60))}h ago`,
      recommendedAction: 'Immediate CSM call: Offer pause, discount, or downgrade to retain customer',
    });
  }

  return signals;
}

async function notifyCSM(signal: ChurnSignal): Promise<void> {
  console.error(`[Churn Prevention] Notifying CSM of high-risk churn: ${signal.customerId}`);

  const severityToPriority: Record<ChurnSignal['severity'], 'high' | 'normal' | 'low'> = {
    high: 'high',
    medium: 'normal',
    low: 'low',
  };

  await Promise.all([
    createCrmTask({
      subjectId: signal.customerId,
      title: `Churn risk (${signal.severity}) — ${signal.customerId}`,
      description: `Product: ${signal.product}\nSignal: ${signal.signalType}\nReason: ${signal.reason}\nRecommended action: ${signal.recommendedAction}`,
      priority: severityToPriority[signal.severity],
      tags: ['churn', signal.product, signal.signalType],
    }),
    sendSlackAlert(
      `:rotating_light: *Churn risk (${signal.severity})* — \`${signal.customerId}\` (${signal.product})\n` +
        `Signal: ${signal.signalType}\n` +
        `Reason: ${signal.reason}\n` +
        `Recommended action: ${signal.recommendedAction}`,
      { channel: '#csm' },
    ),
  ]);
}

export function getChurnSignals(): ChurnSignal[] {
  return CHURN_SIGNALS.slice(-100); // Last 100 signals
}

export async function recordChurnPrevention(
  customerId: string,
  action: 'discount_offered' | 'pause_offered' | 'downgrade_offered' | 'call_completed' | 'reactivated',
  outcome: 'success' | 'failed'
): Promise<void> {
  // Log prevention attempt
  console.info(`[Churn Prevention] ${action} for ${customerId}: ${outcome}`);

  // TODO: Track success rate of each action
  // TODO: Update customer LTV if retained
}
