# Runbook: Yield Engine Incident Response

## Service: yield-engine (port 3007)

Auto-sweeps idle merchant stablecoin balances into DeFi vaults (Aave V3,
Compound V3, Ondo USDY) every `SWEEP_INTERVAL_MINUTES` (default 15 min)
and tracks positions/returns. Writes real transactions to EVM chains via
`ethers.js`.

### Symptom: Sweep cron isn't running / merchant balances stay idle

**Cause:** The scheduled job died silently, or `stablecoin-gateway`
(which this service queries for balances over HTTP) is unreachable.

**Resolution:**
1. Check logs for the periodic `sweepIdleBalances()` log line at the
   expected interval — if it stopped appearing, the cron loop itself
   died (check for an uncaught exception that should have been caught by
   the global `unhandledRejection`/`uncaughtException` handlers but check
   they didn't just log-and-continue past a broken loop).
2. Verify `stablecoin-gateway` connectivity from this pod (same-namespace
   HTTP call) — if that service is down or its NetworkPolicy is
   misconfigured, balance queries fail and sweeps have nothing to act on.
3. Manually trigger via `POST /api/v1/sweep` (if exposed) to test the
   path in isolation from the cron scheduler.

### Symptom: Aave/Compound adapter throwing type errors on withdraw/supply calls

**Cause:** `ethers.Contract.connect(signer)` returns a `BaseContract`
type, which loses the dynamic method-proxy typing the original
`Contract` instance had — a known ethers v6 typing quirk. If this
resurfaces after an ethers upgrade, it'll show as a TypeScript build
failure (`Property 'supply'/'withdraw' does not exist on type
'BaseContract'`), not a runtime error — meaning it would be caught at
build time, not silently deployed.

**Resolution:** Confirm `src/adapters/aave.ts` and `compound.ts` cast the
connected instance back to `ethers.Contract` after `.connect(signer)`.

### Symptom: A specific vault's APY looks stale or wrong

**Cause:** `apyAggregator.ts` caches fetched APYs (`FORECAST_CACHE_TTL`-
style TTL) — a provider outage during the cache window means yield-engine
keeps serving the last-known APY rather than erroring, which is usually
correct behavior but can look like a bug if a rate spiked or crashed
recently and the UI hasn't caught up.

**Resolution:**
1. Check the vault-specific adapter's last successful fetch timestamp.
2. Force a fresh fetch (cache-invalidation endpoint, if exposed) before
   assuming the number itself is wrong.

### Symptom: `/api/v1/*` returning 401 even with a valid `x-merchant-id` header

**Cause:** The `x-merchant-id` fallback is dev-mode only — in
production, only real JWT auth (`@fastify/jwt`) is accepted. This is
correct, not a bug, if `NODE_ENV=production`.

### Symptom: `/metrics` unreachable from Prometheus

Same fleet-wide pattern — served on the single main port (3007), not a
separate metrics port. Confirm the ServiceMonitor targets the `http`
named port.
