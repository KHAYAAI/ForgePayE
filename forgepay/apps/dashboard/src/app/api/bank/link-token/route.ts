/**
 * POST /api/bank/link-token
 * Creates a Plaid Link token by calling the bank connectivity service.
 * Returns { linkToken, expiration }
 */

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const merchantId = (session.user as Record<string, unknown>).merchantId as string | undefined
    ?? 'merchant-default';

  try {
    const baseUrl = process.env['BANK_CONNECTIVITY_URL'] ?? 'http://localhost:3020';
    const res = await fetch(`${baseUrl}/api/v1/link/plaid/create-link-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-merchant-id': merchantId,
      },
      body: JSON.stringify({ merchantId }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // Dev fallback: return a simulated link token when the service is unavailable
      const expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      return NextResponse.json({
        linkToken: `link-sandbox-${crypto.randomUUID()}`,
        expiration,
      });
    }

    const body = (await res.json()) as { linkToken?: string; link_token?: string; expiration?: string };
    return NextResponse.json({
      linkToken: body.linkToken ?? body.link_token ?? `link-sandbox-${crypto.randomUUID()}`,
      expiration: body.expiration ?? new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    console.error('[bank/link-token] error:', err);
    // Dev fallback
    const expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    return NextResponse.json({
      linkToken: `link-sandbox-${crypto.randomUUID()}`,
      expiration,
    });
  }
}
