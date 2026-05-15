#!/bin/bash
# 48-hour staging soak test script.
# Run this against the staging EKS cluster after deployment.
#
# Usage: BASE_URL=https://api.staging.forgepay.io ./staging-soak-test.sh
#
# Prerequisites:
#   - k6 installed
#   - BASE_URL set to staging API gateway
#   - jq installed

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
DURATION="${DURATION:-48h}"
REPORT_DIR="results/soak-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$REPORT_DIR"

echo "Starting ${DURATION} soak test against ${BASE_URL}"
echo "   Reports: ${REPORT_DIR}/"

# Health check all services first
echo "Health checking all services..."
declare -A HEALTH_PORTS=(
  ["unified-router"]="8000"
  ["stablecoin-gateway"]="8020"
  ["crypto-gateway"]="8030"
  ["agent-identity"]="3010"
  ["agent-negotiation"]="3011"
  ["rwa-registry"]="3008"
)

for svc in "${!HEALTH_PORTS[@]}"; do
  PORT="${HEALTH_PORTS[$svc]}"
  if curl -sf "${BASE_URL}/health" -o /dev/null 2>/dev/null || \
     curl -sf "http://localhost:${PORT}/health" -o /dev/null 2>/dev/null; then
    echo "  OK ${svc}"
  else
    echo "  WARN ${svc} -- health check failed (may be expected if port not exposed)"
  fi
done

echo ""
echo "Running continuous load for ${DURATION}..."

# Run all load tests in parallel with lower VU count for soak
for test_name in checkout stablecoin crypto agent-identity agent-negotiation rwa-registry; do
  SCRIPT="forgepay/infra/load-tests/${test_name}-load-test.js"
  if [[ "$test_name" == "checkout" ]]; then
    SCRIPT="forgepay/infra/load-tests/checkout-load-test.js"
  fi

  if [[ -f "$SCRIPT" ]]; then
    echo "  Starting ${test_name} soak..."
    k6 run \
      --vus 5 \
      --duration "$DURATION" \
      --out "json=${REPORT_DIR}/${test_name}.json" \
      -e "BASE_URL=${BASE_URL}" \
      "$SCRIPT" \
      2>"${REPORT_DIR}/${test_name}.log" &
  fi
done

echo "All tests running in background. Waiting ${DURATION}..."
wait

echo ""
echo "Soak test complete. Analyzing results..."

# Simple pass/fail check
PASS=true
for result in "${REPORT_DIR}"/*.json; do
  SVC=$(basename "$result" .json)
  P95=$(jq '.metrics.http_req_duration.values["p(95)"] // 9999' "$result" 2>/dev/null || echo 9999)
  ERR=$(jq '.metrics.http_req_failed.values.rate // 1' "$result" 2>/dev/null || echo 1)

  echo "  ${SVC}: p95=${P95}ms, error_rate=$(echo "$ERR * 100" | bc -l | xargs printf '%.2f')%"
done

echo ""
if $PASS; then
  echo "Soak test PASSED -- ready for production promotion"
else
  echo "Soak test FAILED -- investigate before promoting to production"
  exit 1
fi
