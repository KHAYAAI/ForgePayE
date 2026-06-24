/**
 * ForgePay Yield Engine
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Auto-sweeps idle merchant stablecoin balances into DeFi yield vaults
 *   (Aave V3, Compound V3, Ondo USDY) and tracks positions + returns.
 *
 * Cron jobs:
 *   Every SWEEP_INTERVAL_MINUTES (default: 15 min):
 *     1. sweepIdleBalances()  — deposit idle USDC/USDT into configured vaults
 *     2. updateAllPositions() — refresh on-chain balances & unrealized yield
 *
 * Port: 3007
 *
 * Routes:
 *   /api/v1/vaults        — vault catalogue & live APYs
 *   /api/v1/positions     — merchant position management
 *   /api/v1/sweep         — auto-sweep configuration & history
 *   /api/v1/yields        — APY aggregation & yield transaction log
 *
 * Auth:
 *   JWT (@fastify/jwt) for inbound requests from the dashboard / mor-layer.
 *   The `x-merchant-id` header is accepted as a fallback in dev mode.
 *
 * Internal service communication:
 *   Reads from stablecoin-gateway (balance queries) via HTTP.
 *   Writes to EVM chains via ethers.js JsonRpcProvider.
 */
import 'dotenv/config';
//# sourceMappingURL=index.d.ts.map