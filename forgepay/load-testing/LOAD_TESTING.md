# ForgePay Load Testing Runbook

This guide walks through running comprehensive load tests against all ForgePay critical services to validate production readiness.

## Prerequisites

- **Hardware**: 16 GB RAM, 4+ CPU cores minimum (recommend 32 GB RAM, 8+ cores for stress testing)
- **Docker & Docker Compose**: v20.10+
- **k6**: v0.50+ (or use the Docker image)
- **git**: current branch must be `claude/forgepay-platform-design-gEkgE`

### System Requirements Check

Before running tests, verify your system has adequate resources:

```bash
# Check available RAM
free -h

# Check CPU cores
nproc

# Verify Docker
docker --version && docker-compose --version

# Check available disk space (at least 5 GB recommended)
df -h /
```

## Running Load Tests

### Quick Start (5-minute baseline)

```bash
cd forgepay/load-testing

# Option 1: Using Docker Compose (recommended for local dev)
docker-compose -f docker-compose.load-testing.yml up

# Option 2: Using k6 directly (if services are already running)
k6 run load-test.js --vus 0 --stage "5m:100"
```

### Using the Convenience Wrapper Script

```bash
cd forgepay/load-testing

# Run full load test suite
./run-load-tests.sh

# Run with custom parameters
./run-load-tests.sh --duration 10m --vus 200

# Run specific service only
./run-load-tests.sh --service unified-router

# Run with baseline comparison
./run-load-tests.sh --baseline
```

### Manual k6 Execution

#### Test Configuration

Each service is tested with these parameters:

| Service | Endpoint | Method | RPS | Duration | Threshold |
|---------|----------|--------|-----|----------|-----------|
| **unified-router** | POST /webhooks/hyperswitch | POST | 100 | 5m | P99 < 2s, err < 1% |
| **mor-layer** | POST /v1/checkout/sessions | POST | 50 | 5m | P99 < 2s, err < 1% |
| **crypto-gateway** | GET /invoices/{id} | GET | 100 | 5m | P99 < 2s, err < 1% |
| **stablecoin-gateway** | POST /deposits | POST | 50 | 5m | P99 < 2s, err < 1% |
| **yield-engine** | GET /positions/{merchantId} | GET | 200 | 5m | P99 < 2s, err < 1% |
| **agent-identity** | GET /v1/agents | GET | 100 | 5m | P99 < 2s, err < 1% |

#### Running k6 Directly

```bash
# Full load test (runs all services in parallel scenarios)
k6 run load-test.js

# With output to JSON for analysis
k6 run load-test.js --out json=results.json

# With Prometheus output (if Prometheus running at localhost:9090)
k6 run load-test.js --out prometheus=http://localhost:9090/api/v1/write

# Custom virtual users and duration
k6 run load-test.js --vus 500 --duration 10m

# Ramp up test (start at 0 VUs, ramp to 100 over 2 minutes, hold 5 mins, ramp down 2 mins)
k6 run load-test.js \
  --stage "2m:100" \
  --stage "5m:100" \
  --stage "2m:0"

# Stress test (high load to find breaking point)
k6 run load-test.js \
  --stage "1m:50" \
  --stage "1m:100" \
  --stage "1m:200" \
  --stage "1m:300" \
  --stage "1m:0"
```

## Interpreting Results

### Success Criteria

All services must meet these thresholds for production readiness:

- **P50 Latency**: < 500ms (median response time)
- **P95 Latency**: < 1000ms (95th percentile)
- **P99 Latency**: < 2000ms (99th percentile - **HARD LIMIT**)
- **Error Rate**: < 1% (error_rate_pct < 1.0)
- **Throughput**: RPS must equal configured rate (no drops)

### Example Results

```json
{
  "timestamp": "2026-06-25T10:30:00Z",
  "test_duration": 300,
  "metrics": {
    "unified_router": {
      "p50_ms": 120,
      "p95_ms": 480,
      "p99_ms": 1200,
      "error_rate_pct": 0.05,
      "total_requests": 30000
    },
    "mor_layer": {
      "p50_ms": 150,
      "p95_ms": 620,
      "p99_ms": 1800,
      "error_rate_pct": 0.02,
      "total_requests": 15000
    }
  }
}
```

### Reading k6 Output

When tests complete, you'll see output like:

```
     http_req_duration....................: avg=245ms    min=50ms     med=180ms    max=3200ms p(90)=450ms p(95)=820ms p(99)=1900ms
     http_req_failed........................: 0.50%      ✓ 0        ✗ 75
     http_req_received......................: 98 KB     15 KB/s
     http_req_sending........................: avg=2ms     min=0s       med=2ms      max=50ms
     http_req_tls_handshaking...............: avg=0s      min=0s       med=0s       max=0s
     http_req_waiting........................: avg=241ms    min=48ms     med=177ms    max=3150ms
     http_requests...........................: 5000 avg 833.33/s
     iteration_duration......................: avg=1.1s    min=1.05s    med=1.08s    max=4.2s
     iterations...............................: 5000 avg 833.33/s
     vus......................................: 50       min=50      max=50
     vus_max..................................: 100      min=100     max=100
```

**Key metrics:**
- `http_req_duration`: Response time percentiles (must have p(99) < 2000ms)
- `http_req_failed`: Error rate (must be < 1%)
- `http_requests`: RPS (requests per second)
- `iterations`: Total requests completed

### Prometheus Visualization

If running with Prometheus output, view metrics at:

```
http://localhost:9090
```

Example PromQL queries:

```promql
# P99 latency for unified-router
histogram_quantile(0.99, rate(http_req_duration_bucket{service="unified-router"}[1m]))

# Error rate for all services
rate(http_req_failed[5m])

# RPS for mor-layer
rate(http_requests{service="mor-layer"}[1m])
```

## Troubleshooting

### "Services not responding" Errors

**Problem**: Tests fail because services aren't ready.

**Solution**:
```bash
# Wait for all services to be healthy
docker-compose -f docker-compose.load-testing.yml up --wait

# Or check health manually
docker-compose -f docker-compose.load-testing.yml ps
```

### "Connection refused" Errors

**Problem**: Services crashed or didn't start.

**Solution**:
```bash
# Check logs
docker-compose -f docker-compose.load-testing.yml logs unified-router

# Restart services
docker-compose -f docker-compose.load-testing.yml restart unified-router
```

### High Error Rates (> 1%)

**Problem**: More than 1% of requests are failing.

**Investigation**:
```bash
# Check service logs
docker-compose -f docker-compose.load-testing.yml logs mor-layer | tail -100

# Check database
docker-compose -f docker-compose.load-testing.yml exec postgres \
  psql -U forgepay -d forgepay_load_test -c "SELECT * FROM errors LIMIT 10;"

# Check Redis memory
docker-compose -f docker-compose.load-testing.yml exec redis redis-cli info memory
```

**Common causes**:
- **Database saturation**: Connection pool exhausted
- **Memory pressure**: Redis or services OOM
- **Slow queries**: N+1 queries or missing indexes
- **Resource limits**: CPU throttling

### High P99 Latency (> 2s)

**Problem**: 99th percentile latency exceeds 2 seconds.

**Investigation**:
```bash
# Check database slow log
docker-compose -f docker-compose.load-testing.yml exec postgres \
  psql -U forgepay -d forgepay_load_test -c \
  "SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;"

# Check service memory usage
docker-compose -f docker-compose.load-testing.yml stats

# Check database connection count
docker-compose -f docker-compose.load-testing.yml exec postgres \
  psql -U forgepay -d forgepay_load_test -c \
  "SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;"
```

**Common causes**:
- **Database indexes**: Missing index on frequently queried column
- **Connection pool**: Pool size too small for load
- **Garbage collection**: GC pauses in Node.js or Python services
- **Disk I/O**: Slow disk, high I/O wait

### "Out of memory" Errors

**Problem**: Test crashes due to memory exhaustion.

**Solution**:
```bash
# Increase Docker memory limit (edit docker-compose.load-testing.yml)
services:
  unified-router:
    mem_limit: 2g
    memswap_limit: 2g

# Or restart Docker daemon with higher limits
dockerd --memory=32g
```

## Scaling the Load Test

### For Capacity Planning

To find the maximum sustainable load before degradation:

```bash
# Gradually increase load
k6 run load-test.js \
  --stage "2m:100" \
  --stage "2m:200" \
  --stage "2m:300" \
  --stage "2m:400" \
  --stage "2m:500"
```

### For Stress Testing

To find the breaking point:

```bash
# Ramp up aggressively until services fail
k6 run load-test.js \
  --stage "5m:1000" \
  --stage "5m:2000" \
  --stage "5m:5000" \
  --stage "2m:0"
```

## Saving and Comparing Results

### Baseline Snapshot

Capture baseline metrics:

```bash
./run-load-tests.sh --capture-baseline

# This creates baseline.json with current performance
```

### Compare Against Baseline

After making code changes:

```bash
./run-load-tests.sh --baseline

# Compare shows deltas:
# ✓ unified-router: P99 1200ms → 1150ms (-50ms)
# ✗ mor-layer: P99 1800ms → 2100ms (+300ms) [REGRESSION]
```

### Export Results

```bash
# JSON output
k6 run load-test.js --out json=results-$(date +%s).json

# CSV export
k6 run load-test.js -o json=results.json
# Then convert with: jq '.data.samples | @csv' results.json > results.csv

# Push to DataDog or New Relic (requires API key)
k6 run load-test.js -o datadog
k6 run load-test.js -o newrelic
```

## Service-Specific Load Testing

### Test a Single Service

```bash
# Test only unified-router
k6 run load-test.js \
  --no-thresholds \
  --execution '{"ur": {"executor": "constant-arrival-rate", "rate": 100, "duration": "5m"}}'

# Test only mor-layer
k6 run load-test.js \
  --no-thresholds \
  --execution '{"ml": {"executor": "constant-arrival-rate", "rate": 50, "duration": "5m"}}'
```

### Spike Test (sudden traffic burst)

Validates handling of sudden spikes:

```bash
k6 run load-test.js \
  --stage "1m:50" \
  --stage "30s:500" \
  --stage "2m:50"
```

### Soak Test (long-running stability)

Runs at constant load for hours to find memory leaks:

```bash
k6 run load-test.js \
  --stage "5m:100" \
  --stage "24h:100" \
  --stage "5m:0"
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Load Test
on: [pull_request]

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: grafana/setup-k6-action@v1
      - run: cd forgepay/load-testing && ./run-load-tests.sh --baseline
      - uses: actions/upload-artifact@v3
        with:
          name: load-test-results
          path: forgepay/load-testing/results-*.json
```

## Go-Live Readiness

Before production deployment, all services must pass:

```bash
# Run full load test suite
./run-load-tests.sh

# Verify all thresholds pass
# ✓ unified-router:  P99=1200ms (< 2000ms), error=0.05% (< 1%)
# ✓ mor-layer:       P99=1800ms (< 2000ms), error=0.02% (< 1%)
# ... (all services)

# If any service FAILS, do NOT proceed to production
# Fix the issue and re-test
```

## Contact

For issues or questions about load testing:

- Check logs: `docker-compose -f docker-compose.load-testing.yml logs -f`
- Debug metrics: Open `http://localhost:9090` (Prometheus)
- Review k6 docs: https://k6.io/docs/

**Remember**: Load tests simulate production traffic patterns. Results inform capacity planning but don't guarantee production behavior under real-world conditions (network latency, cache misses, etc.).
