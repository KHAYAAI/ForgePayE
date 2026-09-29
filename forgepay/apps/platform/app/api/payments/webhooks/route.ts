import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getMerchantSummary, getMerchantWebhookEndpoints, registerMerchantWebhook } from '@/lib/forge-services';

interface MerchantSummary {
  activated: boolean;
  customer: { id: string } | null;
}

/** Resolves the signed-in tenant's unified-router customer id, if they've activated FORGE Payments. */
async function resolveMerchantId(email: string): Promise<string | null> {
  const summary = await getMerchantSummary<MerchantSummary>(email);
  if (!summary.live || !summary.data?.activated || !summary.data.customer) return null;
  return summary.data.customer.id;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ live: false, data: null, error: 'unauthenticated' }, { status: 401 });

  const merchantId = await resolveMerchantId(user.email);
  if (!merchantId) return NextResponse.json({ live: true, data: [], activated: false });

  const result = await getMerchantWebhookEndpoints(merchantId);
  return NextResponse.json({ ...result, activated: true });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const merchantId = await resolveMerchantId(user.email);
  if (!merchantId) {
    return NextResponse.json({ error: 'NotActivated', message: 'Activate FORGE Payments before registering a webhook.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const url = typeof body?.url === 'string' ? body.url : null;
  if (!url) return NextResponse.json({ error: 'ValidationError', message: 'url is required' }, { status: 400 });

  const result = await registerMerchantWebhook(merchantId, url);
  if (result.ok === true) return NextResponse.json({ data: result.endpoint }, { status: 201 });
  return NextResponse.json({ error: 'RegistrationFailed', message: result.error }, { status: 502 });
}
