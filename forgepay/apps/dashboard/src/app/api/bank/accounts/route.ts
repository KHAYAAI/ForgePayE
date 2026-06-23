/**
 * GET /api/bank/accounts
 * Returns linked bank accounts from the bank connectivity service.
 * Returns { data: AccountBalance[] }
 */

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const merchantId = (session.user as Record<string, unknown>).merchantId as string | undefined
    ?? 'merchant-default';

  try {
    const baseUrl = process.env['BANK_CONNECTIVITY_URL'] ?? 'http://localhost:3020';
    const res = await fetch(`${baseUrl}/api/v1/accounts`, {
      headers: { 'x-merchant-id': merchantId },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // Service unavailable — return empty list so the page still renders
      return NextResponse.json({ data: [] });
    }

    const body = (await res.json()) as { data?: unknown[] };
    return NextResponse.json({ data: body.data ?? [] });
  } catch (err) {
    console.error('[bank/accounts] error:', err);
    return NextResponse.json({ data: [] });
  }
}
