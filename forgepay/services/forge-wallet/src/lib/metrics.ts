/**
 * Prometheus metrics for forge-wallet service
 *
 * Exports:
 *   - Default Prometheus metrics (CPU, memory, GC, etc)
 *   - HTTP request metrics (duration, total)
 *   - Business metrics (wallets, transactions, recovery, gas sponsorship)
 */

import client from 'prom-client';

// ── Initialize Prometheus with default metrics ────────────────────────────────
export const register = new client.Registry();

// Default metrics (CPU, memory, GC, Node.js specific metrics)
client.collectDefaultMetrics({ register });

// ── HTTP Request Metrics ──────────────────────────────────────────────────────

export const httpRequestDuration = new client.Histogram({
  name:      'http_request_duration_seconds',
  help:      'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets:   [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const httpRequestTotal = new client.Counter({
  name:      'http_requests_total',
  help:      'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// ── FORGE Wallet Business Metrics ─────────────────────────────────────────────

/**
 * Wallets created, by owner type.
 * Labels: type (user, agent)
 */
export const walletsCreatedTotal = new client.Counter({
  name:      'forge_wallet_wallets_created_total',
  help:      'Total wallets created',
  labelNames: ['type'],
  registers: [register],
});

/**
 * Transaction status transitions.
 * Labels: status (created, signed, broadcast, confirmed, failed, routed_custody)
 */
export const transactionsTotal = new client.Counter({
  name:      'forge_wallet_transactions_total',
  help:      'Total transaction status transitions',
  labelNames: ['status'],
  registers: [register],
});

/**
 * Gas sponsored (USD) — billed downstream via the gas_sponsorship ledger.
 */
export const gasSponsoredUsdTotal = new client.Counter({
  name:      'forge_wallet_gas_sponsored_usd_total',
  help:      'Total gas sponsorship recorded in USD',
  registers: [register],
});

/**
 * Social recovery requests, by resulting status.
 * Labels: status (pending, approved, completed, expired)
 */
export const recoveryRequestsTotal = new client.Counter({
  name:      'forge_wallet_recovery_requests_total',
  help:      'Total recovery request status transitions',
  labelNames: ['status'],
  registers: [register],
});

/**
 * Revenue-ontology webhook emissions to unified-router.
 * Labels: result (delivered, failed, skipped)
 */
export const webhookEmissionsTotal = new client.Counter({
  name:      'forge_wallet_webhook_emissions_total',
  help:      'Total wallet.transaction.confirmed webhook emissions',
  labelNames: ['result'],
  registers: [register],
});

/**
 * Export metrics in Prometheus text format
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}
