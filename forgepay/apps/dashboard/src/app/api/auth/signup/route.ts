import { NextRequest, NextResponse } from 'next/server';
import { createMerchant } from '@/lib/hyperswitch-server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json();

    // Validation
    if (!name || !email || !password || password.length < 8) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    // Step 1: Register merchant in mor-layer (gets mor_merchant_id, hashed password, stored)
    const MOR_URL = process.env['MOR_LAYER_URL'] ?? 'http://localhost:8010';
    const morResp = await fetch(`${MOR_URL}/v1/merchants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
      signal: AbortSignal.timeout(10_000),
    });

    if (morResp.status === 409) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }
    if (!morResp.ok) {
      return NextResponse.json({ error: 'Registration failed' }, { status: 502 });
    }
    const morMerchant = await morResp.json() as { merchant_id: string };

    // Step 2: Create Hyperswitch merchant account (get API key)
    let hsApiKey = '';
    let hsMerchantId = '';
    try {
      const hs = await createMerchant({ merchantName: name, email });
      hsApiKey = hs.apiKey;
      hsMerchantId = hs.merchantId;
    } catch (err) {
      // Non-fatal in dev — Hyperswitch may not be running
      console.warn('[onboarding] Hyperswitch merchant creation failed:', (err as Error).message);
      hsApiKey = `fp_dev_${Date.now().toString(36)}`;
      hsMerchantId = `mer_dev_${morMerchant.merchant_id}`;
    }

    // Step 3: Seed Kill Bill account (best-effort)
    const KB_URL = process.env['KILLBILL_URL'] ?? 'http://localhost:8020';
    const KB_KEY = process.env['KILLBILL_API_KEY'] ?? 'forgepay';
    const KB_SECRET = process.env['KILLBILL_API_SECRET'] ?? 'forgepay';
    const kbAuth = Buffer.from(`${KB_KEY}:${KB_SECRET}`).toString('base64');
    fetch(`${KB_URL}/1.0/kb/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${kbAuth}`,
        'X-Killbill-ApiKey': KB_KEY,
        'X-Killbill-ApiSecret': KB_SECRET,
        'X-Killbill-CreatedBy': 'dashboard-signup',
      },
      body: JSON.stringify({
        externalKey:    morMerchant.merchant_id,
        name,
        email,
        currency:       'USD',
        timeZone:       'UTC',
      }),
      signal: AbortSignal.timeout(8_000),
    }).catch(err => console.warn('[onboarding] Kill Bill account seed failed:', err.message));

    // Persist Hyperswitch API key back to mor-layer merchant record
    fetch(`${MOR_URL}/v1/merchants/${morMerchant.merchant_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env['INTERNAL_WEBHOOK_SECRET'] ?? '' },
      body: JSON.stringify({ hs_merchant_id: hsMerchantId, hs_api_key: hsApiKey }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      merchantId: morMerchant.merchant_id,
    }, { status: 201 });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
