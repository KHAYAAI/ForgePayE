/**
 * Centralised configuration — reads from environment variables (via dotenv).
 * All consumers import from here; never read process.env directly in services.
 */

import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

const DEV_JWT_SECRET = 'dev-jwt-secret-change-in-prod';
const MIN_PRODUCTION_SECRET_LENGTH = 32;

/**
 * JWT signing secret, with a production guard.
 *
 * This previously went through `optional()`, which meant an unset JWT_SECRET
 * silently signed production tokens with a value published in this repository —
 * anyone who could read the source could mint a valid token. Every other service
 * that carries a development secret refuses to start without a real one
 * (see forge-wallet/src/index.ts and open-privy's jwt-secret.ts); this brings
 * the yield engine in line with them.
 *
 * Development keeps the fallback so `npm run dev` needs no setup.
 *
 * @throws when NODE_ENV=production and the secret is missing, too short, or
 *         still the development value.
 */
function jwtSecret(): string {
  const secret = process.env['JWT_SECRET'];

  if (process.env['NODE_ENV'] === 'production') {
    if (!secret) {
      throw new Error(
        '[yield-engine] JWT_SECRET is not set. Refusing to start in production ' +
        'without an explicit signing secret — generate one with `openssl rand -hex 32`.',
      );
    }
    if (secret === DEV_JWT_SECRET) {
      throw new Error(
        '[yield-engine] JWT_SECRET is still the development fallback, which is ' +
        'public in this repository. Refusing to start in production.',
      );
    }
    if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new Error(
        `[yield-engine] JWT_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} ` +
        `characters in production (got ${secret.length}).`,
      );
    }
    return secret;
  }

  return secret ?? DEV_JWT_SECRET;
}

export const config = {
  port: parseInt(optional('PORT', '3007'), 10),

  jwtSecret: jwtSecret(),

  rpc: {
    ethereum: optional('RPC_URL_ETHEREUM', 'https://cloudflare-eth.com'),
    polygon:  optional('RPC_URL_POLYGON',  'https://polygon-rpc.com'),
    base:     optional('RPC_URL_BASE',     'https://mainnet.base.org'),
    arbitrum: optional('RPC_URL_ARBITRUM', 'https://arb1.arbitrum.io/rpc'),
  },

  ondoApiKey:    optional('ONDO_API_KEY', ''),
  ondoApiBase:   'https://api.ondo.finance/v1',

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
} as const;
