import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listEntitlements, activeProducts } from '@/lib/entitlements';
import { PRODUCTS } from '@/lib/products';

/**
 * Who the signed-in merchant is, and which platforms they hold.
 *
 * Backs `useCustomer()`, which drives the sidebar, ProductGate, and the
 * product-selection screen. Returns the catalog alongside the entitlements so
 * a single request can render both "what you have" and "what you could add" —
 * the selection screen needs both and they must agree.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [products, entitlements] = await Promise.all([
      activeProducts(session.user.id),
      listEntitlements(session.user.id),
    ]);

    return NextResponse.json({
      customer: {
        id:    session.user.id,
        email: session.user.email,
        name:  session.user.name ?? null,
        products,
        entitlements,
      },
      catalog: PRODUCTS,
    });
  } catch (err) {
    console.error('[customer] failed to resolve entitlements:', err);
    // Deliberately NOT falling back to "assume they have everything": a
    // database blip must not silently hand out products nobody paid for.
    return NextResponse.json({ error: 'Failed to load account' }, { status: 500 });
  }
}
