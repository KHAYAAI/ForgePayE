/**
 * Retrieve the authenticated merchant's Hyperswitch API key.
 *
 * When next-auth is fully wired this will decode the JWT session and look up
 * the merchant record from the database.  For now it falls back to the env var
 * so that local development and CI smoke tests work without a live auth flow.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/** Thrown when no API key can be resolved for the request. */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() { super('Unauthorized'); }
}

/**
 * Returns the merchant's Hyperswitch API key from their authenticated session.
 * Throws `UnauthorizedError` if the caller is not authenticated.
 *
 * Replace the cookie read with `getServerSession()` once next-auth is wired.
 */
export async function getSessionApiKey(): Promise<string> {
  // 1. Session cookie set by next-auth JWT (placeholder until auth is wired)
  const jar = await cookies();
  const sessionKey = jar.get('fp_api_key')?.value;
  if (sessionKey) return sessionKey;

  // 2. Dev / CI fallback — never set in production Helm values
  const envKey = process.env['HYPERSWITCH_MERCHANT_API_KEY'];
  if (envKey) return envKey;

  throw new UnauthorizedError();
}

/** Convenience: turn an UnauthorizedError into a 401 NextResponse. */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
