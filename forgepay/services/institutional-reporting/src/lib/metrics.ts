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

// Institutional reporting specific: report generation duration (seconds)
export const reportGenerationDuration = new promClient.Histogram({
  name: 'report_generation_duration_seconds',
  help: 'Time taken to generate a report',
  labelNames: ['report_type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

// Institutional reporting specific: total reports generated (counter)
export const reportsGeneratedTotal = new promClient.Counter({
  name: 'reports_generated_total',
  help: 'Total number of reports generated',
  labelNames: ['report_type', 'status'],
});

// Export metrics registry for /metrics endpoint
export const register = promClient.register;
