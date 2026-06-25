/**
 * Prometheus Metrics — agent-identity
 *
 * Tracks:
 *   - HTTP request duration and count by method/route/status
 *   - DID registration, identity verification, and attestation validation
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

// ── Identity Metrics ──────────────────────────────────────────────────────

export const didRegistrationDurationSeconds = new promClient.Histogram({
  name: 'did_registration_duration_seconds',
  help: 'Time taken to register a DID-based agent identity (in seconds)',
  labelNames: ['status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

export const identityVerificationsTotal = new promClient.Counter({
  name: 'identity_verifications_total',
  help: 'Total number of identity verification operations',
  labelNames: ['operation', 'result'],
  registers: [registry],
});

export const attestationValidationsTotal = new promClient.Counter({
  name: 'attestation_validations_total',
  help: 'Total number of attestation validations performed',
  labelNames: ['claim_type', 'result'],
  registers: [registry],
});

export const reputationEventsDurationSeconds = new promClient.Histogram({
  name: 'reputation_events_duration_seconds',
  help: 'Time taken to record a reputation event (in seconds)',
  labelNames: ['event_type', 'status'],
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
