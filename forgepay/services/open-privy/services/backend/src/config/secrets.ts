/**
 * Centralised, fail-closed access to security-critical secrets.
 *
 * The previous code fell back to hard-coded strings such as 'dev-secret' when
 * an env var was missing. In production that means tokens are signed with a
 * publicly known constant — anyone can forge a token for any user. These
 * helpers refuse to hand out an insecure default when NODE_ENV=production.
 */

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/**
 * The single source of truth for the JWT signing/verification secret.
 * Used by both jwt.config.ts (signing) and jwt.strategy.ts (verification) so
 * the two can never drift apart.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (secret && secret.length >= 16) {
    return secret;
  }

  if (isProduction()) {
    throw new Error(
      'JWT_SECRET is not set (or is too short). Refusing to start with an ' +
        'insecure default in production. Set a strong JWT_SECRET (>= 32 chars).',
    );
  }

  // Non-production only: allow local development to run without configuration.
  return 'dev-only-insecure-jwt-secret-do-not-use-in-prod';
}
