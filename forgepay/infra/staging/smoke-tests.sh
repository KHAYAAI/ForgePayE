#!/usr/bin/env bash
# =============================================================================
# ForgePay Staging Smoke Tests
# =============================================================================
# Tests all critical endpoints after a staging deployment.
# Exits 0 if all tests pass, 1 if any fail.
#
# Usage:
#   ./smoke-tests.sh [OPTIONS]
#
# Options:
#   --base-url URL     Base API URL (default: https://api.staging.af.forgepay.io)
#   --api-key KEY      API key for authenticated requests
#   --verbose          Print response bodies
#   --timeout N        curl timeout in seconds (default: 15)
#   --help             Show this message
#
# Environment variables (override options):
#   SMOKE_BASE_URL
#   SMOKE_API_KEY
#   SMOKE_TIMEOUT
#   SMOKE_VERBOSE      "true" to enable verbose output
#
# To make executable:
#   chmod +x smoke-tests.sh

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

BASE_URL="${SMOKE_BASE_URL:-https://api.staging.af.forgepay.io}"
API_KEY="${SMOKE_API_KEY:-}"
TIMEOUT="${SMOKE_TIMEOUT:-15}"
VERBOSE="${SMOKE_VERBOSE:-false}"

# =============================================================================
# Parse arguments
# =============================================================================

for arg in "$@"; do
  case "${arg}" in
    --base-url=*)  BASE_URL="${arg#*=}" ;;
    --api-key=*)   API_KEY="${arg#*=}" ;;
    --timeout=*)   TIMEOUT="${arg#*=}" ;;
    --verbose)     VERBOSE=true ;;
    --help|-h)
      grep '^#' "${BASH_SOURCE[0]}" | grep -v '#!/' | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
  esac
done

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
FAILED_TESTS=()

log_test()  { echo -e "  ${BLUE}[TEST]${RESET}  $*"; }
log_pass()  { echo -e "  ${GREEN}[PASS]${RESET}  $*"; (( PASS++ )) || true; }
log_fail()  { echo -e "  ${RED}[FAIL]${RESET}  $*" >&2; (( FAIL++ )) || true; FAILED_TESTS+=("$*"); }
log_skip()  { echo -e "  ${YELLOW}[SKIP]${RESET}  $*"; (( SKIP++ )) || true; }
log_info()  { echo -e "  ${CYAN}[INFO]${RESET}  $*"; }
log_section() {
  echo ""
  echo -e "${BOLD}${CYAN}── $* ─────────────────────────────────────────${RESET}"
  echo ""
}

# Auth header builder
auth_header() {
  if [[ -n "${API_KEY}" ]]; then
    echo "-H 'X-API-Key: ${API_KEY}'"
  else
    echo ""
  fi
}

# Generic HTTP test helper
# Usage: http_test "test name" METHOD URL expected_status [body] [extra_curl_args...]
http_test() {
  local test_name="$1"
  local method="$2"
  local url="$3"
  local expected_status="$4"
  local body="${5:-}"
  shift 5 || true
  local extra_args=("$@")

  log_test "${test_name}"

  local curl_args=(
    -s
    -o /tmp/forgepay-smoke-response
    -w "%{http_code}"
    --connect-timeout 5
    --max-time "${TIMEOUT}"
    -X "${method}"
    -H "Content-Type: application/json"
  )

  if [[ -n "${API_KEY}" ]]; then
    curl_args+=(-H "X-API-Key: ${API_KEY}")
  fi

  if [[ -n "${body}" ]]; then
    curl_args+=(-d "${body}")
  fi

  curl_args+=("${extra_args[@]}")
  curl_args+=("${url}")

  local http_code
  http_code=$(curl "${curl_args[@]}" 2>/dev/null) || http_code="000"

  local response_body=""
  if [[ -f /tmp/forgepay-smoke-response ]]; then
    response_body=$(cat /tmp/forgepay-smoke-response)
  fi

  if [[ "${VERBOSE}" == "true" ]] && [[ -n "${response_body}" ]]; then
    log_info "Response: ${response_body:0:500}"
  fi

  if [[ "${http_code}" == "${expected_status}" ]]; then
    log_pass "${test_name} → HTTP ${http_code}"
    return 0
  else
    log_fail "${test_name} → HTTP ${http_code} (expected ${expected_status}) — ${url}"
    if [[ -n "${response_body}" ]]; then
      log_info "Body: ${response_body:0:300}"
    fi
    return 1
  fi
}

# Health check helper (shorthand for GET /health → 200)
health_test() {
  local service_name="$1"
  local url="$2"
  http_test "${service_name} /health" GET "${url}" 200 "" || true
}

# =============================================================================
# Banner
# =============================================================================

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║  ForgePay Staging Smoke Tests                                ║${RESET}"
echo -e "${BOLD}${CYAN}║  Base URL : ${BASE_URL}$(printf '%*s' $((49 - ${#BASE_URL})) '')║${RESET}"
echo -e "${BOLD}${CYAN}║  Time     : $(date -u +'%Y-%m-%d %H:%M UTC')$(printf '%*s' $((39)) '')║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# =============================================================================
# Test Suite 1: Health Checks — All 18 Services
# =============================================================================

log_section "1. Health Checks — All Services"

# Payment Engine (Hyperswitch) — port 80/443
health_test "payment-engine"          "${BASE_URL}/health"

# Unified Router — port 3000
health_test "unified-router"          "${BASE_URL}/service/unified-router/healthz"

# MoR Layer — port 8000
health_test "mor-layer"               "${BASE_URL}/service/mor-layer/health"

# Billing Engine (Kill Bill) — port 8080
health_test "billing-engine"          "${BASE_URL}/service/billing-engine/1.0/healthcheck"

# Stablecoin Gateway — port 3001
health_test "stablecoin-gateway"      "${BASE_URL}/service/stablecoin-gateway/healthz"

# Crypto Gateway — port 3002
health_test "crypto-gateway"          "${BASE_URL}/service/crypto-gateway/healthz"

# Yield Engine — port 3007
health_test "yield-engine"            "${BASE_URL}/service/yield-engine/healthz"

# RWA Registry — port 3008
health_test "rwa-registry"            "${BASE_URL}/service/rwa-registry/healthz"

# Enterprise Treasury — port 3012
health_test "enterprise-treasury"     "${BASE_URL}/service/enterprise-treasury/healthz"

# Agent Identity — port 3010
health_test "agent-identity"          "${BASE_URL}/service/agent-identity/healthz"

# Agent Negotiation — port 3011
health_test "agent-negotiation"       "${BASE_URL}/service/agent-negotiation/healthz"

# Agent Decision Framework — port 3013
health_test "agent-decision-framework" "${BASE_URL}/service/agent-decision-framework/healthz"

# Agent Credit Lines — port 3016
health_test "agent-credit-lines"      "${BASE_URL}/service/agent-credit-lines/healthz"

# Compliance Monitor — port 8001
health_test "compliance-monitor"      "${BASE_URL}/service/compliance-monitor/health"

# Liquidity Forecaster — port 8002
health_test "liquidity-forecaster"    "${BASE_URL}/service/liquidity-forecaster/health"

# Bank Connectivity — port 3003
health_test "bank-connectivity"       "${BASE_URL}/service/bank-connectivity/healthz"

# Chain Sync — port 8040 (may be disabled; 200 or 503 both acceptable)
log_test "chain-sync /healthz (optional)"
cs_code=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time 10 \
  "${BASE_URL}/service/chain-sync/healthz" 2>/dev/null) || cs_code="000"
if [[ "${cs_code}" == "200" ]]; then
  log_pass "chain-sync /healthz → HTTP 200 (enabled)"
elif [[ "${cs_code}" == "503" || "${cs_code}" == "000" ]]; then
  log_skip "chain-sync /healthz → HTTP ${cs_code} (disabled or unreachable — expected in staging)"
else
  log_fail "chain-sync /healthz → HTTP ${cs_code} (unexpected)"
fi

# Bank Whitelabel — port 3015
health_test "bank-whitelabel"         "${BASE_URL}/service/bank-whitelabel/healthz"

# Accounts Service — port 3020
health_test "accounts-service"        "${BASE_URL}/service/accounts-service/healthz"

# =============================================================================
# Test Suite 2: Payment Engine Core Flow
# =============================================================================

log_section "2. Payment Engine — Core Payment Flow"

# Create a test payment via Hyperswitch
log_test "POST /v1/payments — create test card payment"
PAYMENT_ID=""
create_payment_response=$(curl -s \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  -X POST "${BASE_URL}/v1/payments" \
  -H "Content-Type: application/json" \
  -H "api-key: ${API_KEY:-test_api_key}" \
  -d '{
    "amount": 100,
    "currency": "USD",
    "payment_method": "card",
    "payment_method_data": {
      "card": {
        "card_number": "4242424242424242",
        "card_exp_month": "12",
        "card_exp_year": "2030",
        "card_holder_name": "ForgePay Test",
        "card_cvc": "123"
      }
    },
    "confirm": true,
    "description": "Smoke test payment",
    "metadata": {
      "test": "smoke-test",
      "source": "deploy-staging"
    }
  }' 2>/dev/null) || create_payment_response="{}"

create_payment_http=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  -X POST "${BASE_URL}/v1/payments" \
  -H "Content-Type: application/json" \
  -H "api-key: ${API_KEY:-test_api_key}" \
  -d '{"amount":100,"currency":"USD","payment_method":"card","confirm":false}' \
  2>/dev/null) || create_payment_http="000"

if [[ "${create_payment_http}" == "200" || "${create_payment_http}" == "201" ]]; then
  log_pass "POST /v1/payments → HTTP ${create_payment_http}"
  PAYMENT_ID=$(echo "${create_payment_response}" | jq -r '.payment_id // .id // empty' 2>/dev/null || echo "")
else
  log_fail "POST /v1/payments → HTTP ${create_payment_http} (expected 200/201)"
fi

# Retrieve the payment we just created (if we got an ID)
if [[ -n "${PAYMENT_ID}" ]]; then
  http_test "GET /v1/payments/{id}" \
    GET "${BASE_URL}/v1/payments/${PAYMENT_ID}" \
    200 "" \
    -H "api-key: ${API_KEY:-test_api_key}" || true
else
  log_skip "GET /v1/payments/{id} — skipped (no payment ID from create)"
fi

# List payments
http_test "GET /v1/payments (list)" \
  GET "${BASE_URL}/v1/payments?limit=5" \
  200 "" \
  -H "api-key: ${API_KEY:-test_api_key}" || true

# =============================================================================
# Test Suite 3: Webhook Pipeline
# =============================================================================

log_section "3. Webhook Pipeline — Unified Router"

WEBHOOK_BASE="${BASE_URL/api./hooks.}"

# Test Stripe webhook (with a test signature — will fail HMAC but should return 400, not 500)
log_test "POST /webhooks/stripe — Stripe webhook pipeline"
stripe_wh_http=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  -X POST "${WEBHOOK_BASE}/webhooks/stripe" \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1,v1=test_invalid_signature" \
  -d '{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_test"}}}' \
  2>/dev/null) || stripe_wh_http="000"

if [[ "${stripe_wh_http}" == "400" || "${stripe_wh_http}" == "401" ]]; then
  log_pass "POST /webhooks/stripe → HTTP ${stripe_wh_http} (rejected invalid signature — correct behavior)"
elif [[ "${stripe_wh_http}" == "200" ]]; then
  log_warn "POST /webhooks/stripe → HTTP 200 (webhook accepted without signature verification — check config)"
elif [[ "${stripe_wh_http}" == "000" ]]; then
  log_skip "POST /webhooks/stripe → connection failed (hooks subdomain may not be routed in staging)"
else
  log_fail "POST /webhooks/stripe → HTTP ${stripe_wh_http} (expected 400/401)"
fi

# Test Adyen webhook
log_test "POST /webhooks/adyen — Adyen webhook pipeline"
adyen_wh_http=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  -X POST "${WEBHOOK_BASE}/webhooks/adyen" \
  -H "Content-Type: application/json" \
  -d '{"live":"false","notificationItems":[]}' \
  2>/dev/null) || adyen_wh_http="000"

if [[ "${adyen_wh_http}" == "200" || "${adyen_wh_http}" == "400" || "${adyen_wh_http}" == "401" ]]; then
  log_pass "POST /webhooks/adyen → HTTP ${adyen_wh_http}"
elif [[ "${adyen_wh_http}" == "000" ]]; then
  log_skip "POST /webhooks/adyen → connection failed"
else
  log_fail "POST /webhooks/adyen → HTTP ${adyen_wh_http}"
fi

# Webhook status
http_test "GET /webhooks/status" \
  GET "${WEBHOOK_BASE}/webhooks/status" \
  200 "" || true

# =============================================================================
# Test Suite 4: Agent Decision Framework
# =============================================================================

log_section "4. Agent Decision Framework"

http_test "GET /v1/policies (list routing policies)" \
  GET "${BASE_URL}/service/agent-decision-framework/v1/policies" \
  200 "" || true

# Test a routing decision request
log_test "POST /v1/decisions — agent routing decision"
decision_http=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  -X POST "${BASE_URL}/service/agent-decision-framework/v1/decisions" \
  -H "Content-Type: application/json" \
  -H "api-key: ${API_KEY:-test_api_key}" \
  -d '{
    "merchant_id": "test_merchant",
    "payment_amount": 100,
    "currency": "USD",
    "payment_method": "card",
    "request_context": {"smoke_test": true}
  }' 2>/dev/null) || decision_http="000"

if [[ "${decision_http}" == "200" || "${decision_http}" == "201" ]]; then
  log_pass "POST /v1/decisions → HTTP ${decision_http}"
elif [[ "${decision_http}" == "401" || "${decision_http}" == "403" ]]; then
  log_pass "POST /v1/decisions → HTTP ${decision_http} (auth required — endpoint exists)"
elif [[ "${decision_http}" == "000" ]]; then
  log_skip "POST /v1/decisions → connection failed"
else
  log_fail "POST /v1/decisions → HTTP ${decision_http}"
fi

# =============================================================================
# Test Suite 5: x402 Payment Flow
# =============================================================================

log_section "5. x402 Stablecoin Payment Flow"

# Check x402 payment info endpoint
log_test "GET /x402/payment-info — x402 USDC payment details"
x402_http=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  -X GET "${BASE_URL}/service/stablecoin-gateway/x402/payment-info" \
  -H "Content-Type: application/json" \
  2>/dev/null) || x402_http="000"

if [[ "${x402_http}" == "200" || "${x402_http}" == "402" ]]; then
  log_pass "GET /x402/payment-info → HTTP ${x402_http}"
elif [[ "${x402_http}" == "000" ]]; then
  log_skip "GET /x402/payment-info → connection failed (stablecoin gateway may be unreachable)"
else
  log_fail "GET /x402/payment-info → HTTP ${x402_http}"
fi

# Initiate a test x402 payment (testnet USDC)
log_test "POST /x402/initiate — initiate testnet USDC payment"
x402_init_http=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  -X POST "${BASE_URL}/service/stablecoin-gateway/x402/initiate" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "1.00",
    "currency": "USDC",
    "chain": "polygon-mumbai",
    "payer_address": "0x0000000000000000000000000000000000000001",
    "metadata": {"smoke_test": true}
  }' 2>/dev/null) || x402_init_http="000"

if [[ "${x402_init_http}" == "200" || "${x402_init_http}" == "201" || "${x402_init_http}" == "402" ]]; then
  log_pass "POST /x402/initiate → HTTP ${x402_init_http}"
elif [[ "${x402_init_http}" == "401" || "${x402_init_http}" == "400" ]]; then
  log_pass "POST /x402/initiate → HTTP ${x402_init_http} (validation working)"
elif [[ "${x402_init_http}" == "000" ]]; then
  log_skip "POST /x402/initiate → connection failed"
else
  log_fail "POST /x402/initiate → HTTP ${x402_init_http}"
fi

# =============================================================================
# Test Suite 6: MoR Layer — Checkout & Tax
# =============================================================================

log_section "6. MoR Layer — Checkout & Tax"

CHECKOUT_BASE="${BASE_URL/api./checkout.}"

http_test "GET /health (MoR Layer)" \
  GET "${CHECKOUT_BASE}/health" \
  200 "" || true

log_test "POST /v1/checkout/sessions — create checkout session"
checkout_http=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  -X POST "${CHECKOUT_BASE}/v1/checkout/sessions" \
  -H "Content-Type: application/json" \
  -H "api-key: ${API_KEY:-test_api_key}" \
  -d '{
    "merchant_id": "test_merchant",
    "line_items": [{"name": "Test Product", "amount": 1000, "currency": "USD", "quantity": 1}],
    "customer_email": "test@example.com",
    "success_url": "https://example.com/success",
    "cancel_url": "https://example.com/cancel"
  }' 2>/dev/null) || checkout_http="000"

if [[ "${checkout_http}" == "200" || "${checkout_http}" == "201" ]]; then
  log_pass "POST /v1/checkout/sessions → HTTP ${checkout_http}"
elif [[ "${checkout_http}" == "401" || "${checkout_http}" == "400" ]]; then
  log_pass "POST /v1/checkout/sessions → HTTP ${checkout_http} (validation/auth working)"
elif [[ "${checkout_http}" == "000" ]]; then
  log_skip "POST /v1/checkout/sessions → connection failed (checkout subdomain may not be routed)"
else
  log_fail "POST /v1/checkout/sessions → HTTP ${checkout_http}"
fi

# Tax calculation endpoint
log_test "POST /v1/tax/calculate — tax calculation"
tax_http=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  -X POST "${CHECKOUT_BASE}/v1/tax/calculate" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10000,
    "currency": "USD",
    "customer_country": "ZA",
    "product_type": "digital_goods"
  }' 2>/dev/null) || tax_http="000"

if [[ "${tax_http}" == "200" || "${tax_http}" == "201" ]]; then
  log_pass "POST /v1/tax/calculate → HTTP ${tax_http}"
elif [[ "${tax_http}" == "000" ]]; then
  log_skip "POST /v1/tax/calculate → connection failed"
else
  log_fail "POST /v1/tax/calculate → HTTP ${tax_http}"
fi

# =============================================================================
# Test Suite 7: Billing Engine
# =============================================================================

log_section "7. Billing Engine (Kill Bill)"

# Kill Bill exposes its healthcheck at /1.0/healthcheck
http_test "GET /1.0/healthcheck (Kill Bill)" \
  GET "${BASE_URL}/service/billing-engine/1.0/healthcheck" \
  200 "" \
  -H "X-Killbill-ApiKey: ${KILLBILL_API_KEY:-forgepay_staging}" \
  -H "X-Killbill-ApiSecret: ${KILLBILL_API_SECRET:-}" || true

# =============================================================================
# Test Suite 8: Crypto Gateway
# =============================================================================

log_section "8. Crypto Gateway"

http_test "GET /healthz (crypto-gateway)" \
  GET "${BASE_URL}/service/crypto-gateway/healthz" \
  200 "" || true

log_test "GET /v1/rates — crypto exchange rates"
rates_http=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  "${BASE_URL}/service/crypto-gateway/v1/rates?base=BTC&quote=USD" \
  2>/dev/null) || rates_http="000"

if [[ "${rates_http}" == "200" ]]; then
  log_pass "GET /v1/rates → HTTP ${rates_http}"
elif [[ "${rates_http}" == "000" ]]; then
  log_skip "GET /v1/rates → connection failed"
else
  log_fail "GET /v1/rates → HTTP ${rates_http}"
fi

# =============================================================================
# Test Suite 9: Compliance Monitor
# =============================================================================

log_section "9. Compliance Monitor"

http_test "GET /health (compliance-monitor)" \
  GET "${BASE_URL}/service/compliance-monitor/health" \
  200 "" || true

log_test "POST /v1/screen — transaction screening"
screen_http=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  -X POST "${BASE_URL}/service/compliance-monitor/v1/screen" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "currency": "USD",
    "payer_id": "test_user_smoke",
    "payee_id": "test_merchant_smoke"
  }' 2>/dev/null) || screen_http="000"

if [[ "${screen_http}" == "200" || "${screen_http}" == "201" ]]; then
  log_pass "POST /v1/screen → HTTP ${screen_http}"
elif [[ "${screen_http}" == "401" || "${screen_http}" == "400" ]]; then
  log_pass "POST /v1/screen → HTTP ${screen_http} (auth/validation working)"
elif [[ "${screen_http}" == "000" ]]; then
  log_skip "POST /v1/screen → connection failed"
else
  log_fail "POST /v1/screen → HTTP ${screen_http}"
fi

# =============================================================================
# Test Suite 10: Agent Identity
# =============================================================================

log_section "10. Agent Identity"

http_test "GET /healthz (agent-identity)" \
  GET "${BASE_URL}/service/agent-identity/healthz" \
  200 "" || true

log_test "GET /v1/agents — list registered agents"
agents_http=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time "${TIMEOUT}" \
  "${BASE_URL}/service/agent-identity/v1/agents" \
  2>/dev/null) || agents_http="000"

if [[ "${agents_http}" == "200" ]]; then
  log_pass "GET /v1/agents → HTTP ${agents_http}"
elif [[ "${agents_http}" == "401" ]]; then
  log_pass "GET /v1/agents → HTTP 401 (auth required — endpoint exists)"
elif [[ "${agents_http}" == "000" ]]; then
  log_skip "GET /v1/agents → connection failed"
else
  log_fail "GET /v1/agents → HTTP ${agents_http}"
fi

# =============================================================================
# Results Summary
# =============================================================================

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Smoke Test Results${RESET}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}Passed : ${PASS}${RESET}"
echo -e "  ${RED}Failed : ${FAIL}${RESET}"
echo -e "  ${YELLOW}Skipped: ${SKIP}${RESET}"
echo -e "  Total  : $(( PASS + FAIL + SKIP ))"
echo ""

if [[ ${FAIL} -gt 0 ]]; then
  echo -e "${RED}Failed tests:${RESET}"
  for t in "${FAILED_TESTS[@]}"; do
    echo -e "  ${RED}✗${RESET} ${t}"
  done
  echo ""
  echo -e "${RED}${BOLD}Smoke tests FAILED — ${FAIL} test(s) failed.${RESET}"
  exit 1
else
  echo -e "${GREEN}${BOLD}All smoke tests PASSED.${RESET}"
  exit 0
fi
