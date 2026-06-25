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

// Bank-whitelabel specific: whitelabel setup duration (seconds)
export const whitelabelSetupDuration = new promClient.Histogram({
  name: 'whitelabel_setup_duration_seconds',
  help: 'Time taken to set up a whitelabel configuration',
  labelNames: ['bank_id'],
  buckets: [0.01, 0.1, 0.5, 1, 2, 5, 10],
});

// Bank-whitelabel specific: total whitelabel configurations (gauge)
export const whitelabelConfigsTotal = new promClient.Gauge({
  name: 'whitelabel_configs_total',
  help: 'Total number of whitelabel configurations',
});

// Export metrics registry for /metrics endpoint
export const register = promClient.register;
