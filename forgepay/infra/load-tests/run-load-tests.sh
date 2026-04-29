#!/usr/bin/env bash
set -euo pipefail

# ForgePay Load Test Runner
# Usage: ./run-load-tests.sh [checkout|stablecoin|crypto|all] [--base-url URL]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
TEST="${1:-all}"
BASE_URL="${BASE_URL:-}"

# Parse --base-url flag
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Check k6 installed
if ! command -v k6 &>/dev/null; then
  echo "ERROR: k6 not found. Install from https://k6.io/docs/get-started/installation/"
  exit 1
fi

mkdir -p "$RESULTS_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FAILED=0

run_test() {
  local name="$1"
  local script="$2"
  local base_url_env="${3:-}"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Running: ${name} load test"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local out="${RESULTS_DIR}/${name}_${TIMESTAMP}.json"
  local env_flags=""
  if [[ -n "$base_url_env" ]]; then
    env_flags="-e BASE_URL=${base_url_env}"
  elif [[ -n "$BASE_URL" ]]; then
    env_flags="-e BASE_URL=${BASE_URL}"
  fi

  if k6 run $env_flags --out json="$out" "${SCRIPT_DIR}/${script}"; then
    echo "  ✓ ${name}: PASSED"
  else
    echo "  ✗ ${name}: FAILED (thresholds not met)"
    FAILED=$((FAILED + 1))
  fi
}

case "$TEST" in
  checkout)
    run_test "checkout" "checkout-load-test.js"
    ;;
  stablecoin)
    run_test "stablecoin" "stablecoin-load-test.js"
    ;;
  crypto)
    run_test "crypto" "crypto-load-test.js"
    ;;
  all)
    run_test "checkout"   "checkout-load-test.js"
    run_test "stablecoin" "stablecoin-load-test.js"
    run_test "crypto"     "crypto-load-test.js"
    ;;
  *)
    echo "Usage: $0 [checkout|stablecoin|crypto|all] [--base-url URL]"
    exit 1
    ;;
esac

echo ""
if [[ $FAILED -eq 0 ]]; then
  echo "✓ All load tests passed. Results in: ${RESULTS_DIR}/"
  exit 0
else
  echo "✗ ${FAILED} test(s) failed. Results in: ${RESULTS_DIR}/"
  exit 1
fi
