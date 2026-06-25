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

// Crypto payment creation duration (in seconds)
const cryptoPaymentCreationDuration = new promClient.Histogram({
  name: 'crypto_payment_creation_duration_seconds',
  help: 'Crypto payment creation operation duration in seconds',
  labelNames: ['coin', 'status'],
  registers: [register],
});

// Crypto payment errors counter
const cryptoPaymentErrors = new promClient.Counter({
  name: 'crypto_payment_errors_total',
  help: 'Total crypto payment creation errors',
  labelNames: ['coin', 'error_type'],
  registers: [register],
});

export {
  register,
  httpRequestDuration,
  httpRequestTotal,
  cryptoPaymentCreationDuration,
  cryptoPaymentErrors,
};
