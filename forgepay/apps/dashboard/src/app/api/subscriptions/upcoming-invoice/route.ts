/**
 * GET /api/subscriptions/upcoming-invoice
 *
 * Returns the upcoming Kill Bill invoice for the authenticated merchant's account.
 * Falls back gracefully when Kill Bill is unreachable.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { unauthorizedResponse } from '@/lib/session';
import { getUpcomingInvoice } from '@/lib/killbill-server';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) return unauthorizedResponse();

  const merchantId =
    (session.user as Record<string, unknown>)['merchantId'] as string | undefined
    ?? process.env['KILLBILL_DEFAULT_ACCOUNT_ID']
    ?? 'merchant-default';

  try {
    const invoice = await getUpcomingInvoice(merchantId);
    return NextResponse.json(invoice);
  } catch (err) {
    // Kill Bill may not have a scheduled invoice yet — not an error worth surfacing
    console.error('[upcoming-invoice] error:', err);
    return NextResponse.json({ error: 'No upcoming invoice' }, { status: 404 });
  }
}
