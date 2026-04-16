import { type NextRequest, NextResponse } from 'next/server';
import { getSessionApiKey, unauthorizedResponse, UnauthorizedError } from '@/lib/session';
import { getPaymentsSummary } from '@/lib/hyperswitch-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const apiKey = await getSessionApiKey();

    const daysParam = req.nextUrl.searchParams.get('days');
    const days      = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 30, 1), 365) : 30;

    const summary = await getPaymentsSummary(apiKey, days);

    const now   = new Date();
    const start = new Date(now.getTime() - days * 86_400_000);

    return NextResponse.json({
      gross_revenue_cents: summary.total_amount,
      successful_count:    summary.success_count,
      failed_count:        summary.failure_count,
      success_rate:        summary.success_rate,
      total_count:         summary.total_count,
      period_start:        start.toISOString(),
      period_end:          now.toISOString(),
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
