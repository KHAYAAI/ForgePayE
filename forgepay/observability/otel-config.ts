/**
 * OpenTelemetry SDK Initialization
 * Configures tracing, metrics, and logs exporters for ForgePay services
 *
 * Usage:
 *   import { initializeOTelSDK } from './observability/otel-config';
 *   initializeOTelSDK('unified-router').then(() => {
 *     // Start your application
 *   });
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis-4';
import { MySQLInstrumentation } from '@opentelemetry/instrumentation-mysql';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';

interface OTelConfig {
  serviceName: string;
  version?: string;
  environment?: string;
  otlpEndpoint?: string;
  enableConsoleExporter?: boolean;
}

/**
 * Initialize OpenTelemetry SDK with comprehensive instrumentation
 *
 * @param serviceName - Name of the service (e.g., 'unified-router', 'mor-layer')
 * @param config - Optional configuration overrides
 * @returns NodeSDK instance
 */
export function initializeOTelSDK(
  serviceName: string,
  config: Partial<OTelConfig> = {}
): NodeSDK {
  // Read environment variables
  const otlpEndpoint =
    config.otlpEndpoint ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    'http://localhost:4317';

  const environment =
    config.environment ||
    process.env.NODE_ENV ||
    'development';

  const version =
    config.version ||
    process.env.npm_package_version ||
    '0.1.0';

  const enableConsoleExporter =
    config.enableConsoleExporter ??
    process.env.OTEL_CONSOLE_EXPORTER === 'true';

  // Create resource with standard attributes
  const resource = Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: version,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environment,
      'service.namespace': 'forgepay',
      'host.hostname': process.env.HOSTNAME || 'unknown',
    })
  );

  // Trace exporter
  const traceExporter = new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  });

  // Metric exporter with periodic export
  const metricExporter = new OTLPMetricExporter({
    url: `${otlpEndpoint}/v1/metrics`,
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    intervalMillis: 30000, // Export every 30 seconds
  });

  // Log exporter
  const logExporter = new OTLPLogExporter({
    url: `${otlpEndpoint}/v1/logs`,
  });

  // Auto-instrumentation for common libraries
  const instrumentations = [
    // HTTP instrumentation
    new HttpInstrumentation({
      requestHook: (span, request) => {
        span.setAttribute('http.client_ip', request.socket?.remoteAddress || 'unknown');
      },
      responseHook: (span, response) => {
        // Response hook for additional attributes
      },
    }),

    // Fastify instrumentation (if using Fastify)
    new FastifyInstrumentation({
      requestHook: (span, request) => {
        if (request.headers?.['x-request-id']) {
          span.setAttribute('request.id', request.headers['x-request-id']);
        }
      },
    }),

    // PostgreSQL instrumentation
    new PgInstrumentation({
      enhancedDatabaseReporting: true,
      responseHook: (span, result) => {
        // Optionally add response metadata
      },
    }),

    // Redis instrumentation
    new RedisInstrumentation({
      responseHook: (span, cmdArgs, response) => {
        // Track Redis command arguments safely (avoid PII)
        span.setAttribute('db.redis.command', cmdArgs[0]?.toString() || 'unknown');
      },
    }),

    // MySQL instrumentation
    new MySQLInstrumentation(),

    // Node.js auto-instrumentations (http, dns, fs, etc.)
    ...getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': {
        enabled: false, // Disable by default to reduce noise
      },
      '@opentelemetry/instrumentation-dns': {
        enabled: false,
      },
    }),
  ];

  // Add console exporter for local development
  const spanProcessors = enableConsoleExporter
    ? [new SimpleSpanProcessor(new ConsoleSpanExporter())]
    : [];

  // Create SDK
  const sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations,
    spanProcessor: spanProcessors,
    logRecordProcessor: new BatchLogRecordProcessor(logExporter, {
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
      scheduledDelayMillis: 5000,
    }),
  });

  return sdk;
}

/**
 * Start the SDK and set up graceful shutdown
 *
 * @param sdk - NodeSDK instance
 * @param onShutdown - Optional callback when shutdown is initiated
 */
export async function startOTelSDK(
  sdk: NodeSDK,
  onShutdown?: () => Promise<void>
): Promise<void> {
  sdk.start();
  console.log('[OTEL] SDK started');

  // Graceful shutdown handlers
  const shutdown = async () => {
    console.log('[OTEL] Shutting down...');
    if (onShutdown) {
      await onShutdown();
    }
    await sdk.shutdown();
    console.log('[OTEL] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * Quick start helper: Initialize and start SDK in one call
 *
 * @param serviceName - Name of the service
 * @param config - Optional configuration
 * @returns Promise that resolves when SDK is started
 *
 * @example
 *   await initAndStartOTel('unified-router');
 *   // Start your application
 */
export async function initAndStartOTel(
  serviceName: string,
  config?: Partial<OTelConfig>
): Promise<NodeSDK> {
  const sdk = initializeOTelSDK(serviceName, config);
  await startOTelSDK(sdk);
  return sdk;
}

/**
 * Get environment variables for OTel configuration
 * Use this to verify OTel environment is set up correctly
 */
export function getOTelEnvironment(): Record<string, string | undefined> {
  return {
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    OTEL_CONSOLE_EXPORTER: process.env.OTEL_CONSOLE_EXPORTER,
    OTEL_LOG_LEVEL: process.env.OTEL_LOG_LEVEL,
    NODE_ENV: process.env.NODE_ENV,
    HOSTNAME: process.env.HOSTNAME,
  };
}

/**
 * Verify OTLP endpoint is reachable
 * Useful for health checks and startup validation
 */
export async function verifyOTLPEndpoint(
  endpoint: string = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317'
): Promise<boolean> {
  try {
    const url = new URL(`${endpoint}/v1/traces`);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/protobuf' },
      body: Buffer.alloc(0),
      timeout: 5000,
    });
    // Accept 2xx, 4xx, 5xx - we just want to verify connectivity
    return response.status < 600;
  } catch (error) {
    console.error('[OTEL] OTLP endpoint unreachable:', endpoint, error);
    return false;
  }
}

export default {
  initializeOTelSDK,
  startOTelSDK,
  initAndStartOTel,
  getOTelEnvironment,
  verifyOTLPEndpoint,
};
