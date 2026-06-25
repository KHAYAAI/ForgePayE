/**
 * Prometheus metrics for the yield-engine service.
 * Exports initialized metrics with a default registry.
 * Metrics are exposed at GET /metrics in Prometheus text format.
 */

import * as promClient from 'prom-client';

// ── Registry & defaults ───────────────────────────────────────────────────────

export const register = new promClient.Registry();

// Load default metrics (CPU, memory, Node.js internals)
promClient.collectDefaultMetrics({ register });

// ── HTTP metrics ──────────────────────────────────────────────────────────────

/**
 * Histogram tracking HTTP request duration in seconds.
 * Labels: method, route (normalized), status_code
 */
export const httpRequestDuration = new promClient.Histogram({
  name:      'http_request_duration_seconds',
  help:      'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets:   [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

/**
 * Counter tracking total HTTP requests.
 * Labels: method, route (normalized), status_code
 */
export const httpRequestTotal = new promClient.Counter({
  name:       'http_request_total',
  help:       'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers:  [register],
});

// ── Yield operation metrics ───────────────────────────────────────────────────

/**
 * Histogram tracking sweep job execution duration in seconds.
 * Labels: none (global across all sweeps)
 */
export const sweepJobDuration = new promClient.Histogram({
  name:    'sweep_job_duration_seconds',
  help:    'Sweep job execution duration in seconds',
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120],
  registers: [register],
});

/**
 * Counter tracking total amount swept in USD.
 * Labels: none (cumulative across all sweeps)
 */
export const sweptBalancesTotal = new promClient.Counter({
  name:    'swept_balances_total',
  help:    'Total amount swept in USD',
  registers: [register],
});

/**
 * Counter tracking total yield earnings in USD.
 * Labels: none (cumulative across all yield accruals)
 */
export const yieldEarnedTotal = new promClient.Counter({
  name:    'yield_earned_total',
  help:    'Total yield earned in USD',
  registers: [register],
});

/**
 * Counter tracking sweep errors.
 * Labels: error_reason (e.g., 'balance_fetch_failed', 'deposit_failed', 'db_write_failed')
 */
export const sweepErrorsTotal = new promClient.Counter({
  name:       'sweep_errors_total',
  help:       'Total sweep errors by reason',
  labelNames: ['error_reason'],
  registers:  [register],
});
