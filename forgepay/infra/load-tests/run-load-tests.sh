#!/usr/bin/env bash
set -euo pipefail

# ForgePay Load Test Runner
# Usage: ./run-load-tests.sh [checkout|stablecoin|crypto|stress|spike|agent-identity|agent-negotiation|rwa-registry|agents|all] [--base-url URL] [--capture-baseline] [--compare-baseline]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
TEST="${1:-all}"
BASE_URL="${BASE_URL:-}"
CAPTURE_BASELINE=false
COMPARE_BASELINE=false

# Parse flags
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --capture-baseline) CAPTURE_BASELINE=true; shift ;;
    --compare-baseline) COMPARE_BASELINE=true; shift ;;
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
# name -> summary-export path, for any --compare-baseline pass below.
declare -A RUN_SUMMARIES

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

  # NOTE: --out json= writes a raw per-sample NDJSON stream (no top-level
  # `.metrics` object) — useless for the aggregate p95/error-rate numbers
  # --capture-baseline/--compare-baseline need. --summary-export writes
  # the single aggregate JSON object those actually read.
  if k6 run $env_flags \
      --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" \
      --summary-export="$out" \
      "${SCRIPT_DIR}/${script}"; then
    echo "  PASSED: ${name}"
  else
    echo "  FAILED: ${name} (thresholds not met)"
    FAILED=$((FAILED + 1))
  fi
  RUN_SUMMARIES["$name"]="$out"
}

case "$TEST" in
  checkout)
    run_test "checkout" "checkout-load-test.js"
    ;;
  stress)
    run_test "checkout-stress" "checkout-stress-test.js"
    ;;
  spike)
    run_test "checkout-spike" "checkout-spike-test.js"
    ;;
  stablecoin)
    run_test "stablecoin-gateway" "stablecoin-load-test.js"
    ;;
  crypto)
    run_test "crypto-gateway" "crypto-load-test.js"
    ;;
  agent-identity)
    run_test "agent-identity" "agent-identity-load-test.js" "http://localhost:3010"
    ;;
  agent-negotiation)
    run_test "agent-negotiation" "agent-negotiation-load-test.js" "http://localhost:3011"
    ;;
  rwa-registry)
    run_test "rwa-registry" "rwa-registry-load-test.js" "http://localhost:3008"
    ;;
  agents)
    run_test "agent-identity"    "agent-identity-load-test.js"    "http://localhost:3010"
    run_test "agent-negotiation" "agent-negotiation-load-test.js" "http://localhost:3011"
    run_test "rwa-registry"      "rwa-registry-load-test.js"      "http://localhost:3008"
    ;;
  all)
    run_test "checkout"          "checkout-load-test.js"
    run_test "stablecoin-gateway" "stablecoin-load-test.js"
    run_test "crypto-gateway"     "crypto-load-test.js"
    run_test "agent-identity"    "agent-identity-load-test.js"    "http://localhost:3010"
    run_test "agent-negotiation" "agent-negotiation-load-test.js" "http://localhost:3011"
    run_test "rwa-registry"      "rwa-registry-load-test.js"      "http://localhost:3008"
    ;;
  *)
    echo "Usage: $0 [checkout|stablecoin|crypto|stress|spike|agent-identity|agent-negotiation|rwa-registry|agents|all] [--base-url URL] [--capture-baseline] [--compare-baseline]"
    exit 1
    ;;
esac

# Handle baseline operations. Both delegate to the per-service scripts
# rather than duplicating their (now-fixed) parsing logic here.
if [[ "$COMPARE_BASELINE" == true ]]; then
  if [[ ! -f "$SCRIPT_DIR/baseline.json" ]]; then
    echo "No baseline.json found. Run capture-baseline.sh first."
  else
    for name in "${!RUN_SUMMARIES[@]}"; do
      summary="${RUN_SUMMARIES[$name]}"
      echo ""
      if bash "$SCRIPT_DIR/compare-baseline.sh" "$name" "$summary"; then
        echo "Baseline comparison passed: ${name}"
      else
        echo "Baseline comparison failed: ${name}"
        FAILED=$((FAILED + 1))
      fi
    done
  fi
fi

if [[ "$CAPTURE_BASELINE" == true ]]; then
  echo ""
  echo "--capture-baseline runs a dedicated, longer capture across every"
  echo "service rather than reusing this invocation's results (which may"
  echo "only cover a subset of services depending on which TEST arg was"
  echo "passed) — delegating to capture-baseline.sh."
  bash "$SCRIPT_DIR/capture-baseline.sh"
fi

echo ""
if [[ $FAILED -eq 0 ]]; then
  echo "All load tests passed. Results in: ${RESULTS_DIR}/"
  exit 0
else
  echo "${FAILED} test(s) failed. Results in: ${RESULTS_DIR}/"
  exit 1
fi
