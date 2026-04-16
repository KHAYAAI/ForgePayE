import { type NextRequest, NextResponse } from 'next/server';
import { getSessionApiKey, unauthorizedResponse, UnauthorizedError } from '@/lib/session';
import { listSubscriptions, type KBSubscription } from '@/lib/killbill-server';

export const runtime = 'nodejs';

/** Normalize Kill Bill subscription to the shape the dashboard UI expects. */
function normalize(sub: KBSubscription) {
  return {
    subscription_id:    sub.subscriptionId,
    customer_id:        sub.accountId,
    plan_id:            sub.planName,
    status:             sub.state.toLowerCase(),
    current_period_end: sub.chargedThroughDate ?? sub.startDate,
    start_date:         sub.startDate,
    cancelled_date:     sub.cancelledDate,
  };
}

export async function GET(_req: NextRequest) {
  try {
    // Verify the caller is authenticated — we don't use the HS key for Kill Bill,
    // but we still want to gate this behind a valid session.
    await getSessionApiKey();

    const subs = await listSubscriptions();
    return NextResponse.json({ data: subs.map(normalize), count: subs.length });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
