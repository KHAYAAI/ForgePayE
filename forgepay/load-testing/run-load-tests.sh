#!/bin/bash

# ForgePay Load Testing Wrapper Script
# Usage: ./run-load-tests.sh [options]
#
# Options:
#   --help              Show this message
#   --duration <time>   Test duration (default: 5m)
#   --vus <number>      Virtual users (default: 100)
#   --service <name>    Run specific service only
#   --baseline          Compare against baseline
#   --capture-baseline  Save current results as baseline
#   --stress            Run stress test (ramp up to 500 VUs)
#   --spike             Run spike test (sudden 10x load)
#   --soak              Run 1-hour soak test

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Defaults
DURATION="5m"
VUS="100"
SERVICE=""
BASELINE=false
CAPTURE_BASELINE=false
STRESS=false
SPIKE=false
SOAK=false
K6_SCRIPT="load-test.js"
RESULTS_DIR="$(pwd)/results"
BASELINE_FILE="baseline.json"
TIMESTAMP=$(date +%s)
RESULTS_FILE="results-${TIMESTAMP}.json"

# Print colored output
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help)
            cat << EOF
ForgePay Load Testing Script

Usage: ./run-load-tests.sh [options]

Options:
  --help              Show this message
  --duration <time>   Test duration (default: 5m, e.g., 10m, 1h)
  --vus <number>      Virtual users (default: 100)
  --service <name>    Run specific service only
  --baseline          Compare current results against baseline
  --capture-baseline  Save current results as baseline
  --stress            Run stress test (ramp up to 500 VUs)
  --spike             Run spike test (sudden 10x load)
  --soak              Run 1-hour soak test

Examples:
  ./run-load-tests.sh                      # Run default 5m test with 100 VUs
  ./run-load-tests.sh --duration 10m       # Run 10-minute test
  ./run-load-tests.sh --service unified-router --duration 1m
  ./run-load-tests.sh --stress             # Stress test with ramping load
  ./run-load-tests.sh --baseline           # Compare against previous baseline

EOF
            exit 0
            ;;
        --duration)
            DURATION="$2"
            shift 2
            ;;
        --vus)
            VUS="$2"
            shift 2
            ;;
        --service)
            SERVICE="$2"
            shift 2
            ;;
        --baseline)
            BASELINE=true
            shift
            ;;
        --capture-baseline)
            CAPTURE_BASELINE=true
            shift
            ;;
        --stress)
            STRESS=true
            shift
            ;;
        --spike)
            SPIKE=true
            shift
            ;;
        --soak)
            SOAK=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Create results directory
mkdir -p "${RESULTS_DIR}"

log_info "ForgePay Load Testing Suite"
log_info "============================\n"

# Check for k6
if ! command -v k6 &> /dev/null; then
    log_warning "k6 not found locally. Using Docker image..."
    K6_CMD="docker run --rm -v $(pwd):/scripts grafana/k6:latest"
else
    K6_CMD="k6"
fi

# Build k6 command
log_info "Building load test command..."

K6_ARGS="--out json=${RESULTS_DIR}/${RESULTS_FILE}"

if [ "$STRESS" = true ]; then
    log_info "Running STRESS TEST (ramp to 500 VUs)..."
    K6_ARGS="${K6_ARGS} --stage 1m:50 --stage 1m:100 --stage 1m:200 --stage 1m:300 --stage 1m:500 --stage 1m:0"
elif [ "$SPIKE" = true ]; then
    log_info "Running SPIKE TEST (sudden 10x load)..."
    K6_ARGS="${K6_ARGS} --stage 2m:50 --stage 30s:500 --stage 2m:50"
elif [ "$SOAK" = true ]; then
    log_info "Running SOAK TEST (1 hour at constant load)..."
    K6_ARGS="${K6_ARGS} --stage 5m:100 --stage 1h:100 --stage 5m:0"
else
    log_info "Running standard load test (${DURATION} at ${VUS} VUs)..."
    K6_ARGS="${K6_ARGS} --vus ${VUS} --duration ${DURATION}"
fi

# Run k6 test
log_info "Executing load test...\n"
${K6_CMD} run ${K6_ARGS} "${K6_SCRIPT}"

TEST_EXIT_CODE=$?

# Parse results
if [ -f "${RESULTS_DIR}/${RESULTS_FILE}" ]; then
    log_success "Test results saved to: ${RESULTS_DIR}/${RESULTS_FILE}"

    # Extract summary metrics
    log_info "\nTest Summary:"
    log_info "=============="

    if command -v jq &> /dev/null; then
        # Pretty print JSON results if jq is available
        jq '.metrics' "${RESULTS_DIR}/${RESULTS_FILE}" 2>/dev/null || true
    fi

    # Capture baseline if requested
    if [ "$CAPTURE_BASELINE" = true ]; then
        cp "${RESULTS_DIR}/${RESULTS_FILE}" "${BASELINE_FILE}"
        log_success "Baseline captured: ${BASELINE_FILE}"
    fi

    # Compare against baseline if requested
    if [ "$BASELINE" = true ] && [ -f "${BASELINE_FILE}" ]; then
        log_info "\nBaseline Comparison:"
        log_info "===================="
        log_warning "Comparing against baseline (manual review required)"
        log_info "Baseline: ${BASELINE_FILE}"
        log_info "Current:  ${RESULTS_DIR}/${RESULTS_FILE}"

        # If jq is available, show delta
        if command -v jq &> /dev/null; then
            echo ""
            echo "Baseline metrics:"
            jq '.metrics' "${BASELINE_FILE}" 2>/dev/null | head -20 || true
            echo ""
            echo "Current metrics:"
            jq '.metrics' "${RESULTS_DIR}/${RESULTS_FILE}" 2>/dev/null | head -20 || true
        fi
    fi
else
    log_error "Test results file not found!"
    exit 1
fi

# Check exit code
if [ $TEST_EXIT_CODE -eq 0 ]; then
    log_success "\nLoad test PASSED (all thresholds met)"
    exit 0
else
    log_error "\nLoad test FAILED (some thresholds exceeded)"
    log_warning "Review the output above for details"
    exit 1
fi
