#!/usr/bin/env bash
# Quick single-instance load probe using autocannon (npx autocannon).
# For full ramp/soak testing use staging-load.k6.js with k6.
#
# Usage:
#   BASE_URL=http://localhost:3001 TOKEN=<jwt> ./quick-load.sh
#
# The backend enforces a per-IP rate limit; raise it for capacity tests with
# RATE_LIMIT_IP_POINTS=1000000 on the server process, otherwise you measure 429s.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
CONNS="${CONNS:-50}"
DUR="${DUR:-10}"

echo "== /health (unauthenticated baseline) =="
npx --yes autocannon -c "$CONNS" -d "$DUR" "$BASE_URL/health"

if [[ -n "${TOKEN:-}" ]]; then
  echo "== /auth/me (JWT verify + DB read) =="
  npx --yes autocannon -c "$CONNS" -d "$DUR" -H "Authorization=Bearer $TOKEN" "$BASE_URL/auth/me"
fi
