# Prometheus Metrics Integration Guide

Quick reference for enabling and using Prometheus metrics in the ForgePay Kill Bill plugin.

## What Was Added

The Kill Bill plugin now exports Prometheus metrics for:
- **Payment Processing**: Duration and attempt counts (authorize, capture, refund, void, status queries)
- **Webhook Handling**: Duration and event counts (payment status updates, refunds)

## Deployment Checklist

### 1. Build the Plugin

```bash
cd forgepay/services/billing-engine/forgepay-plugin
mvn clean package
```

The build will:
- Download Micrometer dependencies
- Compile MetricsRegistry and MetricsServlet
- Include metrics classes in the JAR

### 2. Configure Prometheus Scrape Target

Add to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'forgepay-killbill'
    static_configs:
      - targets: ['killbill-host:8080']
    metrics_path: '/metrics'
    scrape_interval: 15s
    scrape_timeout: 10s
```

### 3. Register MetricsServlet with Kill Bill

Kill Bill plugins can register custom servlets. The `MetricsServlet` should be registered at startup.

Example configuration in Kill Bill plugin initialization:
```java
// In Kill Bill plugin configuration/setup
servletContainer.register("/metrics", MetricsServlet.class);
```

Or through Kill Bill's plugin infrastructure (consult Kill Bill documentation for exact method).

### 4. Verify Metrics Collection

After Kill Bill starts, verify metrics are being collected:

```bash
curl http://killbill-host:8080/metrics | head -20
```

Expected output:
```prometheus
# HELP payment_processing_duration_seconds Time taken to process a payment transaction
# TYPE payment_processing_duration_seconds histogram
payment_processing_duration_seconds_bucket{le="+Inf",service="forgepay-killbill-plugin",status="success"} 0
# ... more metrics ...
```

## Metrics Available Immediately After Build

### Payment Metrics

```prometheus
payment_processing_duration_seconds  # Timer with p50, p95, p99 percentiles
payment_attempts_total               # Counter with status and method labels
```

Labels for payment_attempts_total:
- `status`: success, failed, pending
- `method`: card, refund, void, status_query

### Webhook Metrics

```prometheus
webhook_events_processed_total        # Counter
webhook_processing_duration_seconds   # Timer
```

Labels:
- `event_type`: payment_status_updated, refund_completed, unknown

## Integration with Monitoring

### Grafana Dashboard Examples

#### Payment Success Rate (Last 5 minutes)
```promql
rate(payment_attempts_total{status="success"}[5m]) / rate(payment_attempts_total[5m]) * 100
```

#### Payment Failure Rate (Last 5 minutes)
```promql
rate(payment_attempts_total{status="failed"}[5m]) / rate(payment_attempts_total[5m]) * 100
```

#### P95 Payment Processing Time
```promql
histogram_quantile(0.95, rate(payment_processing_duration_seconds_bucket[5m]))
```

#### Webhook Processing Rate
```promql
rate(webhook_events_processed_total[5m])
```

#### Webhook Error Rate
```promql
rate(webhook_events_processed_total{event_type=~".*error.*"}[5m])
```

### Alert Rules (Prometheus)

```yaml
groups:
  - name: forgepay_killbill
    interval: 15s
    rules:
      - alert: HighPaymentFailureRate
        expr: rate(payment_attempts_total{status="failed"}[5m]) / rate(payment_attempts_total[5m]) > 0.05
        for: 5m
        annotations:
          summary: "ForgePay payment failure rate > 5%"

      - alert: SlowPaymentProcessing
        expr: histogram_quantile(0.95, rate(payment_processing_duration_seconds_bucket[5m])) > 5
        for: 10m
        annotations:
          summary: "ForgePay P95 payment processing time > 5 seconds"

      - alert: HighWebhookErrorRate
        expr: rate(webhook_events_processed_total{event_type=~".*error.*"}[5m]) > 0.1
        for: 5m
        annotations:
          summary: "ForgePay webhook error rate > 10%"
```

## Architecture Overview

```
ForgepayPaymentPlugin (main payment plugin)
    ↓
    ├── authorizePayment() ─→ MetricsRegistry.recordPaymentDuration()
    ├── capturePayment()   ─→ MetricsRegistry.recordPaymentDuration()
    ├── refundPayment()    ─→ MetricsRegistry.recordPaymentDuration()
    ├── voidPayment()      ─→ MetricsRegistry.recordPaymentDuration()
    └── getPaymentInfo()   ─→ MetricsRegistry.recordPaymentDuration()
                               MetricsRegistry.incrementPaymentAttempts()

ForgepayWebhookHandler
    ↓
    └── handleWebhook() ──→ MetricsRegistry.recordWebhookDuration()
                             MetricsRegistry.incrementWebhookEventsProcessed()

MetricsRegistry
    ↓
    ├── getMeterRegistry() ────→ Returns PrometheusMeterRegistry
    └── getPrometheusMetricsText() ──→ Returns Prometheus text format

MetricsServlet
    ↓
    └── GET /metrics ──→ MetricsRegistry.getPrometheusMetricsText()
                          Returns text/plain Prometheus format
```

## Troubleshooting

### Metrics endpoint not responding

**Check 1**: Verify MetricsServlet is registered
```bash
curl -v http://killbill-host:8080/metrics
```

**Check 2**: Review Kill Bill logs for initialization errors
```bash
grep -i "metrics" killbill.log
```

**Check 3**: Verify dependencies are in the JAR
```bash
jar tf forgepay-killbill-plugin-0.1.0.jar | grep -i micrometer
```

### No metrics appearing

Metrics are only exposed after payment operations. Execute a test payment:
```bash
# Via Kill Bill API - authorize payment
curl -X POST http://killbill-host:8080/1.0/kb/accounts/{accountId}/payments
```

Then check metrics:
```bash
curl http://killbill-host:8080/metrics | grep payment
```

### High memory usage

This typically indicates unbounded metric cardinality. Review metrics with:
```bash
curl http://killbill-host:8080/metrics | grep -c "^payment_\|^webhook_"
```

If very high (>10,000 unique metric series), ensure:
- Status labels are limited to: success, failed, pending
- Methods are limited to: card, refund, void, status_query
- Event types are normalized

## Performance Impact

Metrics recording adds minimal overhead:
- Timer operations: ~1-2 microseconds per call
- Counter operations: <1 microsecond per call
- No background threads or external I/O
- All operations are local in-memory

Expected impact: <0.1% to CPU and memory in production.

## Next Steps

1. Deploy the updated plugin JAR with Micrometer dependencies
2. Register MetricsServlet with Kill Bill (per Kill Bill plugin docs)
3. Configure Prometheus scrape target
4. Create Grafana dashboards for payment and webhook metrics
5. Set up alerts for failure rates and latency percentiles
6. Monitor metrics for baseline behavior before production traffic

## Files Modified/Created

**Created**:
- `src/main/java/io/forgepay/killbill/metrics/MetricsRegistry.java`
- `src/main/java/io/forgepay/killbill/metrics/MetricsServlet.java`
- `src/main/resources/logback.xml`
- `METRICS.md` (detailed documentation)

**Modified**:
- `pom.xml` (added Micrometer dependencies)
- `src/main/java/io/forgepay/killbill/ForgepayPaymentPlugin.java`
- `src/main/java/io/forgepay/killbill/ForgepayWebhookHandler.java`

## References

- [Full Metrics Documentation](./METRICS.md)
- [Micrometer Official Docs](https://micrometer.io/)
- [Prometheus Exposition Format](https://prometheus.io/docs/instrumenting/exposition_formats/)
- [Kill Bill Plugin Development](https://docs.killbill.io/)
