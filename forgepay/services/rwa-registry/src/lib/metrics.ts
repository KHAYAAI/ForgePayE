import * as promClient from 'prom-client';

// Initialize default metrics
promClient.collectDefaultMetrics();

// HTTP request duration histogram (in seconds)
export const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
});

// HTTP request total counter
export const httpRequestTotal = new promClient.Counter({
  name: 'http_request_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

// RWA registry specific: token registration duration (seconds)
export const tokenRegistrationDuration = new promClient.Histogram({
  name: 'token_registration_duration_seconds',
  help: 'Time taken to register a token in the RWA registry',
  labelNames: ['asset_id'],
  buckets: [0.01, 0.1, 0.5, 1, 2, 5, 10],
});

// RWA registry specific: total tokens registered (gauge)
export const tokensRegisteredTotal = new promClient.Gauge({
  name: 'tokens_registered_total',
  help: 'Total number of tokens registered in the RWA registry',
});

// Export metrics registry for /metrics endpoint
export const register = promClient.register;
