/**
 * Single resolver for NextAuth's session-signing secret.
 *
 * lib/auth.ts previously did:
 *
 *     secret: process.env['NEXTAUTH_SECRET'] ?? 'dev-nextauth-secret-change-me'
 *
 * with no production guard. If NEXTAUTH_SECRET was unset at deploy time,
 * this console would sign and verify sessions with a fallback that is
 * public in this repository — anyone could forge a session. Same class of
 * bug, same fix, as apps/platform/lib/jwt-secret.ts.
 */

const DEV_FALLBACK = 'dev-nextauth-secret-change-me';
const MIN_PRODUCTION_LENGTH = 32;

let warned = false;

/**
 * @throws in production when NEXTAUTH_SECRET is missing, too short, or
 *         still set to the development fallback.
 */
export function getNextAuthSecret(): string {
  const secret = process.env['NEXTAUTH_SECRET'];
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (isProduction) {
    if (!secret) {
      throw new Error(
        'NEXTAUTH_SECRET is not set. The dashboard refuses to start in production ' +
        'without an explicit signing secret — generate one with ' +
        '`openssl rand -hex 32` and supply it via Vault or AWS Secrets Manager.',
      );
    }
    if (secret === DEV_FALLBACK) {
      throw new Error(
        'NEXTAUTH_SECRET is set to the development fallback value. This secret is ' +
        'public in the repository and must never be used in production.',
      );
    }
    if (secret.length < MIN_PRODUCTION_LENGTH) {
      throw new Error(
        `NEXTAUTH_SECRET must be at least ${MIN_PRODUCTION_LENGTH} characters in ` +
        `production (got ${secret.length}). Generate one with \`openssl rand -hex 32\`.`,
      );
    }
    return secret;
  }

  if (!secret && !warned) {
    warned = true;
    console.warn(
      '[auth] NEXTAUTH_SECRET is not set — falling back to the development secret. ' +
      'This is refused in production.',
    );
  }

  return secret || DEV_FALLBACK;
}
