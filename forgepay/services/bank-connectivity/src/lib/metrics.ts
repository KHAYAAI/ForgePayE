/**
 * Prometheus metrics for bank-connectivity service
 *
 * Exports:
 *   - Default Prometheus metrics (CPU, memory, GC, etc)
 *   - HTTP request metrics (duration, total)
 *   - Business metrics (Plaid sync, transfers, errors)
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

// ── Bank Connectivity Business Metrics ────────────────────────────────────────

/**
 * Duration of Plaid sync operations (account discovery, transaction sync)
 * Labels: operation (discover_accounts, sync_transactions, get_balance)
 */
export const plaidSyncDuration = new client.Histogram({
  name:      'plaid_sync_duration_seconds',
  help:      'Duration of Plaid API operations in seconds',
  labelNames: ['operation'],
  buckets:   [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

/**
 * Total number of Plaid accounts discovered/synced
 * Labels: status (active, archived, error)
 */
export const plaidAccountsTotal = new client.Gauge({
  name:      'plaid_accounts_total',
  help:      'Total Plaid accounts by status',
  labelNames: ['status'],
  registers: [register],
});

/**
 * Duration of transfer initiation operations (ACH, SEPA, wire)
 * Labels: type (ach, sepa, wire), status (initiated, failed)
 */
export const transferInitiationDuration = new client.Histogram({
  name:      'transfer_initiation_duration_seconds',
  help:      'Duration of transfer initiation operations in seconds',
  labelNames: ['type', 'status'],
  buckets:   [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

/**
 * Total count of transfer errors
 * Labels: type (ach, sepa, wire), error_code
 */
export const transferErrorsTotal = new client.Counter({
  name:      'transfer_errors_total',
  help:      'Total transfer initiation errors',
  labelNames: ['type', 'error_code'],
  registers: [register],
});

/**
 * Export metrics in Prometheus text format
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}
