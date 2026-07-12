#!/bin/bash
# Compare a single service's current load-test run against its recorded
# baseline. Fails if p95 latency regressed by more than 25% or the error
# rate more than doubled.
#
# Usage: ./compare-baseline.sh SERVICE CURRENT_SUMMARY [BASELINE_JSON]
# Example: ./compare-baseline.sh rwa-registry results/rwa-registry-latest.json
#
# CURRENT_SUMMARY must be a k6 `--summary-export` file (aggregate JSON,
# shaped like `.metrics.http_req_duration["p(95)"]`) — NOT a `--out
# json=` file, which is a raw per-sample NDJSON stream with no top-level
# `.metrics` object at all (see capture-baseline.sh for the full
# explanation; this bit both scripts identically before it was fixed).
#
# BASELINE_JSON defaults to load-tests/baseline.json, which is keyed per
# service: `.services.<SERVICE>.{p50_ms,p95_ms,p99_ms,error_rate_pct}`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -lt 2 ]; then
  echo "Usage: $0 SERVICE CURRENT_SUMMARY [BASELINE_JSON]"
  echo "Example: $0 rwa-registry results/rwa-registry-latest.json"
  exit 1
fi

SERVICE="$1"
CURRENT="$2"
BASELINE="${3:-$SCRIPT_DIR/baseline.json}"

if [ ! -f "$CURRENT" ]; then
  echo "Current results file not found: $CURRENT"
  exit 1
fi

if [ ! -f "$BASELINE" ]; then
  echo "Baseline file not found: $BASELINE"
  exit 1
fi

BASELINE_ENTRY=$(jq --arg svc "$SERVICE" '.services[$svc] // empty' "$BASELINE")
if [ -z "$BASELINE_ENTRY" ]; then
  echo "No baseline recorded for service \"$SERVICE\" in $BASELINE — nothing to compare against."
  echo "Known services: $(jq -r '.services | keys | join(", ")' "$BASELINE")"
  exit 1
fi

echo "Comparing performance for ${SERVICE}: $CURRENT vs $BASELINE"
echo ""

CURRENT_P95=$(jq '.metrics.http_req_duration["p(95)"] // 0' "$CURRENT")
CURRENT_ERR_PCT=$(jq '(.metrics.http_req_failed.value // 0) * 100' "$CURRENT")

BASELINE_P95=$(jq -r --arg svc "$SERVICE" '.services[$svc].p95_ms' "$BASELINE")
BASELINE_ERR_PCT=$(jq -r --arg svc "$SERVICE" '.services[$svc].error_rate_pct' "$BASELINE")
REGRESSION_PCT=$(jq -r '.regression_threshold_pct // 25' "$BASELINE")

echo "Latency (p95):"
echo "  Baseline: ${BASELINE_P95}ms"
echo "  Current:  ${CURRENT_P95}ms"
echo ""
echo "Error rate:"
echo "  Baseline: ${BASELINE_ERR_PCT}%"
echo "  Current:  ${CURRENT_ERR_PCT}%"
echo ""

FAILED=0

# Latency regression: current p95 > baseline p95 * (1 + threshold%)
LATENCY_LIMIT=$(echo "scale=2; $BASELINE_P95 * (1 + $REGRESSION_PCT / 100)" | bc)
if (( $(echo "$CURRENT_P95 > $LATENCY_LIMIT" | bc -l) )); then
  echo "LATENCY REGRESSION: p95 ${CURRENT_P95}ms > baseline+${REGRESSION_PCT}% (${LATENCY_LIMIT}ms)"
  FAILED=1
fi

# Error rate regression: current error rate more than doubled (and is
# non-trivial — a 0.01% -> 0.03% move shouldn't fail a build over noise).
MAX_ERR_PCT=$(echo "scale=4; $BASELINE_ERR_PCT * 2" | bc)
if (( $(echo "$CURRENT_ERR_PCT > $MAX_ERR_PCT" | bc -l) )) && (( $(echo "$CURRENT_ERR_PCT > 0.1" | bc -l) )); then
  echo "ERROR RATE REGRESSION: ${CURRENT_ERR_PCT}% > baseline×2 (${MAX_ERR_PCT}%)"
  FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo "Performance within baseline thresholds"
  exit 0
else
  exit 1
fi
