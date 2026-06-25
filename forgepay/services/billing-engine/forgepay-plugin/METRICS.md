# Prometheus Metrics Integration

This document describes the Prometheus metrics exposed by the ForgePay Kill Bill plugin.

## Overview

The plugin integrates with Prometheus via Micrometer to expose metrics for payment processing and webhook handling. Metrics can be scraped via the `/metrics` endpoint.

## Metrics Endpoint

**URL**: `http://<plugin-host>/metrics`  
**Format**: Prometheus text format (text/plain)  
**HTTP Methods**: GET, HEAD

### Example

```bash
curl http://localhost:8080/metrics
```

## Available Metrics

### Payment Processing Metrics

#### `payment_processing_duration_seconds` (Timer)
Tracks the time taken to process a payment transaction (authorize, capture, refund, void, or status query).

**Labels**:
- `status`: Payment result status (`success`, `failed`, `pending`, `unknown`)
- `service`: Always `forgepay-killbill-plugin`

**Percentiles**: 50th, 95th, 99th

**Example Output**:
```prometheus
payment_processing_duration_seconds_bucket{service="forgepay-killbill-plugin",status="success",le="0.1"} 45
payment_processing_duration_seconds_bucket{service="forgepay-killbill-plugin",status="success",le="1.0"} 98
payment_processing_duration_seconds_sum{service="forgepay-killbill-plugin",status="success"} 123.45
payment_processing_duration_seconds_count{service="forgepay-killbill-plugin",status="success"} 100
payment_processing_duration_seconds{quantile="0.5",service="forgepay-killbill-plugin",status="success"} 1.1
payment_processing_duration_seconds{quantile="0.95",service="forgepay-killbill-plugin",status="success"} 1.8
payment_processing_duration_seconds{quantile="0.99",service="forgepay-killbill-plugin",status="success"} 2.1
```

#### `payment_attempts_total` (Counter)
Total number of payment attempts (across all operations: authorize, capture, refund, void, status query).

**Labels**:
- `status`: Payment result status (`success`, `failed`, `pending`, `unknown`)
- `method`: Payment operation type (`card`, `refund`, `void`, `status_query`)
- `service`: Always `forgepay-killbill-plugin`

**Example Output**:
```prometheus
payment_attempts_total{method="card",service="forgepay-killbill-plugin",status="success"} 1234
payment_attempts_total{method="card",service="forgepay-killbill-plugin",status="failed"} 12
payment_attempts_total{method="refund",service="forgepay-killbill-plugin",status="success"} 56
```

### Webhook Metrics

#### `webhook_events_processed_total` (Counter)
Total number of webhook events processed from the unified-router service.

**Labels**:
- `event_type`: Type of webhook event (`payment_status_updated`, `refund_completed`, `unknown`, etc.)
- `service`: Always `forgepay-killbill-plugin`

**Example Output**:
```prometheus
webhook_events_processed_total{event_type="payment_status_updated",service="forgepay-killbill-plugin"} 5432
webhook_events_processed_total{event_type="refund_completed",service="forgepay-killbill-plugin"} 123
webhook_events_processed_total{event_type="payment_status_updated.error",service="forgepay-killbill-plugin"} 3
```

#### `webhook_processing_duration_seconds` (Timer)
Time taken to process a webhook event from receipt to completion.

**Labels**:
- `event_type`: Type of webhook event
- `service`: Always `forgepay-killbill-plugin`

**Percentiles**: 50th, 95th, 99th

**Example Output**:
```prometheus
webhook_processing_duration_seconds_bucket{event_type="payment_status_updated",service="forgepay-killbill-plugin",le="0.01"} 5200
webhook_processing_duration_seconds_bucket{event_type="payment_status_updated",service="forgepay-killbill-plugin",le="0.1"} 5400
webhook_processing_duration_seconds_sum{event_type="payment_status_updated",service="forgepay-killbill-plugin"} 234.56
webhook_processing_duration_seconds_count{event_type="payment_status_updated",service="forgepay-killbill-plugin"} 5432
webhook_processing_duration_seconds{quantile="0.5",event_type="payment_status_updated",service="forgepay-killbill-plugin"} 0.04
webhook_processing_duration_seconds{quantile="0.95",event_type="payment_status_updated",service="forgepay-killbill-plugin"} 0.05
webhook_processing_duration_seconds{quantile="0.99",event_type="payment_status_updated",service="forgepay-killbill-plugin"} 0.06
```

## Architecture

### Components

1. **MetricsRegistry** (`io.forgepay.killbill.metrics.MetricsRegistry`)
   - Centralized registry for Prometheus metrics
   - Manages MeterRegistry and custom metric instances
   - Provides thread-safe access to metrics
   - Initialized in `ForgepayPaymentPlugin` constructor

2. **MetricsServlet** (`io.forgepay.killbill.metrics.MetricsServlet`)
   - HTTP servlet that exposes metrics at `/metrics` endpoint
   - Returns Prometheus text format
   - Handles GET and HEAD requests
   - Can be registered with Kill Bill's plugin servlet container

3. **Integration Points**
   - `ForgepayPaymentPlugin`: Records payment operation metrics (timer + counter)
   - `ForgepayWebhookHandler`: Records webhook processing metrics (timer + counter)

### Thread Safety

All metrics operations in `MetricsRegistry` are thread-safe:
- `MeterRegistry` is thread-safe by design
- Metrics recording includes exception handling to prevent blocking
- Failed metrics recording is logged but doesn't affect payment processing

## Configuration

### Enabling JSON Logging

The plugin includes a `logback.xml` configuration that supports JSON structured logging for production:

```xml
<!-- Enable JSON logging by uncommenting: -->
<appender-ref ref="JSON_FILE"/>
```

This requires adding the `logstash-logback-encoder` dependency to `pom.xml`:

```xml
<dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
    <version>7.4</version>
</dependency>
```

### Environment Variables

- `LOG_DIR`: Directory for log files (default: `./logs`)
- `LOG_LEVEL`: SLF4J logging level (default: `INFO`)
- `ENVIRONMENT`: Environment name for JSON logs (default: `development`)

## Usage Examples

### Prometheus Scrape Configuration

```yaml
scrape_configs:
  - job_name: 'forgepay-killbill'
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

### Grafana Dashboard Queries

```promql
# Success rate over last 5 minutes
rate(payment_attempts_total{status="success"}[5m]) / rate(payment_attempts_total[5m])

# P95 payment processing time
histogram_quantile(0.95, payment_processing_duration_seconds)

# Webhook error rate
rate(webhook_events_processed_total{event_type=~".*error.*"}[5m])

# Average webhook processing time
rate(webhook_processing_duration_seconds_sum[5m]) / rate(webhook_processing_duration_seconds_count[5m])
```

## Testing

Metrics recording is non-blocking and fails gracefully:
- If `MetricsRegistry` is not initialized, metrics are recorded when it's initialized
- If a metric recording operation fails (rare), the error is logged but payment processing continues
- Tests can use `MetricsRegistry.reset()` to clear metrics between test cases

## Dependencies

- **micrometer-core** (1.12.0): Core metrics library
- **micrometer-registry-prometheus** (1.12.0): Prometheus registry implementation
- **javax.servlet-api** (4.0.1): Servlet API for MetricsServlet

## Performance Impact

Metrics recording has minimal performance impact:
- Timer operations add ~microseconds per payment
- Counters add ~microseconds per increment
- Metrics export is on-demand via `/metrics` endpoint
- No background threads or external network calls required

## Troubleshooting

### Metrics endpoint returns 503

**Symptom**: GET /metrics returns "Service Unavailable"  
**Cause**: `MetricsRegistry.initialize()` failed during plugin startup  
**Solution**: Check logs for initialization errors and verify all dependencies are on the classpath

### Metrics are not appearing

**Symptom**: Metrics endpoint returns no data  
**Cause**: Metrics are only recorded for operations that have been executed  
**Solution**: Execute some payment operations first, then check metrics endpoint

### High memory usage

**Symptom**: Plugin memory usage increases over time  
**Cause**: Unbounded metric cardinality (too many unique label combinations)  
**Solution**: Review Prometheus label values to ensure they're bounded (e.g., status should be limited to fixed values)

## Future Enhancements

- Custom metrics for payment method types (card, ACH, crypto, etc.)
- Metrics for payment routing decisions (which payment processor was used)
- Metrics for currency conversion rates and forex loss tracking
- Customer-level metrics (merchant ID, account ID) for multi-tenancy support
- Integration with Kill Bill's native metrics if available

## References

- [Micrometer Documentation](https://micrometer.io/)
- [Prometheus Exposition Format](https://prometheus.io/docs/instrumenting/exposition_formats/)
- [Kill Bill Plugin Architecture](https://docs.killbill.io/)
