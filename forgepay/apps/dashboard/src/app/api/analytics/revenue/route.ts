import { type NextRequest, NextResponse } from 'next/server';
import { getSessionApiKey, unauthorizedResponse, UnauthorizedError } from '@/lib/session';
import { listPayments } from '@/lib/hyperswitch-server';

export const runtime = 'nodejs';

interface DailyBucket {
  date:    string;
  revenue: number;
  count:   number;
}

export async function GET(req: NextRequest) {
  try {
    const apiKey   = await getSessionApiKey();
    const daysParam = req.nextUrl.searchParams.get('days');
    const days      = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 15, 1), 90) : 15;

    // Fetch recent payments list and bucket by day client-side.
    // Hyperswitch's analytics endpoint may not exist in all deployments,
    // so we fall back to listing payments and aggregating ourselves.
    let payments: Array<{ amount?: number; created?: string; status?: string }> = [];
    try {
      const res = await listPayments(apiKey, {
        limit: '100',
        status: 'succeeded',
      }) as { data?: typeof payments };
      payments = res?.data ?? [];
    } catch {
      payments = [];
    }

    // Build a map: ISO date string → { revenue_cents, count }
    const buckets = new Map<string, { revenue: number; count: number }>();

    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      buckets.set(key, { revenue: 0, count: 0 });
    }

    for (const p of payments) {
      if (!p.created) continue;
      const d   = new Date(p.created);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (buckets.has(key)) {
        const b = buckets.get(key)!;
        b.revenue += p.amount ?? 0;
        b.count   += 1;
      }
    }

    const daily: DailyBucket[] = Array.from(buckets.entries()).map(([date, b]) => ({
      date,
      revenue: b.revenue,
      count:   b.count,
    }));

    return NextResponse.json({ daily, days });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
