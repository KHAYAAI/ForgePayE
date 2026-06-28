/**
 * Kill Bill Subscription Sync Service
 *
 * Mitigates: "Kill Bill subscription sync fails" (Critical Risk)
 *
 * Monitors Kill Bill → Postgres sync integrity
 * - Hourly verification of subscription state
 * - Automatic reconciliation on divergence
 * - Audit trail for all sync operations
 */

import { db } from '../db';
import * as killbill from '../lib/killbill-client';

interface SyncAuditLog {
  id: string;
  timestamp: Date;
  operation: 'verify' | 'reconcile' | 'divergence_detected' | 'fix_applied';
  customerId: string;
  product: string;
  kbSubscriptionId: string;
  expectedState: string;
  actualState: string;
  action: string;
  success: boolean;
  errorMessage?: string;
}

const AUDIT_LOGS: SyncAuditLog[] = [];

export async function startKillBillSyncMonitoring(intervalMs = 3600000) {
  console.info(`[KB Sync] Starting Kill Bill sync monitoring (interval: ${intervalMs}ms)`);

  setInterval(async () => {
    try {
      await verifyAllSubscriptions();
    } catch (err) {
      console.error('[KB Sync] Verification failed:', err);
      await logAudit({
        operation: 'verify',
        customerId: 'system',
        product: 'all',
        kbSubscriptionId: '',
        expectedState: 'running',
        actualState: 'error',
        action: `Sync verification failed: ${String(err)}`,
        success: false,
        errorMessage: String(err),
      });
    }
  }, intervalMs);
}

async function verifyAllSubscriptions(): Promise<void> {
  console.info('[KB Sync] Starting subscription verification...');

  // Get all active subscriptions from Postgres
  const result = await db.query(
    'public',
    `
      SELECT 
        customer_id,
        subscriptions
      FROM customers
      WHERE subscriptions != '{}'::jsonb AND subscriptions IS NOT NULL
    `,
    []
  );

  let verifiedCount = 0;
  let divergenceCount = 0;

  for (const customer of result.rows) {
    const customerId = customer.customer_id;
    const subscriptions = customer.subscriptions || {};

    for (const [product, subData] of Object.entries(subscriptions)) {
      const sub = subData as any;
      if (!sub.kb_subscription_id) continue;

      try {
        // Fetch from Kill Bill
        const kbSub = await killbill.getSubscription(sub.kb_subscription_id);

        // Compare states
        if (kbSub.state !== sub.expected_state) {
          console.warn(
            `[KB Sync] Divergence detected: ${customerId}/${product} expected=${sub.expected_state} actual=${kbSub.state}`
          );
          divergenceCount++;

          // Log divergence
          await logAudit({
            operation: 'divergence_detected',
            customerId,
            product,
            kbSubscriptionId: sub.kb_subscription_id,
            expectedState: sub.expected_state,
            actualState: kbSub.state,
            action: `State mismatch detected; KB says ${kbSub.state}`,
            success: false,
          });

          // Attempt reconciliation
          await reconcileSubscription(customerId, product, sub.kb_subscription_id, kbSub.state);
        } else {
          verifiedCount++;
        }
      } catch (err) {
        console.error(`[KB Sync] Verification failed for ${customerId}/${product}:`, err);
        await logAudit({
          operation: 'verify',
          customerId,
          product,
          kbSubscriptionId: sub.kb_subscription_id,
          expectedState: sub.expected_state,
          actualState: 'unknown',
          action: `KB fetch failed: ${String(err)}`,
          success: false,
          errorMessage: String(err),
        });
      }
    }
  }

  console.info(
    `[KB Sync] Verification complete: ${verifiedCount} verified, ${divergenceCount} divergences found`
  );
}

async function reconcileSubscription(
  customerId: string,
  product: string,
  kbSubscriptionId: string,
  actualState: string
): Promise<void> {
  console.info(
    `[KB Sync] Attempting reconciliation for ${customerId}/${product} to state ${actualState}`
  );

  try {
    // Update Postgres to match KB state
    await db.query(
      'public',
      `
        UPDATE customers
        SET subscriptions = jsonb_set(
          subscriptions,
          '{${product}, expected_state}',
          '"${actualState}"'
        )
        WHERE id = $1
      `,
      [customerId]
    );

    await logAudit({
      operation: 'reconcile',
      customerId,
      product,
      kbSubscriptionId,
      expectedState: actualState,
      actualState,
      action: `Updated Postgres to match KB state: ${actualState}`,
      success: true,
    });

    console.info(`[KB Sync] Reconciliation successful for ${customerId}/${product}`);
  } catch (err) {
    console.error(`[KB Sync] Reconciliation failed:`, err);
    await logAudit({
      operation: 'reconcile',
      customerId,
      product,
      kbSubscriptionId,
      expectedState: actualState,
      actualState: 'reconciliation_failed',
      action: `Reconciliation failed: ${String(err)}`,
      success: false,
      errorMessage: String(err),
    });

    // Alert ops team (send to Slack, PagerDuty, etc.)
    alertOpsTeam(
      `Kill Bill sync reconciliation failed for ${customerId}/${product}. Manual intervention required.`
    );
  }
}

async function logAudit(log: Omit<SyncAuditLog, 'id' | 'timestamp'>): Promise<void> {
  const auditLog: SyncAuditLog = {
    id: `kb-sync-${Date.now()}`,
    timestamp: new Date(),
    ...log,
  };

  AUDIT_LOGS.push(auditLog);

  // Keep only last 10K logs in memory
  if (AUDIT_LOGS.length > 10000) {
    AUDIT_LOGS.splice(0, AUDIT_LOGS.length - 10000);
  }

  // Also persist to DB for permanent record
  try {
    await db.query(
      'public',
      `
        INSERT INTO killbill_sync_audit 
        (operation, customer_id, product, kb_subscription_id, expected_state, actual_state, action, success, error_message, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `,
      [
        auditLog.operation,
        auditLog.customerId,
        auditLog.product,
        auditLog.kbSubscriptionId,
        auditLog.expectedState,
        auditLog.actualState,
        auditLog.action,
        auditLog.success,
        auditLog.errorMessage || null,
      ]
    );
  } catch (err) {
    console.error('[KB Sync] Failed to persist audit log:', err);
  }
}

export function getAuditLogs(limit = 100): SyncAuditLog[] {
  return AUDIT_LOGS.slice(-limit);
}

function alertOpsTeam(message: string): void {
  // Send to Slack #ops-alerts (if webhook available)
  console.error(`[ALERT] ${message}`);
  // TODO: Implement Slack webhook
}

// Migration to create audit table
export const KILLBILL_SYNC_MIGRATION = `
CREATE TABLE IF NOT EXISTS killbill_sync_audit (
  id BIGSERIAL PRIMARY KEY,
  operation VARCHAR(50) NOT NULL,
  customer_id UUID,
  product VARCHAR(50),
  kb_subscription_id VARCHAR(255),
  expected_state VARCHAR(50),
  actual_state VARCHAR(50),
  action TEXT,
  success BOOLEAN,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  INDEX idx_customer_product (customer_id, product),
  INDEX idx_timestamp (created_at DESC)
);
`;
