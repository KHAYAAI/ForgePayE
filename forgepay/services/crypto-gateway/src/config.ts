function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required env var ${name} is not set`);
  return v;
}

export const config = {
  port: parseInt(opt('PORT', '8030'), 10),
  env:  opt('NODE_ENV', 'development') as 'development' | 'production',

  postgres: {
    host:     opt('POSTGRES_HOST',     'localhost'),
    port:     parseInt(opt('POSTGRES_PORT', '5432'), 10),
    database: opt('POSTGRES_DB',       'forgepay_dev'),
    user:     opt('POSTGRES_USER',     'forgepay'),
    password: req('POSTGRES_PASSWORD'),
  },

  redis: { url: opt('REDIS_URL', 'redis://localhost:6379') },

  unifiedRouterUrl:      opt('UNIFIED_ROUTER_URL',       'http://unified-router:8000'),
  internalWebhookSecret: req('INTERNAL_WEBHOOK_SECRET'),

  // Invoice expiry (1 hour)
  invoiceExpirySeconds: parseInt(opt('INVOICE_EXPIRY_SECONDS', '3600'), 10),

  // Confirmation requirements per coin
  confirmations: {
    BTC: parseInt(opt('BTC_CONFIRMATIONS', '3'),  10),
    ETH: parseInt(opt('ETH_CONFIRMATIONS', '12'), 10),
    LTC: parseInt(opt('LTC_CONFIRMATIONS', '6'),  10),
    XMR: parseInt(opt('XMR_CONFIRMATIONS', '10'), 10),
  },

  // Node RPC connection URLs
  nodes: {
    BTC: opt('BTC_RPC_URL', ''),
    ETH: opt('ETH_RPC_URL', ''),
    LTC: opt('LTC_RPC_URL', ''),
    XMR: opt('XMR_RPC_URL', ''),
  },

  // Price feed API (used to convert crypto amounts to USD)
  priceFeedUrl: opt('PRICE_FEED_URL', 'https://api.coingecko.com/api/v3'),

  // CORS allowed origins (comma-separated list)
  corsAllowedOrigins: opt('CORS_ALLOWED_ORIGINS', 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
} as const;
