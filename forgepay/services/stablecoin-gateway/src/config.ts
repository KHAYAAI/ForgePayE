function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required env var ${name} is not set`);
  return v;
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
    password: opt('POSTGRES_PASSWORD', 'devpassword'),
  },

  redis: { url: opt('REDIS_URL', 'redis://localhost:6379') },

  // Unified-router for event forwarding
  unifiedRouterUrl:       opt('UNIFIED_ROUTER_URL', 'http://unified-router:8000'),
  internalWebhookSecret:  opt('INTERNAL_WEBHOOK_SECRET', 'dev-internal-secret-change-me'),

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

  // Shielded stablecoin payments (ZK-proof privacy)
  shielded: {
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
