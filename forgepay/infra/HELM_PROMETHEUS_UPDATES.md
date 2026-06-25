# Helm Chart Prometheus Observability Updates

## Summary

Complete Prometheus observability implementation for all ForgePay microservices. This includes ServiceMonitor resources, metrics endpoints, health probes, alert rules, and Grafana dashboards.

## Changes Made

### 1. Service Helm Charts Updated

All service charts in `forgepay/infra/helm/*/` now include Prometheus observability:

#### Updated Charts:
- ✓ unified-router
- ✓ mor-layer
- ✓ billing-engine
- ✓ stablecoin-gateway
- ✓ crypto-gateway
- ✓ bank-connectivity
- ✓ enterprise-treasury
- ✓ agent-credit-lines
- ✓ agent-identity
- ✓ yield-engine (new)

#### Per-Service Updates:

**values.yaml**
- Added `metrics.enabled: true`
- Added `metrics.port: 909X` (service-specific port)
- Added `metrics.path: /metrics`
- Added `serviceMonitor.enabled: true`
- Added `serviceMonitor.interval: 30s`
- Added `serviceMonitor.scrapeTimeout: 10s`
- Added `serviceMonitor.labels: {release: prometheus}`

**templates/deployment.yaml**
- Added metrics port to container ports section
- Port name: `metrics`
- Conditional: `{{- if .Values.metrics.enabled }}`

**templates/service.yaml**
- Added metrics port to Service spec
- Port name: `metrics`
- Targets metrics containerPort
- Conditional: `{{- if .Values.metrics.enabled }}`

**templates/serviceMonitor.yaml** (new)
- Created for all 10 services
- Selects pods by app labels
- Scrapes /metrics endpoint with 30s interval
- Includes pod/namespace/app relabelings

### 2. Resource Configuration

All services configured with appropriate resources:

```yaml
# Example: unified-router (NodeJS, low-resource)
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi

# Example: mor-layer (Python FastAPI, medium)
resources:
  requests:
    cpu: 200m
    memory: 512Mi
  limits:
    cpu: 1000m
    memory: 1024Mi

# Example: billing-engine (Java/Kill Bill, high)
resources:
  requests:
    cpu: 500m
    memory: 1024Mi
  limits:
    cpu: 2000m
    memory: 2048Mi
```

### 3. Health Probes

Configured liveness and readiness probes for all services:

```yaml
livenessProbe:
  httpGet:
    path: /healthz              # or /health, /1.0/kb/health
    port: 80XX
  initialDelaySeconds: 10-60    # Service-specific
  periodSeconds: 15-30          # Service-specific

readinessProbe:
  httpGet:
    path: /readyz               # or /ready, /1.0/kb/health
    port: 80XX
  initialDelaySeconds: 5-30     # Service-specific
  periodSeconds: 10-15          # Service-specific
```

### 4. Metrics Ports

Allocated unique metrics ports for each service to avoid conflicts:

| Service | Metrics Port | Business Port |
|---------|--------------|---------------|
| unified-router | 9090 | 8000 |
| mor-layer | 9091 | 8010 |
| billing-engine | 9092 | 8080 |
| stablecoin-gateway | 9093 | 8020 |
| crypto-gateway | 9094 | 8030 |
| bank-connectivity | 9095 | 8040 |
| enterprise-treasury | 9096 | 8050 |
| agent-credit-lines | 9097 | 8060 |
| agent-identity | 9098 | 8070 |
| yield-engine | 9099 | 8100 |

### 5. Prometheus Alert Rules

Created `forgepay/infra/observability/monitoring/prometheus-rules.yaml`:

**Alert Groups:**

1. **forgepay.service_health**
   - `ServiceMetricsEndpointDown`: Triggered after 5 minutes of no metrics
   - Severity: CRITICAL

2. **forgepay.service_latency**
   - `ServiceLatencyHigh`: Triggered when p95 latency > 500ms (5m window)
   - Severity: WARNING

3. **forgepay.service_errors**
   - `ServiceErrorRateHigh`: Triggered when error rate > 5% (5m window)
   - Severity: CRITICAL

4. **forgepay.database**
   - `DatabaseConnectionPoolExhausted`: Triggered when pool > 90% (5m window)
   - Severity: WARNING

5. **forgepay.resource_constraints**
   - `ContainerMemoryHigh`: Triggered when memory > 85% of limit (5m window)
   - `ContainerCPUHigh`: Triggered when CPU > 80% of limit (5m window)
   - Severity: WARNING

### 6. Grafana Dashboard

Created `forgepay/infra/observability/monitoring/grafana-dashboard.json`:

**Dashboard Panels:**

1. **HTTP Request Rate per Service** (timeseries)
   - Shows requests/sec for each service
   - 5-minute window

2. **HTTP Latency (p50/p95/p99) per Service** (timeseries)
   - Shows latency percentiles
   - Identifies performance bottlenecks

3. **Success Rate per Service** (gauge)
   - Percentage of successful requests
   - Color-coded thresholds: green (>99%), yellow (>5%), red (<=5%)

4. **5xx Error Rate per Service** (timeseries)
   - Percentage of server errors
   - Thresholds: green (<1%), yellow (<5%), red (>=5%)

5. **Active Network Connections per Service** (timeseries)
   - Connection count trend
   - Identifies connection leaks

6. **Memory Usage per Pod** (timeseries)
   - Memory consumption trend
   - Helps with capacity planning

### 7. Documentation

Created `forgepay/infra/observability/MONITORING.md`:

Comprehensive guide covering:
- Architecture overview
- Service monitoring details
- Helm chart structure
- Resource allocations
- Probe configuration
- Alert rules
- Grafana dashboard
- Deployment instructions
- Metrics collection requirements
- Scaling considerations
- Troubleshooting guide

## File Structure

```
forgepay/infra/
├── helm/
│   ├── unified-router/
│   │   ├── values.yaml (updated with metrics)
│   │   └── templates/
│   │       ├── deployment.yaml (updated with metrics port)
│   │       ├── service.yaml (updated with metrics port)
│   │       └── serviceMonitor.yaml (new)
│   ├── mor-layer/
│   │   ├── values.yaml (updated)
│   │   └── templates/
│   │       ├── deployment.yaml (updated)
│   │       ├── service.yaml (updated)
│   │       └── serviceMonitor.yaml (new)
│   ├── billing-engine/
│   │   ├── values.yaml (updated)
│   │   └── templates/
│   │       ├── deployment.yaml (updated)
│   │       ├── service.yaml (updated)
│   │       └── serviceMonitor.yaml (new)
│   ├── stablecoin-gateway/
│   │   ├── values.yaml (updated)
│   │   └── templates/
│   │       ├── deployment.yaml (updated)
│   │       ├── service.yaml (updated)
│   │       └── serviceMonitor.yaml (new)
│   ├── crypto-gateway/
│   │   ├── values.yaml (updated)
│   │   └── templates/
│   │       ├── deployment.yaml (updated)
│   │       ├── service.yaml (updated)
│   │       └── serviceMonitor.yaml (new)
│   ├── bank-connectivity/
│   │   ├── values.yaml (updated)
│   │   └── templates/
│   │       ├── deployment.yaml (updated)
│   │       ├── service.yaml (updated)
│   │       └── serviceMonitor.yaml (new)
│   ├── enterprise-treasury/
│   │   ├── values.yaml (updated)
│   │   └── templates/
│   │       ├── deployment.yaml (updated)
│   │       ├── service.yaml (updated)
│   │       └── serviceMonitor.yaml (new)
│   ├── agent-credit-lines/
│   │   ├── values.yaml (updated)
│   │   └── templates/
│   │       ├── deployment.yaml (updated)
│   │       ├── service.yaml (updated)
│   │       └── serviceMonitor.yaml (new)
│   ├── agent-identity/
│   │   ├── values.yaml (updated)
│   │   └── templates/
│   │       ├── deployment.yaml (updated)
│   │       ├── service.yaml (updated)
│   │       └── serviceMonitor.yaml (new)
│   └── yield-engine/ (new)
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates/
│           ├── _helpers.tpl
│           ├── deployment.yaml
│           ├── service.yaml
│           ├── serviceMonitor.yaml
│           └── hpa.yaml
├── observability/
│   ├── monitoring/
│   │   ├── prometheus-rules.yaml (new)
│   │   └── grafana-dashboard.json (new)
│   ├── MONITORING.md (new)
│   └── helm/forgepay-monitoring/
│       └── values.yaml (existing - integrates with new alerts/dashboards)
└── HELM_PROMETHEUS_UPDATES.md (this file)
```

## Deployment Steps

### 1. Deploy Monitoring Stack

```bash
cd forgepay/infra/observability/helm/forgepay-monitoring
helm dependency update
helm install forgepay-monitoring . \
  -n forgepay --create-namespace \
  -f values.yaml
```

### 2. Deploy Services

```bash
# Deploy unified-router
cd forgepay/infra/helm/unified-router
helm install unified-router . -n forgepay -f values.yaml

# Repeat for all other services...
cd ../mor-layer
helm install mor-layer . -n forgepay -f values.yaml
# etc.
```

### 3. Verify Prometheus Scraping

```bash
# Check ServiceMonitors created
kubectl get servicemonitor -n forgepay

# Port-forward and verify targets
kubectl port-forward -n forgepay svc/forgepay-monitoring-kube-prometheus-prometheus 9090:9090
# Visit http://localhost:9090/targets
```

### 4. Access Grafana Dashboard

```bash
kubectl port-forward -n forgepay svc/forgepay-monitoring-grafana 3000:80
# Visit http://localhost:3000
# Default: admin / (from values.yaml)
```

## Metrics Instrumentation

Services must export Prometheus metrics to `/metrics` endpoint.

### Node.js Example (unified-router, stablecoin-gateway, etc.)

```javascript
const prometheus = require('prom-client');

// Create metrics
const httpRequests = new prometheus.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['status', 'method', 'path']
});

const httpDuration = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['status', 'method', 'path'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
});

// Express middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequests.labels(res.statusCode, req.method, req.path).inc();
    httpDuration.labels(res.statusCode, req.method, req.path).observe(duration);
  });
  next();
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.end(prometheus.register.metrics());
});
```

### Python Example (mor-layer)

```python
from prometheus_client import Counter, Histogram, generate_latest, REGISTRY
from flask import Flask

app = Flask(__name__)

http_requests = Counter('http_requests_total', 'Total HTTP requests',
                       ['status', 'method', 'path'])
http_duration = Histogram('http_request_duration_seconds', 'HTTP request duration',
                         ['status', 'method', 'path'],
                         buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10])

@app.route('/metrics')
def metrics():
    return generate_latest(REGISTRY)
```

### Java Example (billing-engine)

```java
import io.micrometer.prometheus.PrometheusMeterRegistry;
import org.springframework.boot.actuate.metrics.web.servlet.WebMvcTagsContributor;

@Configuration
public class MetricsConfig {
    @Bean
    public PrometheusMeterRegistry prometheusMeterRegistry() {
        return new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
    }
}

// Spring Boot automatically exposes /actuator/prometheus
// Configure in application.properties:
// management.endpoints.web.exposure.include=prometheus
```

## Alert Routing

Alerts are routed via AlertManager (configured in `forgepay-monitoring/values.yaml`):

- **CRITICAL** severity → PagerDuty (page on-call)
- **WARNING** severity → Slack/Email notification
- **INFO** severity → Logged only

Update AlertManager routing rules in monitoring chart values.

## Performance Tuning

### For High-Traffic Services

Increase resource limits for:
- **unified-router**: High RPS, keep at current limits
- **mor-layer**: Medium RPS, may need increase during peak
- **billing-engine**: Lower RPS but heavier computations, keep generous limits

### For Prometheus

If high cardinality metrics cause issues:

```yaml
# In forgepay-monitoring values.yaml
prometheus:
  prometheusSpec:
    retention: "14d"          # Reduce from 30d
    retentionSize: "20GB"     # Reduce from 50GB
    # OR use remote storage
```

## Next Steps

1. **Implement metrics exporters** in each service (see Metrics Instrumentation)
2. **Configure AlertManager routing** to send alerts to your channels
3. **Customize Grafana dashboard** based on business requirements
4. **Set up log aggregation** to correlate with Prometheus metrics
5. **Configure backup/retention** for long-term metrics storage

## Support

Refer to `forgepay/infra/observability/MONITORING.md` for:
- Detailed troubleshooting guide
- PromQL query examples
- Scaling best practices
- Reference links
