/**
 * Single resolver for the console's JWT signing secret.
 *
 * Both the edge middleware and the Node-side auth helpers previously did:
 *
 *     process.env.JWT_SECRET || 'dev-secret-key'
 *
 * with no production guard. If JWT_SECRET was unset at deploy time the console
 * would sign and verify sessions with a fallback that is public in this
 * repository — anyone could mint an admin session token. This module makes
 * that state unreachable outside development.
 *
 * Kept dependency-free (only `process.env`) so it is safe to import from the
 * edge runtime, where the Node crypto/fs APIs are unavailable.
 */

/** Development-only fallback. Never reachable when NODE_ENV === 'production'. */
const DEV_FALLBACK = 'dev-secret-key';

/** Minimum entropy we accept in production — `openssl rand -hex 32` gives 64. */
const MIN_PRODUCTION_LENGTH = 32;

let warned = false;

/**
 * Resolve the JWT secret.
 *
 * @throws in production when JWT_SECRET is missing, too short, or still set to
 *         the development fallback. Failing closed at boot is deliberate: a
 *         console that starts with a guessable signing key is worse than one
 *         that refuses to start.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (!secret) {
      throw new Error(
        'JWT_SECRET is not set. The console refuses to start in production ' +
        'without an explicit signing secret — generate one with ' +
        '`openssl rand -hex 32` and supply it via Vault or AWS Secrets Manager.',
      );
    }
    if (secret === DEV_FALLBACK) {
      throw new Error(
        'JWT_SECRET is set to the development fallback value. This secret is ' +
        'public in the repository and must never be used in production.',
      );
    }
    if (secret.length < MIN_PRODUCTION_LENGTH) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_PRODUCTION_LENGTH} characters in ` +
        `production (got ${secret.length}). Generate one with \`openssl rand -hex 32\`.`,
      );
    }
    return secret;
  }

  if (!secret && !warned) {
    warned = true;
    console.warn(
      '[auth] JWT_SECRET is not set — falling back to the development secret. ' +
      'This is refused in production.',
    );
  }

  return secret || DEV_FALLBACK;
}
