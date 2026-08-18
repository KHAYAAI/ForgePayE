function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required env var ${name} is not set`);
  return v;
}

/**
 * Resolve the allowed CORS origins.
 *
 * @throws in production when CORS_ALLOWED_ORIGINS is unset, empty, or "*" —
 * mirroring agent-credit-bureau's resolveCorsOrigin() (src/index.ts). A
 * stablecoin gateway that boots with no origin allowlist in production is
 * either silently useless (falls back to localhost, so the real merchant
 * dashboard can't call it) or, if an operator "fixes" that by setting it to
 * "*", silently wide open. Neither should happen without an explicit choice.
 */
export function resolveCorsOrigins(): string[] {
  const raw = process.env['CORS_ALLOWED_ORIGINS'];
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (isProduction && (!raw || !raw.trim() || raw.trim() === '*')) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS is not set (or is "*") in production. stablecoin-gateway refuses to ' +
      'start without an explicit origin allowlist — set it to a comma-separated list of trusted ' +
      'origins, e.g. CORS_ALLOWED_ORIGINS=https://dashboard.forgepay.io,https://app.forgepay.io',
    );
  }

  const origins = (raw ?? 'http://localhost:3001').split(',').map((o) => o.trim()).filter(Boolean);

  if (isProduction && origins.includes('*')) {
    throw new Error('CORS_ALLOWED_ORIGINS must not include "*" as one of several origins in production.');
  }

  return origins;
}

export const config = {
  port: parseInt(opt('PORT', '8020'), 10),
  env:  opt('NODE_ENV', 'development') as 'development' | 'production',

  // PostgreSQL (shared with rest of ForgePay)
  postgres: {
    host:     opt('POSTGRES_HOST',     'localhost'),
    port:     parseInt(opt('POSTGRES_PORT', '5432'), 10),
    database: opt('POSTGRES_DB',       'forgepay_dev'),
    user:     opt('POSTGRES_USER',     'forgepay'),
    password: req('POSTGRES_PASSWORD'),
  },

  redis: { url: opt('REDIS_URL', 'redis://localhost:6379') },

  // Unified-router for event forwarding
  unifiedRouterUrl:       opt('UNIFIED_ROUTER_URL', 'http://unified-router:8000'),
  internalWebhookSecret:  req('INTERNAL_WEBHOOK_SECRET'),

  // Confirmation thresholds (number of block confirmations required)
  confirmations: {
    ethereum: parseInt(opt('ETH_CONFIRMATIONS',     '12'), 10),
    polygon:  parseInt(opt('POLYGON_CONFIRMATIONS', '20'), 10),
    base:     parseInt(opt('BASE_CONFIRMATIONS',    '10'), 10),
    arbitrum: parseInt(opt('ARBITRUM_CONFIRMATIONS','10'), 10),
    solana:   parseInt(opt('SOLANA_CONFIRMATIONS',  '32'), 10),
  },

  // EVM RPC endpoints (set to your Alchemy/Infura/QuickNode URLs in production)
  rpc: {
    ethereum: opt('ETH_RPC_URL',      'https://cloudflare-eth.com'),
    polygon:  opt('POLYGON_RPC_URL',  'https://polygon-rpc.com'),
    base:     opt('BASE_RPC_URL',     'https://mainnet.base.org'),
    arbitrum: opt('ARBITRUM_RPC_URL', 'https://arb1.arbitrum.io/rpc'),
  },

  // x402 payment protocol (AI/agent payments)
  x402: {
    enabled:       opt('X402_ENABLED', 'true') === 'true',
    maxAmountUsdc: parseInt(opt('X402_MAX_AMOUNT_USDC', '100'), 10), // max $100 per x402 request
  },

  // Deposit address TTL in seconds (48 hours)
  depositAddressTtlSeconds: parseInt(opt('DEPOSIT_ADDRESS_TTL', String(48 * 3600)), 10),

  // Payment expiry (1 hour to pay)
  paymentExpirySeconds: parseInt(opt('PAYMENT_EXPIRY_SECONDS', '3600'), 10),

  // CORS allowed origins (comma-separated list). Throws at load time in
  // production if unset or "*" — see resolveCorsOrigins() above.
  corsAllowedOrigins: resolveCorsOrigins(),

  // Shielded stablecoin payments (ZK-proof privacy)
  shielded: {
    // Master switch for the shielded-deposits and x402 shielded-pay HTTP
    // routes. Default OFF: the Groth16 verifier (lib/proof-verifier.ts) is
    // currently a stub that always returns true, so until real on-chain
    // verification is wired up, these routes must not be reachable at all.
    // Only set SHIELDED_PAYMENTS_ENABLED=true once you understand the
    // stub's current limitations — see .env.example.
    paymentsEnabled: opt('SHIELDED_PAYMENTS_ENABLED', 'false') === 'true',
    // Separate switch for the background monitor that polls the
    // NullifierRegistry contracts for confirmations. Independent of
    // paymentsEnabled above — a deposit that was never created (routes off)
    // has nothing for this monitor to confirm anyway.
    enabled: opt('SHIELDED_ENABLED', 'false') === 'true',
    // How often to poll NullifierRegistry for confirmed shielded payments (ms)
    monitorIntervalMs: parseInt(opt('SHIELDED_MONITOR_INTERVAL_MS', '30000'), 10),
    // MoR auditor service for decrypting encrypted memos
    auditorServiceUrl: opt('AUDITOR_SERVICE_URL', 'http://mor-layer:8010'),
    // NullifierRegistry contract addresses per chain (all-zero until deployed)
    nullifierRegistry: {
      ethereum: opt('NULLIFIER_REGISTRY_ETHEREUM', '0x0000000000000000000000000000000000000000'),
      polygon:  opt('NULLIFIER_REGISTRY_POLYGON',  '0x0000000000000000000000000000000000000000'),
      base:     opt('NULLIFIER_REGISTRY_BASE',     '0x0000000000000000000000000000000000000000'),
      arbitrum: opt('NULLIFIER_REGISTRY_ARBITRUM', '0x0000000000000000000000000000000000000000'),
    },
  },
} as const;
