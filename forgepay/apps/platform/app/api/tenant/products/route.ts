import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getEnabledProducts, setEnabledProducts } from '@/lib/products';
import { getProductCatalog } from '@/lib/forge-services';
import { logAuditEvent, clientIp } from '@/lib/audit';

/** The real catalog (with availability) plus this tenant's current selection. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [catalog, enabled] = await Promise.all([
    getProductCatalog(),
    getEnabledProducts(user.tenantId),
  ]);

  return NextResponse.json({
    live: catalog.live,
    catalog: catalog.data ?? [],
    enabled,
  });
}

/** Replace the tenant's product selection. Only 'available' products can be turned on. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const requested: unknown = body?.products;
  if (!Array.isArray(requested) || !requested.every((p) => typeof p === 'string')) {
    return NextResponse.json({ error: 'ValidationError', message: 'products must be a string array' }, { status: 400 });
  }

  const catalog = await getProductCatalog();
  if (!catalog.live || !catalog.data) {
    return NextResponse.json({ error: 'CatalogUnavailable', message: 'Could not reach the product catalog. Try again shortly.' }, { status: 502 });
  }

  const availableKeys = new Set(catalog.data.filter((p) => p.availability === 'available').map((p) => p.key));
  const invalid = requested.filter((key) => !availableKeys.has(key));
  if (invalid.length > 0) {
    return NextResponse.json({
      error: 'NotAvailable',
      message: `Not available yet: ${invalid.join(', ')}. Only products marked "available" can be turned on.`,
    }, { status: 400 });
  }

  const enabled = await setEnabledProducts(user.tenantId, requested);

  await logAuditEvent({
    tenantId: user.tenantId, actorUserId: user.userId, actorEmail: user.email,
    action: 'tenant.products_updated', detail: { products: enabled },
    ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });

  return NextResponse.json({ enabled });
}
