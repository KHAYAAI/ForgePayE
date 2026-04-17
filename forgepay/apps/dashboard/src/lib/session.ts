import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';

/** Thrown when no API key can be resolved for the request. */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() { super('Unauthorized'); }
}

/**
 * Returns the merchant's Hyperswitch API key from their authenticated JWT session.
 * Throws `UnauthorizedError` if the caller is not authenticated.
 */
export async function getSessionApiKey(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (session?.user?.apiKey) return session.user.apiKey;

  // Dev / CI fallback — must NEVER be set in production Kubernetes secrets.
  const envKey = process.env['HYPERSWITCH_MERCHANT_API_KEY'];
  if (envKey) return envKey;

  throw new UnauthorizedError();
}

/** Convenience: turn an UnauthorizedError into a 401 NextResponse. */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
