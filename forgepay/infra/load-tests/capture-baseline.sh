#!/bin/bash
# Capture a new performance baseline by running each service's load test
# and assembling per-service p50/p95/p99/error-rate/VU results into
# baseline.json, in the same schema compare-baseline.sh reads.
#
# Usage:
#   ./capture-baseline.sh [--vus N] [--duration Ns]
#   BASE_URL_UNIFIED_ROUTER=https://... ./capture-baseline.sh
#
# Defaults to a short (30s) capture per service against localhost — pass
# --duration/--vus (or set DURATION/VUS) for a real staging capture, and
# override each service's URL individually with BASE_URL_<SERVICE> env
# vars (localhost defaults match each script's own dev-mode default port).
#
# NOTE ON k6 OUTPUT FORMAT: `k6 run --out json=file` writes a raw
# per-sample NDJSON stream (one {"type":"Metric"|"Point",...} object per
# line) — there is no top-level `.metrics.*` aggregate object in that
# format, so piping it through `jq '.metrics...'` silently returns null
# for everything. The aggregate summary this script (and
# compare-baseline.sh) actually need comes from `--summary-export`
# instead, which produces a single JSON object shaped like
# `.metrics.<name>.<stat>`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
VUS="${VUS:-5}"
DURATION="${DURATION:-30s}"

mkdir -p "$RESULTS_DIR"

# service_name -> (load-test script, default localhost URL)
# "unified-router" has no dedicated load-test script of its own — the
# closest real measurement is the checkout flow, which is what actually
# gets exercised and (via unified-router) fanned out from. Labeling this
# entry "checkout" rather than "unified-router" so the baseline doesn't
# claim to measure a service it never actually calls directly.
declare -A SERVICES=(
  [checkout]="checkout-load-test.js|http://localhost:8010"
  [stablecoin-gateway]="stablecoin-load-test.js|http://localhost:8020"
  [crypto-gateway]="crypto-load-test.js|http://localhost:8030"
  [agent-identity]="agent-identity-load-test.js|http://localhost:3010"
  [agent-negotiation]="agent-negotiation-load-test.js|http://localhost:3011"
  [rwa-registry]="rwa-registry-load-test.js|http://localhost:3008"
)

echo "Capturing baseline: ${VUS} VUs, ${DURATION} per service"
echo ""

RESULT_JSON="{}"

for svc in "${!SERVICES[@]}"; do
  IFS='|' read -r script default_url <<< "${SERVICES[$svc]}"
  env_var="BASE_URL_$(echo "$svc" | tr '[:lower:]-' '[:upper:]_')"
  url="${!env_var:-$default_url}"
  summary_file="$RESULTS_DIR/${svc}-${TIMESTAMP}.json"

  echo "-> ${svc} (${script}) against ${url}"

  if BASE_URL="$url" FORGEPAY_API_URL="$url" k6 run \
      --vus "$VUS" --duration "$DURATION" \
      --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" \
      --summary-export="$summary_file" \
      "$SCRIPT_DIR/$script" > "$RESULTS_DIR/${svc}-${TIMESTAMP}.log" 2>&1; then
    :
  else
    echo "   (test run reported failures — see $RESULTS_DIR/${svc}-${TIMESTAMP}.log; still capturing whatever metrics it produced)"
  fi

  if [[ ! -f "$summary_file" ]]; then
    echo "   SKIPPED: no summary produced for ${svc}"
    continue
  fi

  p50=$(jq '.metrics.http_req_duration.med // 0' "$summary_file")
  p95=$(jq '.metrics.http_req_duration["p(95)"] // 0' "$summary_file")
  p99=$(jq '.metrics.http_req_duration["p(99)"] // 0' "$summary_file")
  err_rate=$(jq '(.metrics.http_req_failed.value // 0) * 100' "$summary_file")

  RESULT_JSON=$(jq --arg svc "$svc" \
    --argjson p50 "$p50" --argjson p95 "$p95" --argjson p99 "$p99" \
    --argjson err "$err_rate" --argjson vus "$VUS" \
    '.[$svc] = {p50_ms: $p50, p95_ms: $p95, p99_ms: $p99, error_rate_pct: $err, vus: $vus}' \
    <<< "$RESULT_JSON")

  echo "   p50=${p50}ms p95=${p95}ms p99=${p99}ms error_rate=${err_rate}%"
done

CAPTURED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
jq -n \
  --arg captured_at "$CAPTURED_AT" \
  --argjson services "$RESULT_JSON" \
  '{
    captured_at: $captured_at,
    environment: (env.ENVIRONMENT // "unspecified — set ENVIRONMENT=staging|prod when capturing for real"),
    note: "Captured by capture-baseline.sh — real measured values, not placeholders.",
    services: $services,
    regression_threshold_pct: 20
  }' > "$SCRIPT_DIR/baseline.json"

echo ""
echo "Baseline written: $SCRIPT_DIR/baseline.json"
cat "$SCRIPT_DIR/baseline.json"
