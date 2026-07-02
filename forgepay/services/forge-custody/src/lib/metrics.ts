/**
 * Prometheus metrics for the forge-custody service
 *
 * Exports:
 *   - Default Prometheus metrics (CPU, memory, GC, etc)
 *   - HTTP request metrics (duration, total)
 *   - Business metrics (signing lifecycle, policy violations, webhooks)
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

// ── FORGE Custody Business Metrics ────────────────────────────────────────────

/**
 * Signing requests by terminal-or-transition status
 * Labels: status (pending_policy, pending_approval, approved, signing, broadcast, confirmed, rejected, failed)
 */
export const signingRequestsTotal = new client.Counter({
  name:      'custody_signing_requests_total',
  help:      'Total signing requests by status transition',
  labelNames: ['status'],
  registers: [register],
});

/**
 * Policy violations that rejected a signing request before the MPC boundary
 * Labels: reason_code (DAILY_LIMIT_EXCEEDED, DESTINATION_NOT_WHITELISTED, ...)
 */
export const policyViolationsTotal = new client.Counter({
  name:      'custody_policy_violations_total',
  help:      'Total signing requests rejected by the policy engine',
  labelNames: ['reason_code'],
  registers: [register],
});

/**
 * End-to-end signing latency (policy pass → confirmed), by signer backend
 * Labels: signer (dev-signer, mpc-coordinator)
 */
export const signingDuration = new client.Histogram({
  name:      'custody_signing_duration_seconds',
  help:      'End-to-end signing pipeline duration in seconds',
  labelNames: ['signer'],
  buckets:   [0.01, 0.1, 0.5, 1, 5, 15, 60, 300],
  registers: [register],
});

/**
 * Revenue-ontology webhook deliveries to unified-router
 * Labels: status (delivered, failed, skipped)
 */
export const webhookEventsTotal = new client.Counter({
  name:      'custody_webhook_events_total',
  help:      'Total custody.signature.confirmed events emitted to unified-router',
  labelNames: ['status'],
  registers: [register],
});

/**
 * Authentication failures on the HMAC boundary
 * Labels: reason (missing_headers, invalid_api_key, timestamp_out_of_window, invalid_signature, signature_replayed)
 */
export const authFailuresTotal = new client.Counter({
  name:      'custody_auth_failures_total',
  help:      'Total rejected requests at the HMAC auth boundary',
  labelNames: ['reason'],
  registers: [register],
});

/**
 * Export metrics in Prometheus text format
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}
