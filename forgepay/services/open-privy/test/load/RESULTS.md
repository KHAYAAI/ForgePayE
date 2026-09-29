# Load test — measured baseline

**Date:** 2026-08-19 · **Tool:** autocannon · **Env:** single backend process (one
core, dev container) against local PostgreSQL 16 + Redis. These are a **capacity
floor**, not a production benchmark — a real EKS node + RDS will differ, and the
HPA scales 3→10 replicas. Numbers exist so scaling decisions start from data, not
guesses.

Rate limiting was raised (`RATE_LIMIT_IP_POINTS=1000000`) for the capacity runs;
with the default 100/min the limiter correctly returned HTTP 429 after 100
requests (verified — that run showed `0 2xx, 38056 non-2xx`).

| Endpoint | Exercises | Conns | Throughput | p50 | p97.5 | avg |
|---|---|---|---|---|---|---|
| `GET /health` | HTTP path only | 50 | **~3,290 req/s** | 23 ms | 26 ms | 14.7 ms |
| `GET /auth/me` | JWT verify + Postgres read | 50 | **~1,120 req/s** | 59 ms | 65 ms | 44 ms |

Single-instance authenticated throughput ≈ **1.1k req/s**; with the HPA at 3–10
replicas that is roughly **3.3k–11k authenticated req/s** before DB becomes the
bottleneck.

## What this does NOT yet cover (needs staging + real infra)

- Write-heavy paths (`POST /wallet/create` runs PBKDF2 100k + AES-GCM + an INSERT —
  intentionally CPU-heavy; must be load-tested separately to size CPU and set a
  realistic wallet-creation rate limit).
- Custodial `POST /transactions/send` (decrypt + sign + RPC broadcast) — bounded by
  the upstream RPC provider, not us.
- Sustained soak (memory/connection-pool leaks) — use the k6 ramp in
  `staging-load.k6.js`.
- Redis and RDS under real network latency (here they are on localhost).

## Reproduce

```bash
# server (raise the limit so you measure the app, not the limiter)
RATE_LIMIT_IP_POINTS=1000000 npm run start
# probe
BASE_URL=http://localhost:3001 TOKEN=<jwt> test/load/quick-load.sh
# full ramp
BASE_URL=https://staging-api.openprivy.io k6 run test/load/staging-load.k6.js
```
