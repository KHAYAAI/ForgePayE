import * as promClient from 'prom-client';

export class Metrics {
  private static instance: Metrics;

  // Standard HTTP metrics
  readonly httpRequestDuration: promClient.Histogram<
    'method' | 'route' | 'status_code'
  >;
  readonly httpRequestTotal: promClient.Counter<
    'method' | 'route' | 'status_code'
  >;

  // Service-specific metrics
  readonly negotiationDuration: promClient.Histogram;
  readonly negotiationsTotal: promClient.Counter;

  private constructor() {
    // Register default metrics (gc, heap, etc.)
    promClient.collectDefaultMetrics();

    // HTTP request duration histogram
    this.httpRequestDuration = new promClient.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    });

    // HTTP request total counter
    this.httpRequestTotal = new promClient.Counter({
      name: 'http_request_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });

    // Negotiation duration histogram (seconds)
    this.negotiationDuration = new promClient.Histogram({
      name: 'negotiation_duration_seconds',
      help: 'Duration of a negotiation in seconds',
      buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    });

    // Negotiations counter
    this.negotiationsTotal = new promClient.Counter({
      name: 'negotiations_total',
      help: 'Total number of negotiations',
    });
  }

  static getInstance(): Metrics {
    if (!Metrics.instance) {
      Metrics.instance = new Metrics();
    }
    return Metrics.instance;
  }

  /**
   * Get all metrics in Prometheus text format
   */
  static async register(): Promise<string> {
    return promClient.register.metrics();
  }
}

export const metrics = Metrics.getInstance();
