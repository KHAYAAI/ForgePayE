function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required env var ${name} is not set`);
  return v;
}
function optSecret(name: string): string | undefined {
  return process.env[name];
}

export const config = {
  port: parseInt(opt('PORT', '8040'), 10),
  env:  opt('NODE_ENV', 'development') as 'development' | 'production',

  postgres: {
    host:     opt('POSTGRES_HOST',     'localhost'),
    port:     parseInt(opt('POSTGRES_PORT', '5432'), 10),
    database: opt('POSTGRES_DB',       'forgepay_dev'),
    user:     opt('POSTGRES_USER',     'forgepay'),
    password: process.env['NODE_ENV'] === 'production'
      ? req('POSTGRES_PASSWORD')
      : opt('POSTGRES_PASSWORD', 'forgepay_dev'),
  },

  redis: { url: opt('REDIS_URL', 'redis://localhost:6379') },

  unifiedRouterUrl:      opt('UNIFIED_ROUTER_URL', 'http://unified-router:8000'),
  internalWebhookSecret: process.env['NODE_ENV'] === 'production'
    ? req('INTERNAL_WEBHOOK_SECRET')
    : opt('INTERNAL_WEBHOOK_SECRET', 'dev-secret'),

  corsAllowedOrigins: opt('CORS_ALLOWED_ORIGINS', 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  encryptionKey: opt('PRIVATE_KEY_ENCRYPTION_KEY', ''),

  // Circle API (USD <-> USDC conversion)
  circle: {
    apiKey:        optSecret('CIRCLE_API_KEY'),
    baseUrl:       opt('CIRCLE_API_URL', 'https://api.circle.com/v1'),
    webhookSecret: optSecret('CIRCLE_WEBHOOK_SECRET'),
  },

  // KYC/AML
  //
  // Both of these are AML controls, so both fail closed in production. The
  // identity-verification key was previously `optSecret`, and KycAmlManager
  // auto-approved every applicant when it was absent — an unset variable
  // silently turned KYC off. Sanctions screening likewise defaulted to off.
  kyc: {
    onfidoApiKey: process.env['NODE_ENV'] === 'production'
      ? req('ONFIDO_API_KEY')
      : optSecret('ONFIDO_API_KEY'),
    ofacScreeningEnabled: process.env['NODE_ENV'] === 'production'
      ? opt('OFAC_SCREENING_ENABLED', 'true') === 'true'
      : opt('OFAC_SCREENING_ENABLED', 'false') === 'true',
  },

  // EVM RPC endpoints
  rpc: {
    ethereum: opt('ETH_RPC_URL',      'https://cloudflare-eth.com'),
    polygon:  opt('POLYGON_RPC_URL',  'https://polygon-rpc.com'),
    base:     opt('BASE_RPC_URL',     'https://mainnet.base.org'),
    arbitrum: opt('ARBITRUM_RPC_URL', 'https://arb1.arbitrum.io/rpc'),
  },

  accounts: {
    defaultChain:        opt('DEFAULT_CHAIN', 'polygon') as 'polygon' | 'base' | 'ethereum' | 'arbitrum',
    minDepositUsd:       parseFloat(opt('MIN_DEPOSIT_USD', '10')),
    maxDepositUsd:       parseFloat(opt('MAX_DEPOSIT_USD', '50000')),
    withdrawalFeePercent: parseFloat(opt('WITHDRAWAL_FEE_PERCENT', '0.5')),
    depositTtlSeconds:   parseInt(opt('DEPOSIT_TTL_SECONDS', String(48 * 3600)), 10),
  },

  // Phase 2: ZK proof generation (disabled by default until circuits are finalized)
  zkProofs: {
    enabled:       opt('ZK_PROOFS_ENABLED', 'false') === 'true',
    exportKeysBin: opt('ZK_EXPORT_KEYS_BIN', '/usr/local/bin/export-keys'),
  },

  // AWS KMS for custodial account key management
  aws: {
    region:      opt('AWS_REGION', 'us-east-1'),
    kmsKeyArn:   optSecret('KMS_KEY_ARN') || '',  // ARN of main CMK for custodial accounts
  },
} as const;
