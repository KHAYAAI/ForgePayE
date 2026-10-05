/**
 * API-key authentication for every route except /health and /metrics.
 *
 * This service had none: anyone who could reach it could read every report,
 * generate new ones against treasury, and DELETE /v1/reports wiped them all.
 * Keys come from VALID_API_KEYS (comma-separated). In production the service
 * refuses to start without real keys; elsewhere an unset list leaves it open
 * for local development, and says so.
 */
import { timingSafeEqual } from 'node:crypto';

const DEV_PLACEHOLDERS = new Set(['dev-api-key', 'changeme', 'dev-reporting-key']);
const MIN_PRODUCTION_KEY_LENGTH = 32;
export const PUBLIC_PATHS = new Set(['/health', '/metrics']);

export function resolveApiKeys(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const keys = new Set((env['VALID_API_KEYS'] ?? '').split(',').map((k) => k.trim()).filter(Boolean));
  if (env['NODE_ENV'] === 'production') {
    if (keys.size === 0) {
      throw new Error('VALID_API_KEYS is not set. institutional-reporting refuses to start in production without API keys.');
    }
    for (const k of keys) {
      if (DEV_PLACEHOLDERS.has(k)) throw new Error(`VALID_API_KEYS contains the development placeholder "${k}".`);
      if (k.length < MIN_PRODUCTION_KEY_LENGTH) {
        throw new Error(`Every key in VALID_API_KEYS must be at least ${MIN_PRODUCTION_KEY_LENGTH} characters in production.`);
      }
    }
  }
  return keys;
}

export function keyAccepted(presented: string | undefined, keys: Set<string>): boolean {
  if (keys.size === 0) return true; // development only; production refused above
  if (!presented) return false;
  const p = Buffer.from(presented);
  for (const k of keys) {
    const b = Buffer.from(k);
    if (b.length === p.length && timingSafeEqual(b, p)) return true;
  }
  return false;
}
