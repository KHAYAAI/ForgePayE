function opt(name, fallback) {
    return process.env[name] ?? fallback;
}
function req(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Required env var ${name} is not set`);
    return v;
}
function optSecret(name) {
    return process.env[name];
}
const DEV_PLACEHOLDER_API_KEYS = new Set(['dev-accounts-key', 'dev-api-key', 'changeme']);
const MIN_PRODUCTION_API_KEY_LENGTH = 32;
/**
 * Valid API keys for /v1/accounts/* — this service's account, wallet and
 * transaction routes previously registered no auth at all (only
 * /v1/webhooks verified anything, via a Circle HMAC signature). Anyone who
 * could reach the service could create accounts, list transactions and
 * drive withdrawals with no credential.
 *
 * Throws synchronously in production when VALID_API_KEYS is missing, still
 * a dev placeholder, or too short — the same fail-to-boot pattern
 * enterprise-treasury uses, so a bad deploy never comes up silently open.
 */
export function resolveApiKeys() {
    const isProduction = process.env['NODE_ENV'] === 'production';
    const rawKeys = (process.env['VALID_API_KEYS'] ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    if (isProduction) {
        if (rawKeys.length === 0) {
            throw new Error('VALID_API_KEYS is not set. accounts-service refuses to start in production without ' +
                'at least one API key — generate one with `openssl rand -hex 32` and supply it via ' +
                'Vault or AWS Secrets Manager.');
        }
        for (const key of rawKeys) {
            if (DEV_PLACEHOLDER_API_KEYS.has(key)) {
                throw new Error(`VALID_API_KEYS contains the development placeholder key "${key}", which must not be used in production.`);
            }
            if (key.length < MIN_PRODUCTION_API_KEY_LENGTH) {
                throw new Error(`Every key in VALID_API_KEYS must be at least ${MIN_PRODUCTION_API_KEY_LENGTH} characters in production (got ${key.length}).`);
            }
        }
    }
    return new Set(rawKeys);
}
export const config = {
    port: parseInt(opt('PORT', '8040'), 10),
    env: opt('NODE_ENV', 'development'),
    postgres: {
        host: opt('POSTGRES_HOST', 'localhost'),
        port: parseInt(opt('POSTGRES_PORT', '5432'), 10),
        database: opt('POSTGRES_DB', 'forgepay_dev'),
        user: opt('POSTGRES_USER', 'forgepay'),
        password: process.env['NODE_ENV'] === 'production'
            ? req('POSTGRES_PASSWORD')
            : opt('POSTGRES_PASSWORD', 'forgepay_dev'),
    },
    redis: { url: opt('REDIS_URL', 'redis://localhost:6379') },
    unifiedRouterUrl: opt('UNIFIED_ROUTER_URL', 'http://unified-router:8000'),
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
        apiKey: optSecret('CIRCLE_API_KEY'),
        baseUrl: opt('CIRCLE_API_URL', 'https://api.circle.com/v1'),
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
        ethereum: opt('ETH_RPC_URL', 'https://cloudflare-eth.com'),
        polygon: opt('POLYGON_RPC_URL', 'https://polygon-rpc.com'),
        base: opt('BASE_RPC_URL', 'https://mainnet.base.org'),
        arbitrum: opt('ARBITRUM_RPC_URL', 'https://arb1.arbitrum.io/rpc'),
    },
    accounts: {
        defaultChain: opt('DEFAULT_CHAIN', 'polygon'),
        minDepositUsd: parseFloat(opt('MIN_DEPOSIT_USD', '10')),
        maxDepositUsd: parseFloat(opt('MAX_DEPOSIT_USD', '50000')),
        withdrawalFeePercent: parseFloat(opt('WITHDRAWAL_FEE_PERCENT', '0.5')),
        depositTtlSeconds: parseInt(opt('DEPOSIT_TTL_SECONDS', String(48 * 3600)), 10),
    },
    // Phase 2: ZK proof generation (disabled by default until circuits are finalized)
    zkProofs: {
        enabled: opt('ZK_PROOFS_ENABLED', 'false') === 'true',
        exportKeysBin: opt('ZK_EXPORT_KEYS_BIN', '/usr/local/bin/export-keys'),
    },
    // AWS KMS for custodial account key management
    aws: {
        region: opt('AWS_REGION', 'us-east-1'),
        kmsKeyArn: optSecret('KMS_KEY_ARN') || '', // ARN of main CMK for custodial accounts
    },
};
//# sourceMappingURL=config.js.map