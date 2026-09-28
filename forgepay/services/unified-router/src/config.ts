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
    hyperswitch:        required('HYPERSWITCH_WEBHOOK_SECRET'),
    killbill:           required('KILLBILL_WEBHOOK_SECRET'),
    morLayer:           optional('MOR_LAYER_WEBHOOK_SECRET', ''),
    stablecoinGateway:  required('STABLECOIN_GW_WEBHOOK_SECRET'),
    cryptoGateway:      required('CRYPTO_GW_WEBHOOK_SECRET'),
    forgeCustody:       optional('FORGE_CUSTODY_WEBHOOK_SECRET', ''),
    forgeWallet:        optional('FORGE_WALLET_WEBHOOK_SECRET', ''),
  },

  // Merchant webhook delivery
  merchantWebhookTimeoutMs: parseInt(optional('MERCHANT_WEBHOOK_TIMEOUT_MS', '5000'), 10),
  merchantWebhookMaxRetries: parseInt(optional('MERCHANT_WEBHOOK_MAX_RETRIES', '5'), 10),

  // Kill Bill API for enriching subscription/invoice data in webhook normalizer
  killbill: {
    baseUrl:   optional('KILLBILL_BASE_URL', 'http://billing-engine:8020'),
    apiKey:    optional('KILLBILL_API_KEY', 'forgepay'),
    apiSecret: optional('KILLBILL_API_SECRET', ''),
  },

  // Hyperswitch payment-engine — outbound calls to create/read a payment
  // (routes/checkout.ts). Distinct from webhookSecrets.hyperswitch, which is
  // for verifying *inbound* webhooks; this is the API key Hyperswitch expects
  // on server-to-server calls (its `api-key` header, a merchant secret key —
  // never sent to the browser).
  paymentEngine: {
    baseUrl: optional('PAYMENT_ENGINE_URL', 'http://payment-engine:8080'),
    apiKey:  optional('PAYMENT_ENGINE_API_KEY', ''),
    // Hyperswitch's own publishable key, safe for client-side use — returned
    // to the checkout frontend so it can load the Hyperswitch Web SDK itself.
    publishableKey: optional('PAYMENT_ENGINE_PUBLISHABLE_KEY', ''),
  },

  // Checkout (routes/checkout.ts) — the one path in this service reachable
  // with no credential at all, since a prospect signing up has none yet. See
  // auth.ts's PUBLIC_ROUTES comment for why that's the correct shape here,
  // not a gap.
  // stablecoin-gateway — outbound x402 calls for the checkout's USDC path.
  // Same integration contract agent-credit-bureau/src/billing.ts already uses
  // for its own top-ups (POST /x402/pay, GET /x402/verify/:id) — reused here
  // rather than inventing a second shape for the same gateway.
  stablecoinGateway: {
    baseUrl: optional('STABLECOIN_GATEWAY_URL', 'http://stablecoin-gateway:8020'),
    merchantId: optional('CHECKOUT_X402_MERCHANT_ID', 'forgepay-checkout'),
  },

  checkout: {
    pricingYamlPath: optional('PRICING_YAML_PATH', '../../config/pricing.yaml'),
    // How long a checkout session (payment intent created, not yet confirmed)
    // stays valid before it's treated as abandoned/stalled rather than just
    // slow. Matches Hyperswitch's own default payment-intent expiry window.
    sessionTtlMinutes: parseInt(optional('CHECKOUT_SESSION_TTL_MINUTES', '30'), 10),
    corsOrigin: optional('CHECKOUT_CORS_ORIGIN', 'https://myforgepay.com'),
  },

  // KYAPay integration — trusted issuers and token settings
  kyapay: {
    // Comma-separated list of trusted JWT issuer URLs
    trustedIssuers: optional(
      'KYAPAY_TRUSTED_ISSUERS',
      'https://skyfire.xyz,https://api.forgepay.com',
    ).split(',').map(s => s.trim()).filter(Boolean),
    // ForgePay's own issuer URL (used when we issue tokens)
    issuerUrl: optional('FORGEPAY_ISSUER_URL', 'https://api.forgepay.com'),
  },
} as const;

if (config.env === 'production') {
  const blankSecrets = Object.entries(config.webhookSecrets)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (blankSecrets.length > 0) {
    console.warn(
      `[unified-router] WARNING: webhook secrets not configured for sources: ${blankSecrets.join(', ')}. ` +
      'Webhooks from these sources will fail HMAC verification.'
    );
  }

  // Card checkout moves real money on a key that, unlike the webhook secrets
  // above, has no fallback that "just doesn't verify something" — a missing
  // paymentEngine.apiKey means routes/checkout.ts's card path cannot create a
  // payment intent at all. Refuse to boot rather than let every card checkout
  // fail at request time in production.
  if (!config.paymentEngine.apiKey) {
    throw new Error(
      '[unified-router] PAYMENT_ENGINE_API_KEY is not set. Refusing to start in production — ' +
      'card checkout would fail on every request. Set it to the Hyperswitch merchant secret key.',
    );
  }
}
