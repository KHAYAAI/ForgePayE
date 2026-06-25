/**
 * Prometheus Metrics — agent-credit-lines
 *
 * Tracks:
 *   - HTTP request duration and count by method/route/status
 *   - Credit issuance operations (duration, total lines, defaults)
 */

import * as promClient from 'prom-client';

// Initialize default metrics (process, nodejs, gc)
promClient.collectDefaultMetrics();

const registry = promClient.register;

// ── HTTP Metrics ──────────────────────────────────────────────────────────

export const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [registry],
});

export const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

// ── Credit Lines Metrics ──────────────────────────────────────────────────

export const creditIssuanceDurationSeconds = new promClient.Histogram({
  name: 'credit_issuance_duration_seconds',
  help: 'Time taken to issue a credit line (in seconds)',
  labelNames: ['status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

export const creditLinesTotalGauge = new promClient.Gauge({
  name: 'credit_lines_total',
  help: 'Total number of active credit lines',
  labelNames: ['status'],
  registers: [registry],
});

export const creditDefaultsTotal = new promClient.Counter({
  name: 'credit_defaults_total',
  help: 'Total number of credit defaults detected',
  labelNames: ['reason'],
  registers: [registry],
});

export const creditDrawsDurationSeconds = new promClient.Histogram({
  name: 'credit_draws_duration_seconds',
  help: 'Time taken to create or process a credit draw (in seconds)',
  labelNames: ['operation', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

export const creditRepaymentDurationSeconds = new promClient.Histogram({
  name: 'credit_repayment_duration_seconds',
  help: 'Time taken to process a repayment (in seconds)',
  labelNames: ['status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

// ── Metric Helpers ────────────────────────────────────────────────────────

/**
 * Record HTTP request metrics
 */
export function recordHttpRequest(options: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}): void {
  const { method, route, statusCode, durationMs } = options;
  httpRequestDuration.labels(method, route, String(statusCode)).observe(durationMs / 1000);
  httpRequestTotal.labels(method, route, String(statusCode)).inc();
}

/**
 * Get the Prometheus registry (for exporting metrics)
 */
export function getRegistry(): promClient.Registry {
  return registry;
}
