# ForgePay Observability

Quick-start guide to enable metrics, tracing, and logging across ForgePay services.

## What's Included

- **OpenTelemetry SDK** (`otel-config.ts`): Auto-instrumentation for Node.js services
- **Prometheus Config** (`prometheus.yml`): Metrics scraping for 15+ ForgePay services
- **Jaeger + Grafana Stack** (`docker-compose.otel.yml`): Local observability infrastructure
- **Grafana Dashboards** (`grafana-provisioning/`): Pre-built ForgePay Platform Overview
- **Comprehensive Guide** (`OBSERVABILITY.md`): Architecture, metrics, traces, logging

## 30-Second Quick Start

```bash
# 1. Start observability stack (local)
cd forgepay/observability
docker compose -f docker-compose.otel.yml up -d

# 2. Set environment variable in your service
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4317"

# 3. Initialize OTel in your TypeScript service (before starting app)
import { initAndStartOTel } from './observability/otel-config';
await initAndStartOTel('unified-router');  // Replace with your service name

# 4. Access dashboards
# - Grafana:    http://localhost:3000 (admin/admin)
# - Prometheus: http://localhost:9090
# - Jaeger:     http://localhost:16686
```

## Testing

Generate test traces:

```bash
# Hit your service
curl -X POST http://localhost:8000/webhooks/process \
  -H "Content-Type: application/json" \
  -d '{"source": "stripe", "event": "charge.succeeded"}'

# Check metrics
curl http://localhost:8000/metrics | grep http_requests_total

# View in Jaeger (may take ~5s to appear)
# http://localhost:16686 → Select service → Find Traces
```

## Architecture

```
┌─────────────────────────────────┐
│ ForgePay Services               │
│ (OTel SDK initialized)          │
│ ├─ unified-router               │
│ ├─ mor-layer                    │
│ ├─ billing-engine               │
│ ├─ yield-engine                 │
│ └─ ... (15+ services)           │
└────┬────────────────────────────┘
     │
  ┌──┴──────────────────────────┐
  │                             │
  v                             v
OTLP HTTP :4317/4318      Prometheus :9090
(Traces, Metrics, Logs)   (Metrics Storage)
  │                             │
  v                             v
Jaeger :16686             Grafana :3000
(Trace Storage & UI)      (Dashboards)
```

## Key Files

| File | Purpose |
|------|---------|
| `otel-config.ts` | Node.js OpenTelemetry SDK initialization |
| `prometheus.yml` | Prometheus scrape targets (all 15+ services) |
| `docker-compose.otel.yml` | OTel Collector, Jaeger, Prometheus, Grafana |
| `otel-collector-config.yml` | OTel Collector receiver/processor/exporter config |
| `grafana-provisioning/` | Datasources, dashboards, alerting rules |
| `OBSERVABILITY.md` | Deep dive: architecture, metrics, tracing, logging |

## Integration Checklist

### TypeScript Services

- [ ] Import and initialize `otel-config.ts` before starting app
- [ ] Set `OTEL_EXPORTER_OTLP_ENDPOINT` env var
- [ ] Add Pino logger with trace context injection
- [ ] Instrument critical paths with manual spans
- [ ] Expose `/metrics` endpoint (auto-instrumented)

### Python Services

- [ ] Import OpenTelemetry SDK and OTLP exporter
- [ ] Auto-instrument FastAPI, SQLAlchemy, Requests
- [ ] Configure structlog with trace context
- [ ] Set `OTEL_EXPORTER_OTLP_ENDPOINT` env var
- [ ] Expose `/metrics` endpoint

### Prometheus

- [ ] Service added to `prometheus.yml` scrape config
- [ ] Metrics endpoint available on correct port
- [ ] Health check passes in Prometheus UI (http://localhost:9090/targets)

### Grafana

- [ ] Custom dashboard created for service KPIs
- [ ] Saved to `grafana-provisioning/dashboards/` as JSON
- [ ] Refreshes on Grafana restart

## Common Queries

### Prometheus PromQL

```promql
# HTTP requests per second (all services)
sum(rate(http_requests_total[1m])) by (service)

# 95th percentile latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) by (service)

# Error rate (5xx)
rate(http_requests_total{status=~"5.."}[5m]) by (service)

# Payment processing rate
rate(payment_processing_duration_seconds_count[1m]) by (service, method)

# Database connection pool usage
db_connections_in_use / db_connections_total
```

### Jaeger Searches

1. **By Duration**: Find slow traces
   - Service: `unified-router`
   - Min Duration: `250ms`
   - Max Duration: `1000ms`

2. **By Tag**: Find traces for specific transaction
   - Service: `payment-service`
   - Tags: `payment.id=pay_123`

3. **By Status**: Find errors
   - Service: `unified-router`
   - Tags: `error=true`

## Troubleshooting

### OTLP Connection Refused

```bash
# Check collector is running
docker ps | grep otel-collector

# Verify endpoint
curl -X POST http://localhost:4317/v1/traces \
  -H "Content-Type: application/protobuf"

# Explicit endpoint
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4317"
```

### Traces Not Appearing

```bash
# Check service is exporting
curl http://localhost:8000/metrics | grep otel

# Check collector logs
docker logs otel-collector

# Check Jaeger logs
docker logs jaeger
```

### Metrics Not Scraping

```bash
# Check service endpoint
curl http://localhost:8000/metrics | head -20

# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# View Prometheus logs
docker logs prometheus
```

See [OBSERVABILITY.md](./OBSERVABILITY.md#troubleshooting) for detailed troubleshooting.

## Deployment

### Local Development

Already configured in `docker-compose.otel.yml`. Just run:

```bash
docker compose -f forgepay/observability/docker-compose.otel.yml up -d
```

### Production (Kubernetes)

1. **Deploy Jaeger**:
   ```yaml
   kubectl apply -f observability/k8s/jaeger.yaml
   ```

2. **Deploy Prometheus with ServiceMonitor**:
   ```yaml
   kubectl apply -f observability/k8s/prometheus.yaml
   ```

3. **Deploy Grafana with provisioned dashboards**:
   ```yaml
   kubectl apply -f observability/k8s/grafana.yaml
   ```

4. **Set OTEL_EXPORTER_OTLP_ENDPOINT in services**:
   ```yaml
   env:
     - name: OTEL_EXPORTER_OTLP_ENDPOINT
       value: "http://otel-collector.observability:4317"
   ```

## Further Reading

- [OBSERVABILITY.md](./OBSERVABILITY.md) - Complete architecture guide
- [OpenTelemetry Docs](https://opentelemetry.io/docs/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [Prometheus PromQL](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Grafana Dashboards](https://grafana.com/docs/grafana/latest/dashboards/)

## Support

For issues or questions about observability:

1. Check [OBSERVABILITY.md Troubleshooting](./OBSERVABILITY.md#troubleshooting)
2. Review service logs: `docker logs <service-name>`
3. Check collector logs: `docker logs otel-collector`
4. View Prometheus targets: http://localhost:9090/targets
