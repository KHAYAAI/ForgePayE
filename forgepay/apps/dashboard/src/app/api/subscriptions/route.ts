/**
 * GET /api/subscriptions
 *
 * Proxies to Kill Bill to fetch the merchant's subscription bundles.
 * Auth: requires a valid NextAuth session; the merchant's Kill Bill account ID
 * is resolved from the session. Falls back to empty array on Kill Bill errors
 * so the dashboard degrades gracefully when billing-engine is unreachable.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { unauthorizedResponse } from '@/lib/session';
import { listSubscriptions } from '@/lib/killbill-server';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) return unauthorizedResponse();

  // The merchant's Kill Bill account ID is stored in the session (or falls back
  // to a dev default so the page renders during local development).
  const merchantId =
    (session.user as Record<string, unknown>)['merchantId'] as string | undefined
    ?? process.env['KILLBILL_DEFAULT_ACCOUNT_ID']
    ?? 'merchant-default';

  try {
    const subs = await listSubscriptions(merchantId);
    return NextResponse.json({ data: subs, count: subs.length });
  } catch (err) {
    // Graceful degradation — same pattern as the agents route.
    // Kill Bill may be starting up or temporarily unreachable.
    console.error('[subscriptions] Kill Bill fetch error:', err);
    return NextResponse.json({ data: [], count: 0 });
  }
}
