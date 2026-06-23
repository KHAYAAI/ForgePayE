/**
 * POST /api/bank/exchange
 * Exchanges a Plaid public token for a permanent access token.
 * Body: { publicToken: string }
 * Returns: { accountId: string, success: boolean }
 */

import { getServerSession } from 'next-auth';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const merchantId = (session.user as Record<string, unknown>).merchantId as string | undefined
    ?? 'merchant-default';

  let publicToken: string | undefined;
  try {
    const body = (await req.json()) as { publicToken?: string };
    publicToken = body.publicToken;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!publicToken) {
    return NextResponse.json({ error: 'publicToken is required' }, { status: 400 });
  }

  try {
    const baseUrl = process.env['BANK_CONNECTIVITY_URL'] ?? 'http://localhost:3020';
    const res = await fetch(`${baseUrl}/api/v1/link/plaid/exchange-public-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-merchant-id': merchantId,
      },
      body: JSON.stringify({ publicToken, merchantId }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return NextResponse.json(
        { error: err.error ?? 'Token exchange failed' },
        { status: 502 },
      );
    }

    const body = (await res.json()) as { accountId?: string; account_id?: string };
    return NextResponse.json({
      accountId: body.accountId ?? body.account_id ?? `acct_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      success: true,
    });
  } catch (err) {
    console.error('[bank/exchange] error:', err);
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
}
