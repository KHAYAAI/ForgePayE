import { redirect } from 'next/navigation';
import { getCurrentUser } from './auth';
import { query, queryOne } from './db';
import { productOpenTo } from './launch-gate';

/** This tenant's console-native product selection — separate from unified-router's billing entitlements. See lib/schema.sql. */
export async function getEnabledProducts(tenantId: string): Promise<string[]> {
  const row = await queryOne<{ enabled_products: string[] }>(
    `SELECT enabled_products FROM tenants WHERE id = $1`,
    [tenantId],
  );
  // A product that has not launched (or for which this workspace is not a design partner) is never enabled, even if
  // it was selected before: the layout, the product guards and every product API read this list.
  return (row?.enabled_products ?? []).filter((p) => productOpenTo(p, tenantId));
}

export async function setEnabledProducts(tenantId: string, products: string[]): Promise<string[]> {
  const deduped = Array.from(new Set(products));
  await query(
    `UPDATE tenants SET enabled_products = $1 WHERE id = $2`,
    [deduped, tenantId],
  );
  return deduped;
}

/**
 * Server-component guard for a product's entry layout/page: redirects to
 * /dashboard/products if the signed-in tenant hasn't turned this product on.
 * Defense in depth — the sidebar already hides the link, but a bookmarked
 * or typed URL must not reach a platform the tenant never enabled.
 */
export async function requireProduct(catalogKey: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  const enabled = await getEnabledProducts(user!.tenantId);
  if (!enabled.includes(catalogKey)) redirect('/dashboard/products');
}
