"use strict";
/**
 * Centralised configuration — reads from environment variables (via dotenv).
 * All consumers import from here; never read process.env directly in services.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
require("dotenv/config");
function required(key) {
    const val = process.env[key];
    if (!val)
        throw new Error(`Missing required environment variable: ${key}`);
    return val;
}
function optional(key, fallback) {
    return process.env[key] ?? fallback;
}
exports.config = {
    port: parseInt(optional('PORT', '3007'), 10),
    jwtSecret: optional('JWT_SECRET', 'dev-jwt-secret-change-in-prod'),
    rpc: {
        ethereum: optional('RPC_URL_ETHEREUM', 'https://cloudflare-eth.com'),
        polygon: optional('RPC_URL_POLYGON', 'https://polygon-rpc.com'),
        base: optional('RPC_URL_BASE', 'https://mainnet.base.org'),
        arbitrum: optional('RPC_URL_ARBITRUM', 'https://arb1.arbitrum.io/rpc'),
    },
    ondoApiKey: optional('ONDO_API_KEY', ''),
    ondoApiBase: 'https://api.ondo.finance/v1',
    stablecoinGatewayUrl: optional('STABLECOIN_GATEWAY_URL', 'http://localhost:3002'),
    sweepIntervalMinutes: parseInt(optional('SWEEP_INTERVAL_MINUTES', '15'), 10),
    corsOrigins: optional('CORS_ORIGINS', 'http://localhost:3000,http://localhost:3001')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    // Optional: private key for the hot-wallet signer that submits on-chain txns.
    // In production use KMS / Vault instead.
    signerPrivateKey: process.env['SIGNER_PRIVATE_KEY'] ?? '',
    // APY cache TTL in milliseconds (15 minutes)
    apyCacheTtlMs: 15 * 60 * 1000,
};
//# sourceMappingURL=config.js.map