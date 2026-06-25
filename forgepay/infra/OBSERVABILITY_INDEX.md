# ForgePay Prometheus Observability - Implementation Index

This document provides a quick reference index to all Prometheus observability files created for ForgePay services.

## Quick Links

### Documentation
- **[HELM_PROMETHEUS_UPDATES.md](./HELM_PROMETHEUS_UPDATES.md)** - Detailed summary of all Helm chart changes
- **[observability/MONITORING.md](./observability/MONITORING.md)** - Comprehensive monitoring setup guide with deployment instructions

### Alert Rules
- **[observability/monitoring/prometheus-rules.yaml](./observability/monitoring/prometheus-rules.yaml)** - Prometheus alert rules for all services (6 alert groups, 7 total alerts)

### Dashboard
- **[observability/monitoring/grafana-dashboard.json](./observability/monitoring/grafana-dashboard.json)** - Pre-built Grafana dashboard with 6 visualization panels

## Service Helm Charts - ServiceMonitor Templates

Each service has a new `serviceMonitor.yaml` template for Prometheus auto-discovery:

### Core Payment Services
1. **[helm/unified-router/templates/serviceMonitor.yaml](./helm/unified-router/templates/serviceMonitor.yaml)**
   - Port: 9090 | Business Port: 8000
   
2. **[helm/mor-layer/templates/serviceMonitor.yaml](./helm/mor-layer/templates/serviceMonitor.yaml)**
   - Port: 9091 | Business Port: 8010
   
3. **[helm/billing-engine/templates/serviceMonitor.yaml](./helm/billing-engine/templates/serviceMonitor.yaml)**
   - Port: 9092 | Business Port: 8080

### Blockchain & Stablecoin Services
4. **[helm/stablecoin-gateway/templates/serviceMonitor.yaml](./helm/stablecoin-gateway/templates/serviceMonitor.yaml)**
   - Port: 9093 | Business Port: 8020
   
5. **[helm/crypto-gateway/templates/serviceMonitor.yaml](./helm/crypto-gateway/templates/serviceMonitor.yaml)**
   - Port: 9094 | Business Port: 8030

### Infrastructure & Agent Services
6. **[helm/bank-connectivity/templates/serviceMonitor.yaml](./helm/bank-connectivity/templates/serviceMonitor.yaml)**
   - Port: 9095 | Business Port: 8040
   
7. **[helm/enterprise-treasury/templates/serviceMonitor.yaml](./helm/enterprise-treasury/templates/serviceMonitor.yaml)**
   - Port: 9096 | Business Port: 8050
   
8. **[helm/agent-credit-lines/templates/serviceMonitor.yaml](./helm/agent-credit-lines/templates/serviceMonitor.yaml)**
   - Port: 9097 | Business Port: 8060
   
9. **[helm/agent-identity/templates/serviceMonitor.yaml](./helm/agent-identity/templates/serviceMonitor.yaml)**
   - Port: 9098 | Business Port: 8070

### New Service (Yield Engine)
10. **[helm/yield-engine/templates/serviceMonitor.yaml](./helm/yield-engine/templates/serviceMonitor.yaml)**
    - Port: 9099 | Business Port: 8100

## Updated Helm Chart Components

### values.yaml Updates
All 10 service charts have been updated with:
```yaml
metrics:
  enabled: true
  port: 909X
  path: /metrics

serviceMonitor:
  enabled: true
  interval: 30s
  scrapeTimeout: 10s
  labels:
    release: prometheus
```

### Deployment Template Updates
All `templates/deployment.yaml` files now include:
- Metrics port exposure (909X)
- Conditional metrics port binding
- Health probe configurations

### Service Template Updates
All `templates/service.yaml` files now include:
- Metrics port in service spec
- Conditional service port for metrics
- Targets metrics containerPort

## Alert Groups in prometheus-rules.yaml

### 1. forgepay.service_health
- `ServiceMetricsEndpointDown` - Triggered when service stops reporting metrics (5m window, CRITICAL)

### 2. forgepay.service_latency
- `ServiceLatencyHigh` - Triggered when HTTP p95 latency > 500ms (5m window, WARNING)

### 3. forgepay.service_errors
- `ServiceErrorRateHigh` - Triggered when error rate > 5% (5m window, CRITICAL)

### 4. forgepay.database
- `DatabaseConnectionPoolExhausted` - Triggered when connection pool > 90% (5m window, WARNING)

### 5. forgepay.resource_constraints
- `ContainerMemoryHigh` - Triggered when memory > 85% of limit (5m window, WARNING)
- `ContainerCPUHigh` - Triggered when CPU > 80% of limit (5m window, WARNING)

## Grafana Dashboard Panels

The dashboard in `observability/monitoring/grafana-dashboard.json` includes:

1. **HTTP Request Rate per Service** (timeseries)
   - Shows requests/sec trend per service
   
2. **HTTP Latency (p50/p95/p99) per Service** (timeseries)
   - Shows latency percentile trends
   
3. **Success Rate per Service** (gauge)
   - Percentage of successful requests
   
4. **5xx Error Rate per Service** (timeseries)
   - Server error rate trend
   
5. **Active Network Connections per Service** (timeseries)
   - Connection count per service
   
6. **Memory Usage per Pod** (timeseries)
   - Memory consumption trend

## New Helm Chart: yield-engine

A complete Helm chart was created for the yield-engine service:

```
helm/yield-engine/
├── Chart.yaml
├── values.yaml (with metrics config)
└── templates/
    ├── _helpers.tpl
    ├── deployment.yaml (with metrics port)
    ├── service.yaml (with metrics port)
    ├── serviceMonitor.yaml (Prometheus discovery)
    └── hpa.yaml (auto-scaling)
```

## Deployment Instructions

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
cd forgepay/infra/helm/[service-name]
helm install [service-name] . -n forgepay -f values.yaml
```

### 3. Verify Scraping
```bash
kubectl get servicemonitor -n forgepay
kubectl port-forward -n forgepay svc/forgepay-monitoring-kube-prometheus-prometheus 9090:9090
# Visit http://localhost:9090/targets to verify all services are UP
```

### 4. Access Grafana
```bash
kubectl port-forward -n forgepay svc/forgepay-monitoring-grafana 3000:80
# Visit http://localhost:3000 (default: admin/changeme)
```

## Metrics Instrumentation Required

Each service must implement metrics exporters. See `observability/MONITORING.md` for examples for:
- Node.js (unified-router, stablecoin-gateway, crypto-gateway, yield-engine)
- Python (mor-layer)
- Java (billing-engine)

Required metrics:
- `http_requests_total` (Counter with status, method, path labels)
- `http_request_duration_seconds` (Histogram with buckets)
- Custom business metrics (per service)

## File Statistics

- **New ServiceMonitor files**: 10
- **Updated deployment.yaml files**: 10
- **Updated service.yaml files**: 10
- **Updated values.yaml files**: 10
- **New Prometheus rules**: 1
- **New Grafana dashboard**: 1
- **New complete Helm chart**: 1 (yield-engine)
- **Documentation files**: 2

**Total: 44+ files created or modified**

## Metrics Ports Allocated

```
9090 - unified-router
9091 - mor-layer
9092 - billing-engine
9093 - stablecoin-gateway
9094 - crypto-gateway
9095 - bank-connectivity
9096 - enterprise-treasury
9097 - agent-credit-lines
9098 - agent-identity
9099 - yield-engine
```

All ports reserved and non-conflicting.

## Key Features

✓ **Automated Discovery** - Prometheus auto-discovers services via ServiceMonitor CRD
✓ **Standardized Scraping** - 30-second interval, 10-second timeout for all services
✓ **Health Probes** - Liveness and readiness probes configured per service
✓ **Resource Management** - CPU/memory requests and limits defined
✓ **Alert Rules** - Critical and warning alerts for service health, latency, errors, and resources
✓ **Dashboard** - Pre-built Grafana dashboard with 6 key panels
✓ **Documentation** - Comprehensive guides for deployment and troubleshooting
✓ **Scaling Ready** - Auto-scaling configured (HPA) for all services
✓ **Complete Chart** - New yield-engine service chart fully implemented

## Next Steps

1. Implement metrics exporters in service code (see MONITORING.md)
2. Configure AlertManager routing for notifications
3. Deploy monitoring stack and services to Kubernetes
4. Verify ServiceMonitors are discovered and scraping metrics
5. Customize Grafana dashboards per team requirements
6. Set up long-term metrics storage/archival

## Support & Troubleshooting

See `observability/MONITORING.md` for:
- Detailed troubleshooting guide
- PromQL query examples
- Scaling best practices
- Reference documentation links

---

**Created**: 2026-06-24
**Status**: Ready for deployment
**Next phase**: Metrics instrumentation in service code
