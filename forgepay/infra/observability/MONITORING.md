# ForgePay Prometheus Observability Setup

This document describes the Prometheus observability configuration for all ForgePay services.

## Architecture Overview

ForgePay uses kube-prometheus-stack (Prometheus + Grafana + AlertManager) deployed via Helm chart at `forgepay/infra/observability/helm/forgepay-monitoring/`.

### Service Monitoring

Each ForgePay microservice has:
- **metrics endpoint** on a dedicated port (9090-9099)
- **ServiceMonitor** custom resource for Prometheus auto-discovery
- **deployment port** for business logic
- **readiness/liveness probes** for health checks

### Services Monitored

All services export metrics on `/metrics` endpoint with 30-second scrape interval:

| Service | Port | Metrics Port | Probe Path |
|---------|------|--------------|-----------|
| unified-router | 8000 | 9090 | /healthz, /readyz |
| mor-layer | 8010 | 9091 | /health, /ready |
| billing-engine | 8080 | 9092 | /1.0/kb/health |
| stablecoin-gateway | 8020 | 9093 | /healthz, /readyz |
| crypto-gateway | 8030 | 9094 | /healthz, /readyz |
| bank-connectivity | 8040 | 9095 | (health probes) |
| enterprise-treasury | 8050 | 9096 | (health probes) |
| agent-credit-lines | 8060 | 9097 | (health probes) |
| agent-identity | 8070 | 9098 | (health probes) |
| yield-engine | 8100 | 9099 | /healthz, /readyz |

## Helm Chart Updates

### 1. Service Values (values.yaml)

Each service chart now includes:

```yaml
# Prometheus metrics configuration
metrics:
  enabled: true
  port: 909X           # Service-specific port (9090-9099)
  path: /metrics

# Service Monitor for Prometheus scraping
serviceMonitor:
  enabled: true
  interval: 30s
  scrapeTimeout: 10s
  labels:
    release: prometheus
```

### 2. Deployment Templates

Deployment manifests expose metrics port:

```yaml
ports:
  - name: http
    containerPort: 80XX
    protocol: TCP
  {{- if .Values.metrics.enabled }}
  - name: metrics
    containerPort: {{ .Values.metrics.port }}
    protocol: TCP
  {{- end }}
```

### 3. Service Templates

Kubernetes Service exposes both HTTP and metrics endpoints:

```yaml
ports:
  - port: 80XX
    targetPort: http
    name: http
  {{- if .Values.metrics.enabled }}
  - port: 909X
    targetPort: metrics
    name: metrics
  {{- end }}
```

### 4. ServiceMonitor Templates

Each service has `templates/serviceMonitor.yaml` for Prometheus auto-discovery:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ .Values.global.name }}
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ .Values.global.name }}
  endpoints:
    - port: metrics
      interval: 30s
      path: /metrics
      scheme: http
```

## Resource Allocations

All services configured with:

```yaml
resources:
  requests:
    cpu: 100m - 500m      # Based on service demands
    memory: 128Mi - 1Gi
  limits:
    cpu: 500m - 2000m     # Based on service demands
    memory: 512Mi - 2Gi
```

## Probe Configuration

### Liveness Probes

Check if service is responding:
- **unified-router, stablecoin-gateway, crypto-gateway, yield-engine**: GET /healthz (port 80XX)
- **mor-layer**: GET /health (port 8010)
- **billing-engine**: GET /1.0/kb/health (port 8080)

Initial delay: 10-60s, Period: 15-30s

### Readiness Probes

Check if service is ready for traffic:
- **unified-router, stablecoin-gateway, crypto-gateway, yield-engine**: GET /readyz (port 80XX)
- **mor-layer**: GET /ready (port 8010)
- **billing-engine**: GET /1.0/kb/health (port 8080)

Initial delay: 5-30s, Period: 10-15s

## Prometheus Rules

Alert rules configured in `forgepay/infra/observability/monitoring/prometheus-rules.yaml`:

### Critical Alerts

1. **ServiceMetricsEndpointDown** (5m window)
   - Triggered when service metrics endpoint is unreachable
   - All services monitored
   - Severity: CRITICAL

2. **ServiceErrorRateHigh** (5m window)
   - Triggered when 5xx error rate > 5%
   - Indicates degraded service
   - Severity: CRITICAL

### Warning Alerts

3. **ServiceLatencyHigh** (5m window)
   - Triggered when p95 latency > 500ms
   - Indicates performance degradation
   - Severity: WARNING

4. **DatabaseConnectionPoolExhausted** (5m window)
   - Triggered when connection pool > 90% capacity
   - Severity: WARNING

5. **ContainerMemoryHigh** (5m window)
   - Triggered when memory usage > 85% of limit
   - Severity: WARNING

6. **ContainerCPUHigh** (5m window)
   - Triggered when CPU usage > 80% of limit
   - Severity: WARNING

## Grafana Dashboard

Dashboard available at `forgepay/infra/observability/monitoring/grafana-dashboard.json`:

### Panels

1. **HTTP Request Rate per Service** (timeseries)
   - Metric: `sum by (job) (rate(http_requests_total[5m]))`
   - Unit: requests/sec
   - Interval: 5m

2. **HTTP Latency (p50/p95/p99) per Service** (timeseries)
   - Metrics: histogram quantiles at 50th, 95th, 99th percentiles
   - Unit: seconds
   - Interval: 5m

3. **Success Rate per Service** (gauge)
   - Metric: `(2xx requests) / (total requests)`
   - Unit: %
   - Thresholds: green >99%, yellow >5%, red <=5%

4. **5xx Error Rate per Service** (timeseries)
   - Metric: `(5xx requests) / (total requests)`
   - Unit: %
   - Thresholds: green <1%, yellow <5%, red >=5%

5. **Active Network Connections per Service** (timeseries)
   - Metric: TCP connection count per pod
   - Unit: connections

6. **Memory Usage per Pod** (timeseries)
   - Metric: `container_memory_usage_bytes`
   - Unit: MB

## Deployment

### Prerequisites

1. Kubernetes cluster with metrics-server installed
2. Prometheus CRD support (kube-prometheus-stack)
3. Sufficient storage for Prometheus (30 days @ 50Gi default)

### Install Monitoring Stack

```bash
# Add Helm repository
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo add jaegertracing https://jaegertracing.github.io/helm-charts
helm repo update

# Install monitoring stack
cd forgepay/infra/observability/helm/forgepay-monitoring
helm dependency update
helm install forgepay-monitoring . \
  -n forgepay \
  --create-namespace \
  -f values.yaml
```

### Deploy Services with Monitoring

Each service will auto-register with Prometheus via ServiceMonitor:

```bash
# Example: Deploy unified-router
cd forgepay/infra/helm/unified-router
helm install unified-router . \
  -n forgepay \
  -f values.yaml
```

Once deployed, Prometheus will automatically scrape metrics from the service's metrics endpoint.

### Verify Scraping

```bash
# Check ServiceMonitor resources
kubectl get servicemonitor -n forgepay

# Port-forward to Prometheus
kubectl port-forward -n forgepay svc/forgepay-monitoring-kube-prometheus-prometheus 9090:9090

# Visit http://localhost:9090/targets to verify scraping
```

### Access Grafana

```bash
# Port-forward to Grafana
kubectl port-forward -n forgepay svc/forgepay-monitoring-grafana 3000:80

# Default credentials: admin / (from values.yaml adminPassword)
# Visit http://localhost:3000 to view dashboards
```

## Metrics Collection

### Instrumentation Required

Each service must export Prometheus-compatible metrics on `/metrics` endpoint:

**Node.js services** (unified-router, mor-layer, stablecoin-gateway, crypto-gateway, yield-engine):
```javascript
const prometheus = require('prom-client');

app.get('/metrics', (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.end(prometheus.register.metrics());
});
```

**Java services** (billing-engine):
```java
// Use Micrometer with prometheus registry
registry.counter("http.requests", "status", status).increment();
registry.timer("http.request.duration").record(duration);
```

**Python services** (mor-layer):
```python
from prometheus_client import Counter, Histogram, generate_latest

http_requests_total = Counter('http_requests_total', 'Total HTTP requests', ['status'])
http_request_duration = Histogram('http_request_duration_seconds', 'HTTP request duration')

@app.route('/metrics')
def metrics():
    return generate_latest()
```

### Standard Metrics to Export

All services should export:

1. `http_requests_total` (Counter)
   - Labels: status, method, path, service
   - Example: `http_requests_total{status="200", method="POST", path="/payments"}`

2. `http_request_duration_seconds` (Histogram)
   - Labels: status, method, path, service
   - Buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
   - Example: `http_request_duration_seconds_bucket{le="0.5", method="POST"}`

3. `up` (Gauge)
   - Labels: job, instance
   - Value: 1 (service running), 0 (service down)
   - Automatically generated by Prometheus

4. Custom business metrics (per service):
   - Payment success rate
   - Webhook delivery latency
   - Database query time
   - Cache hit rate
   - etc.

## Scaling Considerations

### High-Load Deployments

For production deployments with high metric cardinality:

1. **Retention Policy**: Adjust in `forgepay-monitoring/values.yaml`
   ```yaml
   prometheus:
     prometheusSpec:
       retention: "30d"        # Default
       retentionSize: "40GB"   # Max storage
   ```

2. **Scrape Interval**: Increase from 30s to 1m for less frequent services
   ```yaml
   serviceMonitor:
     interval: 60s
   ```

3. **Label Cardinality**: Avoid high-cardinality labels in metrics
   - ✓ Good: `status="200", method="POST"`
   - ✗ Bad: `user_id="123456"`, `request_id="abc-xyz"`

4. **Remote Storage**: Configure for long-term retention
   ```yaml
   prometheus:
     prometheusSpec:
       remoteWrite:
         - url: "https://prometheus-remote-storage.example.com/api/v1/write"
           basicAuth:
             username: ...
             password: ...
   ```

## Troubleshooting

### No metrics appearing

1. **Check ServiceMonitor created**:
   ```bash
   kubectl get servicemonitor -n forgepay
   kubectl describe servicemonitor <service-name> -n forgepay
   ```

2. **Verify service exports metrics**:
   ```bash
   kubectl port-forward -n forgepay svc/<service-name> 909X:909X
   curl http://localhost:909X/metrics
   ```

3. **Check Prometheus targets**:
   - Port-forward to Prometheus (port 9090)
   - Navigate to Status > Targets
   - Look for your service in "Up" or "Down" list

### Metrics endpoint returns 404

- Service must be listening on metrics port (909X)
- Endpoint must be `/metrics` (case-sensitive)
- Verify deployment port mapping in values.yaml

### High memory usage

- Reduce retention period
- Reduce number of metrics collected
- Increase Prometheus resource limits
- Enable compression for remote write

### Alerts not firing

1. **Check AlertManager configuration**:
   ```bash
   kubectl logs -n forgepay svc/forgepay-monitoring-kube-prometheus-alertmanager
   ```

2. **Verify PrometheusRule created**:
   ```bash
   kubectl get prometheusrule -n forgepay
   ```

3. **Test PromQL queries** in Prometheus UI

## References

- [Prometheus Documentation](https://prometheus.io/docs/)
- [kube-prometheus-stack](https://github.com/prometheus-community/kube-prometheus)
- [Grafana Dashboards](https://grafana.com/grafana/dashboards/)
- [PromQL Aggregation Examples](https://prometheus.io/docs/prometheus/latest/querying/operators/#aggregation-operators)
