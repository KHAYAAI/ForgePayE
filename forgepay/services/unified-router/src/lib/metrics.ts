/**
 * Prometheus metrics for the unified-router service.
 *
 * Metrics collected:
 *   - httpRequestDuration: Histogram of request durations (method, route, status_code)
 *   - httpRequestTotal: Counter of total requests (method, route, status_code)
 *   - webhookProcessingDuration: Histogram of webhook processing time (source)
 *   - webhookDedupHits: Counter of deduplicated webhooks (source)
 *   - webhookDedupMisses: Counter of new webhook events (source)
 *   - webhookNormalizationErrors: Counter of normalization failures (source)
 */

import { register, Counter, Histogram } from 'prom-client';

// Initialize default metrics (CPU, memory, GC, etc.)
export { register, collectDefaultMetrics } from 'prom-client';
import { collectDefaultMetrics } from 'prom-client';

collectDefaultMetrics({ register });

// HTTP request duration (in seconds)
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// HTTP request total counter
export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

// Webhook processing duration (in seconds)
export const webhookProcessingDuration = new Histogram({
  name: 'webhook_processing_duration_seconds',
  help: 'Webhook processing pipeline duration in seconds',
  labelNames: ['source'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

// Webhook deduplication hits (duplicates detected and dropped)
export const webhookDedupHits = new Counter({
  name: 'webhook_dedup_hits_total',
  help: 'Total number of deduplicated (duplicate) webhooks',
  labelNames: ['source'],
});

// Webhook deduplication misses (new events)
export const webhookDedupMisses = new Counter({
  name: 'webhook_dedup_misses_total',
  help: 'Total number of new webhook events (not duplicates)',
  labelNames: ['source'],
});

// Webhook normalization errors
export const webhookNormalizationErrors = new Counter({
  name: 'webhook_normalization_errors_total',
  help: 'Total number of webhook normalization errors',
  labelNames: ['source'],
});
