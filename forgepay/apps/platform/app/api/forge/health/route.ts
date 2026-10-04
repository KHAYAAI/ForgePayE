import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/route-guard';
import { getServiceHealth } from '@/lib/forge-services';

export const dynamic = 'force-dynamic';

/**
 * Live reachability for every backend service — see System Health.
 * Signed-in users only: it names every internal service and whether it is up.
 */
export async function GET() {
  const g = await guardRoute();
  if ('response' in g) return g.response;
  const services = await getServiceHealth();
  return NextResponse.json({ services });
}
