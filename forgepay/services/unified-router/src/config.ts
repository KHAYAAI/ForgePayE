/**
 * Configuration loaded from environment variables.
 * All secrets come from K8s secrets / Vault — never hardcoded.
 */

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Required env var ${name} is not set`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  env:  optional('NODE_ENV', 'development') as 'development' | 'staging' | 'production',
  port: parseInt(optional('PORT', '8000'), 10),

  postgres: {
    host:     optional('POSTGRES_HOST', 'localhost'),
    port:     parseInt(optional('POSTGRES_PORT', '5432'), 10),
    database: optional('POSTGRES_DB', 'forgepay_dev'),
    user:     optional('POSTGRES_USER', 'forgepay'),
    password: required('POSTGRES_PASSWORD'),
    max:      20,   // connection pool size
  },

  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  },

  // Shared HMAC secret for verifying incoming webhooks from internal services
  internalWebhookSecret: required('INTERNAL_WEBHOOK_SECRET'),

  // Per-source HMAC secrets (set by each service)
  webhookSecrets: {
    hyperswitch:        optional('HYPERSWITCH_WEBHOOK_SECRET', ''),
    killbill:           optional('KILLBILL_WEBHOOK_SECRET', ''),
    morLayer:           optional('MOR_LAYER_WEBHOOK_SECRET', ''),
    stablecoinGateway:  optional('STABLECOIN_GW_WEBHOOK_SECRET', ''),
    cryptoGateway:      optional('CRYPTO_GW_WEBHOOK_SECRET', ''),
  },

  // Merchant webhook delivery
  merchantWebhookTimeoutMs: parseInt(optional('MERCHANT_WEBHOOK_TIMEOUT_MS', '5000'), 10),
  merchantWebhookMaxRetries: parseInt(optional('MERCHANT_WEBHOOK_MAX_RETRIES', '5'), 10),
} as const;
