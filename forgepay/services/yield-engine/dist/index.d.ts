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
 *   Merchant identity always comes from the verified token's `merchantId`
 *   claim — there is no client-suppliable header override. A missing or
 *   invalid token is rejected with 401 before any handler runs. See
 *   ./lib/auth.ts for the full auth gate.
 *
 * Internal service communication:
 *   Reads from stablecoin-gateway (balance queries) via HTTP.
 *   Writes to EVM chains via ethers.js JsonRpcProvider.
 */
import 'dotenv/config';
export declare function buildApp(): Promise<import("fastify").FastifyInstance<import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, import("fastify").FastifyBaseLogger, import("fastify").FastifyTypeProviderDefault>>;
//# sourceMappingURL=index.d.ts.map