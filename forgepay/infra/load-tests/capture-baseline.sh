#!/bin/bash
# Capture a new performance baseline from the checkout load test
# Usage: ./capture-baseline.sh [--base-url URL]
# Example: ./capture-baseline.sh --base-url https://api.staging.forgepay.io

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8010}"
API_KEY="${API_KEY:-sk_test_dev}"
RESULTS_DIR="$(dirname "$0")/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$RESULTS_DIR"

echo "🚀 Running load test to capture baseline..."
echo "   Base URL: $BASE_URL"
echo "   Results dir: $RESULTS_DIR"

# Run k6 checkout load test and save results
BASE_URL="$BASE_URL" API_KEY="$API_KEY" k6 run \
  --out json="$RESULTS_DIR/load-test-${TIMESTAMP}.json" \
  "$(dirname "$0")/checkout-load-test.js"

# Copy latest run as new baseline
LATEST=$(ls -t "$RESULTS_DIR"/load-test-*.json | head -1)
cp "$LATEST" "$RESULTS_DIR/baseline.json"

echo "✅ Baseline captured: $RESULTS_DIR/baseline.json"
echo "   From run: $LATEST"

# Print summary
echo ""
echo "Performance metrics:"
jq '.metrics | {
  "http_req_duration": .http_req_duration.values["p(95)"],
  "http_req_failed": .http_req_failed.values.rate,
  "iterations": .iterations.values.count
}' "$RESULTS_DIR/baseline.json" 2>/dev/null || echo "(could not parse metrics)"
