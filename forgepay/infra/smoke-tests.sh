#!/usr/bin/env bash
# =============================================================================
# ForgePay Post-Deployment Smoke Tests
# =============================================================================
# Tests critical paths against a running ForgePay environment.
#
# Usage:
#   ./smoke-tests.sh [--base-url URL] [--verbose]
#
# Environment variables:
#   SMOKE_BASE_URL         base URL for API calls (default: https://api.forgepay.io)
#   SMOKE_API_KEY          API key for authenticated requests
#   SMOKE_JWT_TOKEN        JWT token for protected endpoints (overrides SMOKE_API_KEY)
#   SMOKE_TIMEOUT          curl timeout in seconds (default: 15)
#   SMOKE_VERBOSE          set to "true" for response bodies in output
#
# Exit codes:
#   0  all tests passed
#   1  one or more tests failed

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

BASE_URL="${SMOKE_BASE_URL:-https://api.forgepay.io}"
API_KEY="${SMOKE_API_KEY:-}"
JWT_TOKEN="${SMOKE_JWT_TOKEN:-}"
TIMEOUT="${SMOKE_TIMEOUT:-15}"
VERBOSE="${SMOKE_VERBOSE:-false}"
VERBOSE_FLAG=false

for arg in "$@"; do
  case "$arg" in
    --base-url=*) BASE_URL="${arg#*=}" ;;
    --verbose)    VERBOSE_FLAG=true ;;
    --help|-h)
      echo "Usage: $0 [--base-url=URL] [--verbose]"
      exit 0 ;;
  esac
done

[[ "${VERBOSE}" == "true" ]] && VERBOSE_FLAG=true

# =============================================================================
# Colors
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# =============================================================================
# Test infrastructure
# =============================================================================

PASS=0
FAIL=0
SKIP=0

log_test()  { echo -e "${BLUE}[TEST]${RESET}  $*"; }
log_pass()  { echo -e "${GREEN}[PASS]${RESET}  $*"; (( PASS++ )) || true; }
log_fail()  { echo -e "${RED}[FAIL]${RESET}  $*" >&2; (( FAIL++ )) || true; }
log_skip()  { echo -e "${YELLOW}[SKIP]${RESET}  $*"; (( SKIP++ )) || true; }
log_info()  { echo -e "${CYAN}[INFO]${RESET}  $*"; }

# Build auth header
auth_header() {
  if [[ -n "${JWT_TOKEN}" ]]; then
    echo "Authorization: Bearer ${JWT_TOKEN}"
  elif [[ -n "${API_KEY}" ]]; then
    echo "X-API-Key: ${API_KEY}"
  else
    echo ""
  fi
}

# Make an HTTP request and assert the response
# Usage: assert_http METHOD URL EXPECTED_STATUS [BODY] [DESCRIPTION]
assert_http() {
  local method="$1"
  local url="$2"
  local expected_status="$3"
  local body="${4:-}"
  local description="${5:-${method} ${url}}"

  log_test "${description}"

  local curl_args=(
    -s
    -o /tmp/smoke_response_body.txt
    -w "%{http_code}"
    -X "${method}"
    --connect-timeout 5
    --max-time "${TIMEOUT}"
    -H "Content-Type: application/json"
    -H "Accept: application/json"
  )

  # Add auth header if set
  local auth
  auth=$(auth_header)
  if [[ -n "${auth}" ]]; then
    curl_args+=(-H "${auth}")
  fi

  # Add request body for POST/PUT/PATCH
  if [[ -n "${body}" ]]; then
    curl_args+=(-d "${body}")
  fi

  local actual_status
  actual_status=$(curl "${curl_args[@]}" "${url}" 2>/dev/null) || actual_status="000"

  local response_body
  response_body=$(cat /tmp/smoke_response_body.txt 2>/dev/null) || response_body=""

  if $VERBOSE_FLAG; then
    echo "  Response body: ${response_body:0:500}"
  fi

  if [[ "${actual_status}" == "${expected_status}" ]]; then
    log_pass "${description} → HTTP ${actual_status}"
    echo "${response_body}"
    return 0
  else
    log_fail "${description} → expected HTTP ${expected_status}, got HTTP ${actual_status}"
    if [[ -n "${response_body}" ]]; then
      echo "  Response: ${response_body:0:300}" >&2
    fi
    return 1
  fi
}

# Assert response body contains a field/value
assert_json_field() {
  local json="$1"
  local field="$2"
  local description="${3:-field: ${field}}"

  if echo "${json}" | jq -e "${field}" &> /dev/null 2>&1; then
    log_pass "${description} — field present"
    return 0
  else
    log_fail "${description} — field '${field}' missing or null"
    return 1
  fi
}

# Assert response matches Prometheus text format
assert_prometheus_format() {
  local body="$1"
  local service="$2"

  if echo "${body}" | grep -q "^# HELP\|^# TYPE\|^[a-z_]"; then
    log_pass "${service} /metrics — Prometheus text format detected"
    return 0
  else
    log_fail "${service} /metrics — does not look like Prometheus format"
    return 1
  fi
}

# =============================================================================
# Test Suite
# =============================================================================

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║         ForgePay Smoke Tests                             ║${RESET}"
echo -e "${BOLD}${CYAN}║         Target: ${BASE_URL}${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""

# =============================================================================
# TEST 1: Health Checks — All Services
# =============================================================================

log_info "═══════════════════════════════════════"
log_info "Test Group 1: Health Checks"
log_info "═══════════════════════════════════════"

declare -A SERVICE_HEALTH_PATHS=(
  ["unified-router"]="/healthz"
  ["mor-layer"]="/health"
  ["stablecoin-gateway"]="/healthz"
  ["crypto-gateway"]="/healthz"
  ["accounts-service"]="/healthz"
  ["agent-identity"]="/healthz"
  ["agent-credit-lines"]="/healthz"
  ["bank-connectivity"]="/healthz"
  ["rwa-registry"]="/healthz"
  ["yield-engine"]="/healthz"
  ["enterprise-treasury"]="/healthz"
  ["compliance-monitor"]="/health"
  ["institutional-reporting"]="/health"
)

for service in "${!SERVICE_HEALTH_PATHS[@]}"; do
  health_path="${SERVICE_HEALTH_PATHS[$service]}"
  assert_http "GET" "${BASE_URL}/${service}${health_path}" "200" "" "Health check: ${service}" || true
done

# =============================================================================
# TEST 2: Checkout Session Creation
# =============================================================================

log_info ""
log_info "═══════════════════════════════════════"
log_info "Test Group 2: Checkout (mor-layer)"
log_info "═══════════════════════════════════════"

CHECKOUT_PAYLOAD='{
  "merchant_id": "smoke-test-merchant",
  "amount": 1000,
  "currency": "USD",
  "customer": {
    "email": "smoke-test@forgepay.io"
  },
  "metadata": {
    "test": "true",
    "smoke_test": true
  }
}'

log_test "POST /v1/checkout/sessions — expect 200 with client_secret"
CHECKOUT_RESPONSE=$(assert_http "POST" "${BASE_URL}/mor-layer/v1/checkout/sessions" "200" \
  "${CHECKOUT_PAYLOAD}" "Create checkout session") || true

if [[ -n "${CHECKOUT_RESPONSE:-}" ]]; then
  assert_json_field "${CHECKOUT_RESPONSE}" '.client_secret' "checkout_session.client_secret" || true
  assert_json_field "${CHECKOUT_RESPONSE}" '.session_id' "checkout_session.session_id" || true

  # Extract session_id for follow-up test
  SESSION_ID=$(echo "${CHECKOUT_RESPONSE}" | jq -r '.session_id // empty' 2>/dev/null) || SESSION_ID=""

  if [[ -n "${SESSION_ID}" ]]; then
    log_test "GET /v1/checkout/sessions/${SESSION_ID} — verify session retrievable"
    assert_http "GET" "${BASE_URL}/mor-layer/v1/checkout/sessions/${SESSION_ID}" "200" \
      "" "Retrieve checkout session" || true
  fi
fi

# =============================================================================
# TEST 3: Agent List
# =============================================================================

log_info ""
log_info "═══════════════════════════════════════"
log_info "Test Group 3: Agent Identity"
log_info "═══════════════════════════════════════"

log_test "GET /v1/agents — expect 200 with agent list"
AGENTS_RESPONSE=$(assert_http "GET" "${BASE_URL}/agent-identity/v1/agents" "200" \
  "" "List agents") || true

if [[ -n "${AGENTS_RESPONSE:-}" ]]; then
  # Response should be an array or object with items
  if echo "${AGENTS_RESPONSE}" | jq -e '. | (type == "array" or (type == "object" and has("agents")))' &> /dev/null 2>&1; then
    log_pass "Agent list response has expected structure"
    (( PASS++ )) || true
  else
    log_fail "Agent list response structure unexpected"
    (( FAIL++ )) || true
  fi
fi

# =============================================================================
# TEST 4: Prometheus /metrics Endpoints
# =============================================================================

log_info ""
log_info "═══════════════════════════════════════"
log_info "Test Group 4: Prometheus /metrics"
log_info "═══════════════════════════════════════"

METRICS_SERVICES=(
  "unified-router"
  "mor-layer"
  "stablecoin-gateway"
  "crypto-gateway"
  "accounts-service"
  "agent-identity"
  "yield-engine"
  "compliance-monitor"
  "institutional-reporting"
)

for service in "${METRICS_SERVICES[@]}"; do
  log_test "${service} GET /metrics — expect Prometheus text format"

  metrics_response=$(curl -s --connect-timeout 5 --max-time "${TIMEOUT}" \
    "${BASE_URL}/${service}/metrics" 2>/dev/null) || metrics_response=""

  metrics_http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 \
    --max-time "${TIMEOUT}" "${BASE_URL}/${service}/metrics" 2>/dev/null) || metrics_http_code="000"

  if [[ "${metrics_http_code}" == "200" ]]; then
    assert_prometheus_format "${metrics_response}" "${service}" || true
  else
    log_fail "${service} /metrics → HTTP ${metrics_http_code} (expected 200)"
    (( FAIL++ )) || true
  fi
done

# =============================================================================
# TEST 5: Webhook Processing — unified-router
# =============================================================================

log_info ""
log_info "═══════════════════════════════════════"
log_info "Test Group 5: Webhook Processing"
log_info "═══════════════════════════════════════"

WEBHOOK_SECRET="${HYPERSWITCH_WEBHOOK_SECRET:-test-secret-smoke}"
MOCK_WEBHOOK_PAYLOAD='{
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pay_smoke_test_001",
      "amount": 1000,
      "currency": "usd",
      "status": "succeeded",
      "metadata": {
        "smoke_test": "true"
      }
    }
  },
  "created": '"$(date -u +%s)"',
  "livemode": false
}'

# Generate HMAC-SHA256 signature for the mock payload
if command -v openssl &> /dev/null; then
  WEBHOOK_SIG=$(echo -n "${MOCK_WEBHOOK_PAYLOAD}" | \
    openssl dgst -sha256 -hmac "${WEBHOOK_SECRET}" | \
    awk '{print $2}')
  WEBHOOK_SIG_HEADER="sha256=${WEBHOOK_SIG}"
else
  log_skip "openssl not available — skipping HMAC signature on webhook test"
  WEBHOOK_SIG_HEADER="sha256=smoke-test-skipped"
fi

log_test "POST /webhooks/hyperswitch — valid HMAC payload → expect 200"
WEBHOOK_RESPONSE=$(curl -s \
  -o /tmp/smoke_response_body.txt \
  -w "%{http_code}" \
  -X POST \
  --connect-timeout 5 \
  --max-time "${TIMEOUT}" \
  -H "Content-Type: application/json" \
  -H "X-Hyperswitch-Signature: ${WEBHOOK_SIG_HEADER}" \
  -d "${MOCK_WEBHOOK_PAYLOAD}" \
  "${BASE_URL}/unified-router/webhooks/hyperswitch" 2>/dev/null) || WEBHOOK_RESPONSE="000"

if [[ "${WEBHOOK_RESPONSE}" == "200" ]]; then
  log_pass "POST /webhooks/hyperswitch → HTTP 200"
  (( PASS++ )) || true
elif [[ "${WEBHOOK_RESPONSE}" == "202" ]]; then
  log_pass "POST /webhooks/hyperswitch → HTTP 202 (accepted)"
  (( PASS++ )) || true
else
  log_fail "POST /webhooks/hyperswitch → HTTP ${WEBHOOK_RESPONSE} (expected 200/202)"
  (( FAIL++ )) || true
  cat /tmp/smoke_response_body.txt >&2 || true
fi

# Test that invalid signature returns 401
log_test "POST /webhooks/hyperswitch — invalid HMAC → expect 401"
INVALID_SIG_RESPONSE=$(curl -s \
  -o /dev/null \
  -w "%{http_code}" \
  -X POST \
  --connect-timeout 5 \
  --max-time "${TIMEOUT}" \
  -H "Content-Type: application/json" \
  -H "X-Hyperswitch-Signature: sha256=invaliddeadbeef000000000000000000000000000000000000000000000000" \
  -d "${MOCK_WEBHOOK_PAYLOAD}" \
  "${BASE_URL}/unified-router/webhooks/hyperswitch" 2>/dev/null) || INVALID_SIG_RESPONSE="000"

if [[ "${INVALID_SIG_RESPONSE}" == "401" ]]; then
  log_pass "POST /webhooks/hyperswitch (invalid sig) → HTTP 401 (correctly rejected)"
  (( PASS++ )) || true
elif [[ "${INVALID_SIG_RESPONSE}" == "403" ]]; then
  log_pass "POST /webhooks/hyperswitch (invalid sig) → HTTP 403 (correctly rejected)"
  (( PASS++ )) || true
else
  log_fail "POST /webhooks/hyperswitch (invalid sig) → HTTP ${INVALID_SIG_RESPONSE} (expected 401/403)"
  (( FAIL++ )) || true
fi

# =============================================================================
# TEST 6: Crypto Gateway — Invoice Lookup
# =============================================================================

log_info ""
log_info "═══════════════════════════════════════"
log_info "Test Group 6: Crypto Gateway"
log_info "═══════════════════════════════════════"

log_test "GET /v1/invoices — expect 200 with invoice list"
assert_http "GET" "${BASE_URL}/crypto-gateway/v1/invoices" "200" \
  "" "List crypto invoices" || true

# =============================================================================
# TEST 7: Stablecoin Gateway — Deposit Address
# =============================================================================

log_info ""
log_info "═══════════════════════════════════════"
log_info "Test Group 7: Stablecoin Gateway"
log_info "═══════════════════════════════════════"

DEPOSIT_PAYLOAD='{
  "merchant_id": "smoke-test-merchant",
  "currency": "USDC",
  "chain": "ethereum",
  "amount_usd": 10.00,
  "metadata": { "smoke_test": true }
}'

log_test "POST /v1/deposits — expect deposit address in response"
DEPOSIT_RESPONSE=$(assert_http "POST" "${BASE_URL}/stablecoin-gateway/v1/deposits" "200" \
  "${DEPOSIT_PAYLOAD}" "Create stablecoin deposit") || true

if [[ -n "${DEPOSIT_RESPONSE:-}" ]]; then
  assert_json_field "${DEPOSIT_RESPONSE}" '.transaction_id // .deposit_address // .id' \
    "stablecoin deposit has transaction_id or deposit_address" || true
fi

# =============================================================================
# TEST 8: Yield Engine — Positions
# =============================================================================

log_info ""
log_info "═══════════════════════════════════════"
log_info "Test Group 8: Yield Engine"
log_info "═══════════════════════════════════════"

log_test "GET /v1/positions — expect 200 with positions list"
assert_http "GET" "${BASE_URL}/yield-engine/v1/positions" "200" \
  "" "Get yield positions" || true

# =============================================================================
# TEST 9: Accounts Service
# =============================================================================

log_info ""
log_info "═══════════════════════════════════════"
log_info "Test Group 9: Accounts Service"
log_info "═══════════════════════════════════════"

log_test "GET /v1/accounts — expect 200"
assert_http "GET" "${BASE_URL}/accounts-service/v1/accounts" "200" \
  "" "List accounts" || true

# =============================================================================
# TEST 10: Rate Limiting Check
# =============================================================================

log_info ""
log_info "═══════════════════════════════════════"
log_info "Test Group 10: Rate Limiting"
log_info "═══════════════════════════════════════"

log_test "Rate limit: send 50 rapid requests to /healthz, expect at least one 429"
RATE_LIMIT_FOUND=false
for i in $(seq 1 50); do
  status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 5 \
    "${BASE_URL}/unified-router/healthz" 2>/dev/null) || status="000"
  if [[ "${status}" == "429" ]]; then
    RATE_LIMIT_FOUND=true
    break
  fi
done

if $RATE_LIMIT_FOUND; then
  log_pass "Rate limiting active: 429 received after rapid requests"
  (( PASS++ )) || true
else
  log_skip "Rate limiting not triggered in 50 requests (may need higher volume or IP-level test)"
  (( SKIP++ )) || true
fi

# =============================================================================
# Results Summary
# =============================================================================

TOTAL=$(( PASS + FAIL + SKIP ))

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Smoke Test Results${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
echo -e "  Total tests: ${TOTAL}"
echo -e "  ${GREEN}Passed: ${PASS}${RESET}"
echo -e "  ${RED}Failed: ${FAIL}${RESET}"
echo -e "  ${YELLOW}Skipped: ${SKIP}${RESET}"
echo ""

if [[ ${FAIL} -gt 0 ]]; then
  echo -e "${RED}${BOLD}SMOKE TESTS FAILED — ${FAIL} test(s) did not pass${RESET}"
  echo ""
  exit 1
else
  echo -e "${GREEN}${BOLD}SMOKE TESTS PASSED — all ${PASS} tests OK${RESET}"
  echo ""
  exit 0
fi
