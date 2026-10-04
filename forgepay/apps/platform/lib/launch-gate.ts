/**
 * Which products a workspace may use at all, whatever it has selected.
 *
 * Products launch one at a time. Until a product is cleared to launch (reviewed, licensed where it needs to be, run on real
 * infrastructure), no tenant can switch it on, and a tenant that switched it on earlier stops seeing it.
 *
 *   FORGE_LAUNCHED_PRODUCTS=credit-bureau            products open to every workspace (comma-separated catalog keys)
 *   FORGE_DESIGN_PARTNERS_CUSTODY=<tenantId>,...     workspaces admitted to the custody pilot before custody launches
 *
 * In production, when FORGE_LAUNCHED_PRODUCTS is unset, only the credit bureau is open. Elsewhere everything is open, as before.
 * Payments, treasury and wallet are deliberately not launchable until licensing and their money paths are rebuilt
 * (docs/PLATFORM_REPORT_2026-10-04.md); this switch is where that decision is enforced.
 */
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function launchedProducts(env: NodeJS.ProcessEnv = process.env): Set<string> | 'all' {
  const raw = env.FORGE_LAUNCHED_PRODUCTS;
  if (raw === undefined || raw.trim() === '') return env.NODE_ENV === 'production' ? new Set(['credit-bureau']) : 'all';
  return new Set(list(raw));
}

export function productOpenTo(product: string, tenantId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const launched = launchedProducts(env);
  if (launched === 'all' || launched.has(product)) return true;
  if (product === 'custody' && list(env.FORGE_DESIGN_PARTNERS_CUSTODY).includes(tenantId)) return true;
  return false;
}
