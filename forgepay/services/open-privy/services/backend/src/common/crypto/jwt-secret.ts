/**
 * Single resolver for this service's JWT signing/verification secret.
 *
 * Two separate problems motivated this:
 *
 *   1. Security — both call sites fell back to a hardcoded secret with no
 *      production guard, so an unset JWT_SECRET meant tokens were signed with
 *      a value published in this repository.
 *
 *   2. Correctness — the fallbacks did not match. config/jwt.config.ts signed
 *      with 'dev-secret-change-in-production' while
 *      modules/auth/strategies/jwt.strategy.ts verified with 'dev-secret'.
 *      With JWT_SECRET unset, every token this service issued would fail its
 *      own verification. Routing both through one function makes that class of
 *      drift impossible.
 */

const DEV_FALLBACK = 'dev-secret-change-in-production';
const MIN_PRODUCTION_LENGTH = 32;

let warned = false;

/**
 * @throws in production when JWT_SECRET is missing, too short, or still the
 *         development fallback.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (!secret) {
      throw new Error(
        'JWT_SECRET is not set. Refusing to start in production without an ' +
        'explicit signing secret — generate one with `openssl rand -hex 32`.',
      );
    }
    if (secret === DEV_FALLBACK) {
      throw new Error(
        'JWT_SECRET is set to the development fallback, which is public in ' +
        'this repository.',
      );
    }
    if (secret.length < MIN_PRODUCTION_LENGTH) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_PRODUCTION_LENGTH} characters in ` +
        `production (got ${secret.length}).`,
      );
    }
    return secret;
  }

  if (!secret && !warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn('[auth] JWT_SECRET unset — using the development secret. Refused in production.');
  }

  return secret || DEV_FALLBACK;
}
