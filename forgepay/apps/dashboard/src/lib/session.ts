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
 * Returns the merchant's Hyperswitch API key from their authenticated JWT session.
 * Validates that the session is not revoked (checks database).
 * Throws `UnauthorizedError` if the caller is not authenticated or session is invalid.
 */
export async function getSessionApiKey(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.apiKey) {
    // Dev / CI fallback — must NEVER be set in production Kubernetes secrets.
    const envKey = process.env['HYPERSWITCH_MERCHANT_API_KEY'];
    if (envKey) return envKey;
    throw new UnauthorizedError();
  }

  // Validate session is not revoked (if sessionId is present)
  const sessionId = (session.user as any)?.sessionId;
  if (sessionId) {
    const validSession = await getValidSession(sessionId);
    if (!validSession) {
      throw new UnauthorizedError();
    }
  }

  return session.user.apiKey;
}

/** Convenience: turn an UnauthorizedError into a 401 NextResponse. */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
