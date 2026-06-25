import * as promClient from 'prom-client';

// Initialize default metrics and register
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

// HTTP request duration histogram (in seconds)
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// HTTP request counter
const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// Stablecoin transfer duration (in seconds)
const stablecoinTransferDuration = new promClient.Histogram({
  name: 'stablecoin_transfer_duration_seconds',
  help: 'Stablecoin transfer operation duration in seconds',
  labelNames: ['chain', 'token', 'status'],
  registers: [register],
});

// Stablecoin transfer errors counter
const stablecoinTransferErrors = new promClient.Counter({
  name: 'stablecoin_transfer_errors_total',
  help: 'Total stablecoin transfer errors',
  labelNames: ['chain', 'token', 'error_type'],
  registers: [register],
});

export {
  register,
  httpRequestDuration,
  httpRequestTotal,
  stablecoinTransferDuration,
  stablecoinTransferErrors,
};
