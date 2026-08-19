import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getValidSession } from '@/lib/sessions';

/** Thrown when no API key can be resolved for the request. */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() { super('Unauthorized'); }
}

/**
 * Returns the merchant's Hyperswitch API key from their authenticated JWT
 * session, after confirming that session is still live.
 *
 * The JWT's own signature and expiry are not sufficient: a merchant who
 * logged out, revoked the session from another device, or just enabled MFA
 * still holds a syntactically valid token until its 7-day expiry. The
 * sessions row is the authority on whether it may still be used, so it is
 * checked on every request.
 *
 * Fails closed on a token with no `sessionId`: such a token cannot be
 * revoked, so treating it as valid would reopen exactly the hole the
 * sessions table exists to close.
 */
export async function getSessionApiKey(): Promise<string> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.apiKey) {
    // Dev / CI fallback — must NEVER be set in production Kubernetes secrets.
    const envKey = process.env['HYPERSWITCH_MERCHANT_API_KEY'];
    if (envKey) return envKey;
    throw new UnauthorizedError();
  }

  const sessionId = session.user.sessionId;
  if (!sessionId) throw new UnauthorizedError();

  const live = await getValidSession(sessionId);
  if (!live) throw new UnauthorizedError();

  return session.user.apiKey;
}

/** Convenience: turn an UnauthorizedError into a 401 NextResponse. */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
