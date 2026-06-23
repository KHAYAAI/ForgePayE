import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  // Generate a new API key: fp_live_<32 hex chars>
  const newKey = `fp_live_${crypto.randomUUID().replace(/-/g, '')}`;
  const rotatedAt = new Date().toISOString();

  // In production this would:
  //   1. Invalidate the old key in Hyperswitch via DELETE /api-keys/:merchant_id/:key_id
  //   2. Create a new key via POST /api-keys/:merchant_id
  //   3. Store the mapping in the merchant's record
  // For dev/without DB we return the generated key directly.

  return NextResponse.json({ apiKey: newKey, rotatedAt }, { status: 200 });
}
