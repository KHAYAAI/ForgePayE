import { NextResponse } from 'next/server';
import { getServiceHealth } from '@/lib/forge-services';

export const dynamic = 'force-dynamic';

/** Live reachability for every backend service — see System Health. */
export async function GET() {
  const services = await getServiceHealth();
  return NextResponse.json({ services });
}
