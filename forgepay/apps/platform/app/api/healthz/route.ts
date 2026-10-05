import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Liveness for the container health check. Deliberately says nothing about
 * other services (that is /api/forge/health, which needs sign-in).
 */
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
