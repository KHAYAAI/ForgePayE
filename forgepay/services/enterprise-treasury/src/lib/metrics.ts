/**
 * Prometheus metrics for enterprise-treasury service
 *
 * Exports:
 *   - Default Prometheus metrics (CPU, memory, GC, etc)
 *   - HTTP request metrics (duration, total)
 *   - Business metrics (netting jobs, cash flow analysis)
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

// ── Enterprise Treasury Business Metrics ──────────────────────────────────────

/**
 * Duration of netting job execution (intercompany flow calculation and settlement)
 * Labels: status (completed, failed)
 */
export const nettingJobDuration = new client.Histogram({
  name:      'netting_job_duration_seconds',
  help:      'Duration of netting job execution in seconds',
  labelNames: ['status'],
  buckets:   [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

/**
 * Total count of transactions processed by netting engine
 * Labels: result (netted, skipped)
 */
export const nettingTransactionsTotal = new client.Counter({
  name:      'netting_transactions_total',
  help:      'Total transactions processed by netting engine',
  labelNames: ['result'],
  registers: [register],
});

/**
 * Duration of cash flow analysis operations (consolidation, reporting)
 * Labels: operation (consolidate, analyze_by_subsidiary, analyze_by_currency)
 */
export const cashFlowAnalysisDuration = new client.Histogram({
  name:      'cash_flow_analysis_duration_seconds',
  help:      'Duration of cash flow analysis operations in seconds',
  labelNames: ['operation'],
  buckets:   [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

/**
 * Export metrics in Prometheus text format
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}
