import { type NextRequest, NextResponse } from 'next/server';
import { getSessionApiKey, unauthorizedResponse, UnauthorizedError } from '@/lib/session';
import { refundPayment } from '@/lib/hyperswitch-server';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const apiKey = await getSessionApiKey();
    const { id } = await params;

    // NOTE: amount is optional — omitting it triggers a full refund in Hyperswitch.
    // Partial refunds require amount in the smallest currency unit (cents).
    // Example: { "amount": 2500 } refunds $25.00 of a $49.00 payment.
    // Multiple partial refunds are allowed up to the original payment total.
    let amount: number | undefined;
    try {
      const body = await req.json() as { amount?: number };
      if (typeof body.amount === 'number' && body.amount > 0) amount = body.amount;
    } catch {
      // No body or non-JSON → full refund
    }

    const data = await refundPayment(apiKey, id, amount);
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
