/**
 * ForgePay RWA (Real-World Assets) Registry
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Unified registry for tokenized real-world assets — T-bills, money
 *       market funds, bonds, and other structured products. Manages positions,
 *       income distribution, tax tracking, and redemption flows.
 *
 * Supported assets (seeded):
 *   USDY  — Ondo Finance (T-bill, 5.20% APY)
 *   FOBXX — Franklin Templeton (money market, 5.05% APY)
 *   TBILL — OpenEden (T-bill, 5.30% APY)
 *   BUIDL — BlackRock (money market, 5.00% APY, institutional)
 *   OUSG  — Ondo Finance (T-bill, 5.15% APY, accredited)
 *   USTB  — Superstate (T-bill, 5.18% APY)
 *
 * Port: 3008
 *
 * Background jobs:
 *   Every 6 hours   — NAV refresh (stub: logs intent, updates timestamps)
 *   Every 24 hours  — Income accrual + distribution to all active positions
 *
 * Routes:
 *   GET  /health
 *   GET  /v1/assets               — list/filter RWA assets
 *   GET  /v1/assets/compare       — compare all assets by APY
 *   GET  /v1/assets/:id           — get single asset
 *   POST /v1/positions            — open position
 *   GET  /v1/positions            — list positions (merchantId required)
 *   GET  /v1/positions/:id        — get position details
 *   PUT  /v1/positions/:id/update-value — refresh NAV-based value
 *   POST /v1/income/distribute    — trigger income distribution
 *   GET  /v1/income               — income history (merchantId required)
 *   GET  /v1/income/tax-summary   — tax liability summary
 *   POST /v1/redemptions          — create redemption request
 *   GET  /v1/redemptions          — list redemptions (merchantId required)
 *   GET  /v1/redemptions/:id      — get redemption details
 *   POST /v1/redemptions/:id/process  — settle redemption (stub)
 *   POST /v1/redemptions/:id/cancel   — cancel pending redemption
 *   POST /v1/nav/refresh          — manually trigger NAV refresh
 */
declare function buildApp(): Promise<import("fastify").FastifyInstance<import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, import("fastify").FastifyBaseLogger, import("fastify").FastifyTypeProviderDefault>>;
export { buildApp };
//# sourceMappingURL=index.d.ts.map