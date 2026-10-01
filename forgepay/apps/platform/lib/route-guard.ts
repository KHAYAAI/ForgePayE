import { NextResponse } from 'next/server';
import { getCurrentUser, type TokenPayload } from './auth';
import { getEnabledProducts } from './products';
import { can, type Permission } from './rbac';

/**
 * Gate for console API routes that call a backend service with the console's own service credential.
 * Those credentials are powerful and shared, so the route itself must establish who is asking: a missing
 * session is 401, a tenant that has not enabled the product is 403, a role without the permission is 403.
 * (Defense in depth with the page-level requireProduct redirect; an API route is reachable without a page.)
 */
export async function guardRoute(opts: { product?: string; permission?: Permission } = {}): Promise<{ user: TokenPayload } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ live: false, data: null, error: 'unauthenticated' }, { status: 401 }) };
  if (opts.permission && !can(user.role, opts.permission)) {
    return { response: NextResponse.json({ live: false, data: null, error: 'forbidden' }, { status: 403 }) };
  }
  if (opts.product) {
    const enabled = await getEnabledProducts(user.tenantId);
    if (!enabled.includes(opts.product)) {
      return { response: NextResponse.json({ live: false, data: null, error: 'product not enabled for this workspace' }, { status: 403 }) };
    }
  }
  return { user };
}
