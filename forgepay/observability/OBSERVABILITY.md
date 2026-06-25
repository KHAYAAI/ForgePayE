# ForgePay Observability Guide

This guide covers the complete observability stack for ForgePay: Prometheus metrics, OpenTelemetry tracing, structured logging, and unified correlation across all services.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Metrics (Prometheus)](#metrics-prometheus)
3. [Tracing (OpenTelemetry)](#tracing-opentelemetry)
4. [Structured Logging](#structured-logging)
5. [Deployment](#deployment)
6. [Quick Start](#quick-start)
7. [Troubleshooting](#troubleshooting)
8. [Example Traces](#example-traces)

---

## Architecture Overview

The ForgePay observability stack is built on three pillars:

### 1. Metrics (Prometheus)
- **Collection**: Services expose metrics on `/metrics` endpoint
- **Scraping**: Prometheus scrapes all services every 30 seconds
- **Storage**: Time-series database with 30-day retention
- **Query**: PromQL for aggregation and alerting

### 2. Tracing (OpenTelemetry)
- **Instrumentation**: Automatic and manual span creation
- **Exporters**: OTLP HTTP/gRPC to OpenTelemetry Collector
- **Storage**: Jaeger all-in-one (in-memory or persistent)
- **Visualization**: Jaeger UI at `localhost:16686`
- **Correlation**: Trace IDs propagate through all services

### 3. Logging (Structured)
- **Format**: JSON structured logs with correlation IDs
- **Aggregation**: OTEL collector ingests logs via OTLP
- **Library**: Pino (TypeScript), structlog (Python), Logback (Java)
- **Correlation**: `trace_id` and `span_id` in all logs

### Service Communication Map

```
┌─────────────────────────────────────────────────────────────┐
│ ForgePay Services (Rust, TypeScript, Python, Java)          │
│  - unified-router, mor-layer, billing-engine, etc.          │
│  - Instrument with OTEL SDK (auto + manual spans)           │
│  - Emit metrics on :port/metrics                            │
│  - Send structured logs via Pino/structlog/Logback          │
└───────────────────────┬───────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        v               v               v
  ┌──────────┐   ┌────────────────┐  ┌─────────────┐
  │Prometheus│   │OTEL Collector  │  │Pino/structlog
  │:9090     │   │:4317/:4318     │  │(OTLP export)
  └──────────┘   └────────────────┘  └─────────────┘
        │               │                   │
        └───────────────┼───────────────────┘
                        │
        ┌───────────────┴──────────────────┐
        │                                  │
        v                                  v
  ┌──────────────┐              ┌──────────────────┐
  │Grafana       │              │Jaeger (Traces)   │
  │:3000         │              │:16686            │
  │Dashboard     │              │Trace storage/UI  │
  └──────────────┘              └──────────────────┘
```

---

## Metrics (Prometheus)

### Standard HTTP Metrics (Auto-instrumented)

All TypeScript services using Fastify automatically expose these metrics:

#### Counter: `http_requests_total`
Cumulative HTTP requests across all endpoints.

```
http_requests_total{
  service="unified-router",
  method="POST",
  path="/webhooks/process",
  status="200"
} 12345
```

#### Histogram: `http_request_duration_seconds`
HTTP request latency with buckets (0.01s, 0.025s, 0.05s, 0.1s, 0.25s, 0.5s, 1s, 2.5s, 5s, 10s).

```
http_request_duration_seconds_bucket{
  le="0.1",
  service="unified-router",
  method="POST",
  path="/webhooks/process"
} 2345

http_request_duration_seconds_sum{
  service="unified-router",
  method="POST",
  path="/webhooks/process"
} 567.89

http_request_duration_seconds_count{
  service="unified-router",
  method="POST",
  path="/webhooks/process"
} 234
```

#### Gauge: `http_requests_in_flight`
Current active HTTP requests.

### Service-Specific Business Metrics

#### `unified-router` (Webhook Normalizer)

```promql
# Webhook processing rate (per second)
rate(webhook_processing_duration_seconds_count[1m])

# Webhook success/failure rate
rate(webhook_events_processed_total{status="success"}[1m])
rate(webhook_events_processed_total{status="error"}[1m])

# Webhook source distribution
webhook_events_processed_total{source=~"stripe|paypal|square"}
```

#### `mor-layer` (Checkout & Tax)

```promql
# Checkout completion rate
rate(checkout_completed_total{status="success"}[1m])

# Tax calculation requests
rate(tax_calculations_total[1m])

# Currency exchange rates updated
rate(exchange_rates_updated_total[1m])
```

#### `billing-engine` (Subscriptions)

```promql
# Subscription state changes
billing_subscriptions_state_changes_total{from_state="active", to_state="canceled"}

# Revenue per subscription tier
billing_subscription_mrr_total{tier="basic|professional|enterprise"}

# Invoice generation rate
rate(invoices_generated_total[1m])
```

#### `unified-router` (Payment Processing)

```promql
# Payment processing rate
rate(payment_processing_duration_seconds_count[1m])

# Payment method distribution
payments_total{method="card|ach|wire|crypto"}

# Payment success/failure by PSP
rate(payments_total{status="success", psp=~"stripe|adyen"}[1m])
```

#### `yield-engine` (Yield Optimization)

```promql
# Yield distribution
rate(yield_distributed_total{strategy="aave|compound|curve"}[1m])

# Yield rate by strategy
yield_engine_apy_current{strategy="aave|compound"}
```

#### `agent-credit-lines` (Credit)

```promql
# Credit utilization
agent_credit_utilization_ratio{agent_id="..."}

# Credit line changes
agent_credit_line_changes_total{status="approved|rejected"}
```

### Scrape Targets

Prometheus scrapes all services according to `prometheus.yml`:

| Service | Port | Interval | Timeout |
|---------|------|----------|---------|
| unified-router | 8000 | 30s | 10s |
| mor-layer | 8010 | 30s | 10s |
| billing-engine | 8020 | 30s | 10s |
| stablecoin-gateway | 8021 | 30s | 10s |
| crypto-gateway | 8030 | 30s | 10s |
| bank-connectivity | 8040 | 30s | 10s |
| enterprise-treasury | 8050 | 30s | 10s |
| agent-credit-lines | 8060 | 30s | 10s |
| agent-identity | 8070 | 30s | 10s |
| yield-engine | 8080 | 30s | 10s |
| chain-sync | 8085 | 30s | 10s |
| compliance-monitor | 8090 | 30s | 10s |
| liquidity-forecaster | 8095 | 30s | 10s |
| rwa-registry | 8100 | 30s | 10s |

### Common PromQL Queries

```promql
# Total RPS across all services
sum(rate(http_requests_total[1m]))

# RPS by service
sum(rate(http_requests_total[1m])) by (service)

# 95th percentile latency by service
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) by (service)

# Error rate (5xx status codes)
sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
  / sum(rate(http_requests_total[5m])) by (service)

# Database connection pool usage
db_connections_in_use / db_connections_total by (service)

# Redis cache hit rate
rate(redis_hits_total[5m]) / (rate(redis_hits_total[5m]) + rate(redis_misses_total[5m]))
```

---

## Tracing (OpenTelemetry)

### Architecture

```
Service A                    Service B                   Service C
│                            │                            │
├─ Create span A1            │                            │
│  (traceid: xyz)            │                            │
│  │                         │                            │
│  ├─ Create span A1.1       │                            │
│  │ (instrumentedDB call)   │                            │
│  │                         │                            │
│  ├─ Create span A1.2       │                            │
│  │ (HTTP call to B)        │                            │
│  │ └─ Propagate traceid in headers (W3C TraceContext) │
│  │                         │                            │
│  │                         ├─ Receive traceid: xyz      │
│  │                         ├─ Create span B1 (parent=A1.2)
│  │                         │                            │
│  │                         ├─ Create span B1.1         │
│  │                         │ (PG query)                │
│  │                         │                            │
│  │                         ├─ Create span B1.2         │
│  │                         │ (HTTP call to C)          │
│  │                         │ └─ Propagate traceid      │
│  │                         │                            │
│  │                         │                            ├─ Receive traceid: xyz
│  │                         │                            ├─ Create span C1
│  │                         │                            │                          
│  │                         │                            ├─ Cache lookup
│  │                         │                            │ (span C1.1, CACHE HIT)
│  │                         │                            │
│  ├─ Export all spans (traceid: xyz) to Jaeger          │
│  │ A1, A1.1, A1.2                                      │
│  └─                        ├─ Export spans             │
│                            │ B1, B1.1, B1.2            │
│                            └─                          ├─ Export spans
│                                                         │ C1, C1.1
│                                                         └─
                         ┌─────────────────────┐
                         │ Jaeger             │
                         │ Unified Trace View │
                         │ (traceid: xyz)     │
                         └─────────────────────┘
```

### Initialization (TypeScript Services)

Every TypeScript service should initialize OTel at startup:

```typescript
// src/index.ts
import { initAndStartOTel } from '../observability/otel-config';

async function main() {
  // Initialize observability FIRST
  await initAndStartOTel('unified-router', {
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
  });

  // Start your application after OTel is initialized
  const app = fastify({ logger: true });
  // ... register routes, plugins, etc.
  
  await app.listen({ port: 8000 });
}

main();
```

### Initialization (Python Services)

```python
# main.py or app.py
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.instrumentation.flask import FlaskInstrumentation
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentation
from opentelemetry.instrumentation.requests import RequestsInstrumentation

# Set up OTEL exporter
otlp_exporter = OTLPSpanExporter(
    otlp_endpoint=os.getenv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4317')
)
trace.set_tracer_provider(TracerProvider())
trace.get_tracer_provider().add_span_processor(BatchSpanProcessor(otlp_exporter))

# Auto-instrumentation
FlaskInstrumentation().instrument()
SQLAlchemyInstrumentation().instrument()
RequestsInstrumentation().instrument()

tracer = trace.get_tracer(__name__)

# Now start Flask app
app = Flask(__name__)
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8010)
```

### Manual Span Creation

#### TypeScript (Fastify)

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('unified-router');

// In your webhook handler
async function processWebhook(request, reply) {
  const span = tracer.startSpan('webhook_processing');
  
  try {
    // Set attributes
    span.setAttributes({
      'webhook.id': webhook.id,
      'webhook.source': webhook.source,
      'webhook.event_type': webhook.eventType,
    });

    // Add events
    span.addEvent('webhook_validation_started');
    
    const validated = await validateWebhook(webhook);
    span.addEvent('webhook_validation_completed', { 'validation.passed': validated });

    if (!validated) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      return reply.code(400).send({ error: 'Validation failed' });
    }

    // Nested span for business logic
    await tracer.startActiveSpan('webhook_transform', async (transformSpan) => {
      transformSpan.setAttributes({ 'transform.format': 'stripe_to_internal' });
      const internal = await transformWebhook(webhook);
      return internal;
    });

    span.setStatus({ code: SpanStatusCode.OK });
    return reply.code(200).send({ success: true });
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    throw error;
  } finally {
    span.end();
  }
}
```

#### Python (FastAPI)

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer(__name__)

@app.post("/checkout")
async def create_checkout(request: CheckoutRequest):
    with tracer.start_as_current_span("checkout_creation") as span:
        span.set_attributes({
            "checkout.amount": request.amount,
            "checkout.currency": request.currency,
            "checkout.merchant_id": request.merchant_id,
        })
        
        span.add_event("cart_validation_started")
        try:
            # Validate cart
            await validate_cart(request)
            span.add_event("cart_validation_passed")
            
            # Tax calculation (nested span)
            with tracer.start_as_current_span("tax_calculation") as tax_span:
                tax_span.set_attribute("tax.jurisdiction", request.jurisdiction)
                taxes = await calculate_taxes(request)
            
            # Create checkout record
            checkout = await db.checkouts.create({...})
            
            span.set_status(Status(StatusCode.OK))
            return checkout
        except Exception as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            raise
```

### Critical Paths to Trace

Every ForgePay service should instrument these critical paths:

#### 1. Webhook Processing Pipeline (unified-router)

```typescript
// Main webhook span includes:
- webhook_validation (sync signature, replay detection)
- webhook_transformation (normalize to internal format)
- webhook_enrichment (fetch merchant, customer details)
- webhook_routing (determine target service)
- webhook_delivery (async to downstream)
```

#### 2. Payment Processing Pipeline (payment services)

```typescript
// Payment span includes:
- payment_authorization (call PSP auth endpoint)
- payment_3ds_check (3D Secure if required)
- payment_vaulting (tokenize card if requested)
- payment_logging (fraud/compliance logging)
- payment_settlement (batch settlement job)
```

#### 3. Database Query Instrumentation

Auto-instrumented by PgInstrumentation, but add context:

```typescript
const span = tracer.startSpan('db_transaction_batch_insert');
span.setAttributes({
  'db.operation': 'INSERT',
  'db.table': 'transactions',
  'db.row_count': 500,
  'db.batch_size': 100,
});
// ... execute batch insert
```

#### 4. External API Calls

```typescript
// Stripe payment
const span = tracer.startSpan('external_api_call');
span.setAttributes({
  'http.url': 'https://api.stripe.com/v1/charges',
  'http.method': 'POST',
  'service.name': 'stripe',
});

const response = await stripe.charges.create({...});

span.setAttributes({
  'http.status_code': 200,
  'http.response_time_ms': response.timing,
});
```

### Trace Propagation

OpenTelemetry uses **W3C TraceContext** to propagate trace IDs across services.

```
Request from Service A to Service B:

POST /payments HTTP/1.1
Host: payment-service.local
Content-Type: application/json
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
    # Format: 00-<trace_id>-<span_id>-<trace_flags>

Body: {...}
```

Auto-instrumented HTTP libraries (Fastify, http, requests) automatically:
1. Extract `traceparent` from incoming requests
2. Continue the trace
3. Add `traceparent` to outgoing requests

---

## Structured Logging

### TypeScript (Pino)

```typescript
import pino from 'pino';
import { trace } from '@opentelemetry/api';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino/file',
    options: {
      colorize: process.env.NODE_ENV !== 'production',
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

// Middleware to inject trace context
function createPinoMiddleware() {
  return (req, res, next) => {
    const span = trace.getActiveSpan();
    const traceContext = span?.spanContext();
    
    req.log = logger.child({
      trace_id: traceContext?.traceId,
      span_id: traceContext?.spanId,
      request_id: req.id,
    });
    
    next();
  };
}

// Usage in handlers
async function handlePayment(req, res) {
  req.log.info({ payment_id: req.body.id }, 'Processing payment');
  
  try {
    const result = await processPayment(req.body);
    req.log.info({ payment_id: req.body.id, status: result.status }, 'Payment succeeded');
  } catch (error) {
    req.log.error({ payment_id: req.body.id, error: error.message }, 'Payment failed');
    throw error;
  }
}
```

Output (JSON):
```json
{
  "level": 30,
  "time": "2025-06-24T10:15:33.123Z",
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "span_id": "b7ad6b7169203331",
  "request_id": "req-123",
  "payment_id": "pay-456",
  "msg": "Processing payment"
}
```

### Python (structlog)

```python
import structlog
import logging
from opentelemetry import trace

structlog.configure(
    processors=[
        structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logging.basicConfig(
    format='%(message)s',
    level=logging.INFO,
    handlers=[
        logging.StreamHandler(),
    ],
)

logger = structlog.get_logger()

# Add trace context to each log
def inject_trace_context(logger, name, event_dict):
    span = trace.get_current_span()
    if span:
        event_dict['trace_id'] = span.get_span_context().trace_id
        event_dict['span_id'] = span.get_span_context().span_id
    return event_dict

structlog.configure(
    processors=[
        inject_trace_context,
        structlog.processors.JSONRenderer(),
    ]
)

# Usage
logger.info('checkout_created', amount=99.99, currency='USD')
```

### Correlation via Request ID

All services should propagate request IDs:

```typescript
// In Fastify request context
app.addHook('onRequest', async (request, reply) => {
  const requestId = request.headers['x-request-id'] || generateId();
  request.id = requestId;
  
  // Inject into all logs for this request
  request.log = logger.child({ request_id: requestId });
  
  // Set as span attribute
  const span = trace.getActiveSpan();
  span?.setAttributes({ 'request.id': requestId });
  
  reply.header('x-request-id', requestId);
});
```

---

## Deployment

### Docker Compose (Local Development)

```bash
cd forgepay/observability
docker compose -f docker-compose.otel.yml up -d

# Verify services are running
curl http://localhost:9090/-/healthy    # Prometheus
curl http://localhost:16686/api/health  # Jaeger
curl http://localhost:3000/api/health   # Grafana
```

### Kubernetes (Production)

#### ServiceMonitor (Prometheus Operator)

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: forgepay-services
  namespace: forgepay
spec:
  selector:
    matchLabels:
      app: forgepay
  endpoints:
    - port: metrics
      interval: 30s
      path: /metrics
```

#### Jaeger Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jaeger
  namespace: observability
spec:
  replicas: 1
  selector:
    matchLabels:
      app: jaeger
  template:
    metadata:
      labels:
        app: jaeger
    spec:
      containers:
        - name: jaeger
          image: jaegertracing/all-in-one:latest
          ports:
            - name: otlp-grpc
              containerPort: 4317
            - name: otlp-http
              containerPort: 4318
            - name: ui
              containerPort: 16686
          env:
            - name: COLLECTOR_OTLP_ENABLED
              value: "true"
```

#### Service Configuration

Set OTEL_EXPORTER_OTLP_ENDPOINT in service manifests:

```yaml
env:
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: "http://otel-collector.observability:4317"
  - name: OTEL_SERVICE_NAME
    value: "unified-router"
```

### Grafana Dashboard Provisioning

Dashboards in `/grafana-provisioning/dashboards/` are auto-loaded on startup. To add a custom dashboard:

1. Create dashboard in Grafana UI
2. Export JSON from dashboard settings
3. Save to `/grafana-provisioning/dashboards/my-dashboard.json`
4. Restart Grafana (dashboard will auto-load)

### Prometheus Data Retention

Default: 30 days. Adjust in `prometheus.yml`:

```yaml
global:
  scrape_interval: 30s
  # Retention: 30d, 365d, etc.
  external_labels:
    retention: "30d"
```

Or via flag:
```bash
prometheus --storage.tsdb.retention.time=30d
```

---

## Quick Start

### 1. Start the Stack Locally

```bash
# From repo root
cd forgepay/observability
docker compose -f docker-compose.otel.yml up -d

# Verify services
docker compose -f docker-compose.otel.yml ps
```

### 2. Set Environment Variables

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4317"
export OTEL_SERVICE_NAME="unified-router"
export OTEL_CONSOLE_EXPORTER="false"  # Disable console output in prod

# Run your service
cd forgepay/services/unified-router
npm install
npm run dev
```

### 3. Access UIs

- **Grafana**: http://localhost:3000 (admin/admin)
  - Dashboards → ForgePay → Platform Overview
  
- **Prometheus**: http://localhost:9090
  - Graph → Enter query (e.g., `rate(http_requests_total[1m])`)
  - Status → Targets (view scrape health)

- **Jaeger**: http://localhost:16686
  - Service dropdown → Select service
  - Find traces by duration, tags, status

### 4. Generate Test Data

```bash
# Hit your service to generate traces
curl -X POST http://localhost:8000/webhooks/process \
  -H "Content-Type: application/json" \
  -d '{"source": "stripe", "event": "charge.succeeded"}'

# View in Jaeger UI (may take ~5 seconds to appear)
# View metrics in Prometheus: http://localhost:9090
```

### 5. Create Custom Dashboards

In Grafana:
1. Click + → Dashboard
2. Add panels with PromQL queries
3. Save dashboard (auto-loaded on next restart if in provisioning dir)

---

## Troubleshooting

### OTLP Connection Refused

**Symptom**: `[OTEL] OTLP endpoint unreachable: http://localhost:4317`

**Solution**:
```bash
# Check OTel Collector is running
docker ps | grep otel-collector

# Verify endpoint
curl -X POST http://localhost:4317/v1/traces \
  -H "Content-Type: application/protobuf" \
  -d ""  # Should return 200 or 400, not connection refused

# Set explicit endpoint
export OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4317"
```

### Traces Not Appearing in Jaeger

**Symptom**: Jaeger UI shows "No Traces" for selected service

**Checks**:
1. Service is running and exporting: `curl http://localhost:8000/metrics`
2. Trace SDK started: Look for `[OTEL] SDK started` in logs
3. Collector received spans: `docker logs otel-collector | grep "received"`
4. Jaeger storage: `docker logs jaeger | grep "collector accepted"`

**Fix**:
```bash
# Force export (set to 100% sampling in prod, only for debugging)
export OTEL_COLLECTOR_SAMPLING_RATE="1.0"

# Increase log level
export OTEL_LOG_LEVEL="debug"

# Check collector config
docker exec otel-collector cat /etc/otel-collector-config.yml
```

### High Memory Usage (OTel Collector)

**Cause**: Batch processor queue filling up

**Solution**:
```yaml
# In otel-collector-config.yml
processors:
  batch:
    send_batch_size: 512     # Reduce from 1024
    timeout: 5s              # Increase frequency
```

### Metrics Not Scraping

**Symptom**: Prometheus shows "DOWN" for service target

**Checks**:
1. Service is listening: `curl http://localhost:8000/metrics`
2. Port correct in prometheus.yml
3. Service has metrics enabled: Check logs for `[OTEL]` messages

**Fix**:
```bash
# Manually test scrape
curl http://unified-router:8000/metrics | head -20

# Check Prometheus scrape config
curl http://localhost:9090/api/v1/targets
```

### Trace ID Not Propagating

**Symptom**: Traces show as separate traces (not connected across services)

**Cause**: W3C TraceContext not propagated in HTTP headers

**Fix**:
```typescript
// Ensure auto-instrumentation is enabled BEFORE app starts
import { initAndStartOTel } from './observability/otel-config';
await initAndStartOTel('service-name');  // FIRST

import fastify from 'fastify';
const app = fastify();
```

### Logs Not Appearing

**Cause**: Pino configured to write to file, not stdout

**Fix**:
```typescript
const logger = pino({
  transport: {
    target: 'pino-pretty',  // For development
    options: {
      colorize: true,
    },
  },
});
```

---

## Example Traces

### Complete Webhook Processing Trace

```json
{
  "traceID": "0af7651916cd43dd8448eb211c80319c",
  "spans": [
    {
      "traceID": "0af7651916cd43dd8448eb211c80319c",
      "spanID": "b7ad6b7169203331",
      "operationName": "POST /webhooks/process",
      "references": [],
      "startTime": 1624520133000,
      "duration": 245000,
      "logs": [
        {
          "timestamp": 1624520133001,
          "fields": [
            { "key": "event", "value": "webhook_received" },
            { "key": "source", "value": "stripe" }
          ]
        }
      ],
      "tags": [
        { "key": "span.kind", "value": "server" },
        { "key": "http.method", "value": "POST" },
        { "key": "http.url", "value": "http://localhost:8000/webhooks/process" },
        { "key": "webhook.source", "value": "stripe" },
        { "key": "webhook.event_type", "value": "charge.succeeded" }
      ]
    },
    {
      "traceID": "0af7651916cd43dd8448eb211c80319c",
      "spanID": "c8bd8c8169203332",
      "parentSpanID": "b7ad6b7169203331",
      "operationName": "webhook_validation",
      "startTime": 1624520133010,
      "duration": 15000,
      "tags": [
        { "key": "validation.passed", "value": true },
        { "key": "signature.algorithm", "value": "hmac-sha256" }
      ]
    },
    {
      "traceID": "0af7651916cd43dd8448eb211c80319c",
      "spanID": "d9ce9d9169203333",
      "parentSpanID": "b7ad6b7169203331",
      "operationName": "webhook_transformation",
      "startTime": 1624520133026,
      "duration": 50000,
      "tags": [
        { "key": "transform.source_format", "value": "stripe" },
        { "key": "transform.target_format", "value": "internal" }
      ]
    },
    {
      "traceID": "0af7651916cd43dd8448eb211c80319c",
      "spanID": "e0df0e0169203334",
      "parentSpanID": "b7ad6b7169203331",
      "operationName": "POST /payments",
      "references": [
        {
          "refType": "child_of",
          "traceID": "0af7651916cd43dd8448eb211c80319c",
          "spanID": "b7ad6b7169203331"
        }
      ],
      "startTime": 1624520133080,
      "duration": 150000,
      "tags": [
        { "key": "span.kind", "value": "client" },
        { "key": "http.method", "value": "POST" },
        { "key": "http.url", "value": "http://payment-service:8020/payments" },
        { "key": "http.status_code", "value": 200 }
      ]
    }
  ],
  "processes": {
    "p1": {
      "serviceName": "unified-router",
      "tags": [
        { "key": "service.version", "value": "1.0.0" },
        { "key": "deployment.environment", "value": "local" }
      ]
    },
    "p2": {
      "serviceName": "payment-service",
      "tags": [
        { "key": "service.version", "value": "2.1.0" }
      ]
    }
  }
}
```

### Database Query Trace

```json
{
  "traceID": "1bf7651916cd43dd8448eb211c80319d",
  "spans": [
    {
      "operationName": "db.postgresql.query",
      "spanID": "a1bd6b7169203335",
      "startTime": 1624520200000,
      "duration": 125000,
      "tags": [
        { "key": "db.system", "value": "postgresql" },
        { "key": "db.name", "value": "forgepay" },
        { "key": "db.user", "value": "router_service" },
        { "key": "db.operation", "value": "SELECT" },
        { "key": "db.statement", "value": "SELECT * FROM transactions WHERE id = $1" },
        { "key": "db.connection.string", "value": "postgres://router_service@db.local:5432/forgepay" }
      ]
    }
  ]
}
```

---

## Next Steps

1. **Enable Tracing in All Services**: Update each service to call `initAndStartOTel()` on startup
2. **Add Business Metrics**: Define service-specific metrics in each microservice
3. **Create Custom Dashboards**: Build dashboards for key business KPIs
4. **Set Up Alerting**: Define alert rules for SLOs (error rate, latency p95, etc.)
5. **Retention Policy**: Configure Prometheus/Jaeger retention based on storage
6. **Integrate with Logging**: Ensure all logs include trace IDs for correlation

For production deployment, see [Deployment](#deployment) section.
