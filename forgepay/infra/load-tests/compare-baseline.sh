#!/bin/bash
# Compare current load test results to baseline
# Fails if p95 latency regressed by more than 25% or error rate doubled
# Usage: ./compare-baseline.sh [CURRENT] [BASELINE]
# Example: ./compare-baseline.sh results/run-latest.json results/baseline.json

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 CURRENT_RESULTS BASELINE_RESULTS"
  echo "Example: $0 results/run-latest.json results/baseline.json"
  exit 1
fi

CURRENT="$1"
BASELINE="$2"

if [ ! -f "$CURRENT" ]; then
  echo "❌ Current results file not found: $CURRENT"
  exit 1
fi

if [ ! -f "$BASELINE" ]; then
  echo "❌ Baseline results file not found: $BASELINE"
  exit 1
fi

echo "📊 Comparing performance: $CURRENT vs $BASELINE"
echo ""

# Extract metrics
CURRENT_P95=$(jq '.metrics.http_req_duration.values["p(95)"]' "$CURRENT" 2>/dev/null || echo "0")
BASELINE_P95=$(jq '.metrics.http_req_duration.values["p(95)"]' "$BASELINE" 2>/dev/null || echo "0")

CURRENT_ERR=$(jq '.metrics.http_req_failed.values.rate // 0' "$CURRENT" 2>/dev/null || echo "0")
BASELINE_ERR=$(jq '.metrics.http_req_failed.values.rate // 0' "$BASELINE" 2>/dev/null || echo "0")

# Convert to numbers
CURRENT_P95=$(echo "$CURRENT_P95" | xargs)
BASELINE_P95=$(echo "$BASELINE_P95" | xargs)
CURRENT_ERR=$(echo "$CURRENT_ERR" | xargs)
BASELINE_ERR=$(echo "$BASELINE_ERR" | xargs)

if [ -z "$CURRENT_P95" ] || [ -z "$BASELINE_P95" ]; then
  echo "⚠️  Could not extract metrics from JSON files"
  exit 0
fi

echo "Latency (p95):"
echo "  Baseline: ${BASELINE_P95}ms"
echo "  Current:  ${CURRENT_P95}ms"

echo ""
echo "Error rate:"
echo "  Baseline: $(echo "scale=2; $BASELINE_ERR * 100" | bc)%"
echo "  Current:  $(echo "scale=2; $CURRENT_ERR * 100" | bc)%"
echo ""

# Check for regression: p95 > baseline + 25%
THRESHOLD=$(echo "scale=0; $BASELINE_P95 * 1.25" | bc)
if (( $(echo "$CURRENT_P95 > $THRESHOLD" | bc -l) )); then
  echo "❌ LATENCY REGRESSION: p95 ${CURRENT_P95}ms > baseline+25% (${THRESHOLD}ms)"
  exit 1
fi

# Check for error rate doubling
MAX_ERR=$(echo "scale=4; $BASELINE_ERR * 2" | bc)
if (( $(echo "$CURRENT_ERR > $MAX_ERR" | bc -l) )); then
  echo "❌ ERROR RATE REGRESSION: ${CURRENT_ERR} > baseline×2 (${MAX_ERR})"
  exit 1
fi

echo "✅ Performance within baseline thresholds"
exit 0
