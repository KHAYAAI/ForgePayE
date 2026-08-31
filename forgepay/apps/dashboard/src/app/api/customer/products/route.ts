import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { grantProduct, cancelProduct, listEntitlements } from '@/lib/entitlements';
import { PRODUCT_BY_KEY, type ProductKey } from '@/lib/products';
import { logAuditEvent, clientIp } from '@/lib/audit';

/**
 * Activate or deactivate a platform for the signed-in merchant.
 *
 * This is the write side of the selection screen. It is deliberately the only
 * path that grants an entitlement, so every activation lands in the audit trail
 * and the revenue ontology in one place.
 */

const TRIAL_DAYS = 14;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let product: ProductKey | undefined;
  try {
    ({ product } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const meta = product ? PRODUCT_BY_KEY[product] : undefined;
  if (!meta) {
    return NextResponse.json({ error: 'Unknown product' }, { status: 400 });
  }

  // Availability is enforced here, not just hidden in the UI. 'private' means
  // gated on something we do not control yet — the payments licence — and a
  // merchant must not be able to self-activate it by posting the key directly.
  if (meta.availability === 'private' || meta.availability === 'retired') {
    return NextResponse.json(
      { error: 'unavailable', message: `${meta.name} is not open for self-service activation yet.` },
      { status: 403 },
    );
  }

  // A product whose dependencies are missing would activate into a broken
  // state, so the mesh edges declared in the catalog are checked before granting.
  if (meta.requires.length) {
    const held = new Set((await listEntitlements(session.user.id))
      .filter((e) => e.status === 'active' || e.status === 'trialing')
      .map((e) => e.product_key));
    const missing = meta.requires.filter((r) => !held.has(r));
    if (missing.length) {
      return NextResponse.json(
        { error: 'missing_dependency', missing,
          message: `${meta.name} also needs: ${missing.map((m) => PRODUCT_BY_KEY[m].name).join(', ')}.` },
        { status: 409 },
      );
    }
  }

  try {
    // Waitlisted platforms grant a trial so the merchant can evaluate them
    // while the service behind them is still being hardened.
    await grantProduct(session.user.id, product!, {
      trialDays: meta.availability === 'waitlist' ? TRIAL_DAYS : undefined,
    });

    await logAuditEvent({
      merchantId:      session.user.id,
      actorMerchantId: session.user.id,
      actorEmail:      session.user.email,
      action:          'auth.signup',
      resource:        product,
      detail:          { activatedProduct: product, availability: meta.availability },
      ipAddress:       clientIp(req),
      userAgent:       req.headers.get('user-agent'),
    });

    return NextResponse.json({ ok: true, product, entitlements: await listEntitlements(session.user.id) });
  } catch (err) {
    console.error('[products] activation failed:', err);
    return NextResponse.json({ error: 'Failed to activate product' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let product: ProductKey | undefined;
  try {
    ({ product } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!product || !PRODUCT_BY_KEY[product]) {
    return NextResponse.json({ error: 'Unknown product' }, { status: 400 });
  }

  try {
    await cancelProduct(session.user.id, product);
    return NextResponse.json({ ok: true, entitlements: await listEntitlements(session.user.id) });
  } catch (err) {
    console.error('[products] deactivation failed:', err);
    return NextResponse.json({ error: 'Failed to deactivate product' }, { status: 500 });
  }
}
