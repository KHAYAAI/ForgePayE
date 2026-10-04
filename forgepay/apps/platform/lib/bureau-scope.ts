/**
 * Which part of the bureau register a console workspace may see.
 *
 * The console talks to the bureau with the admin key, so the bureau cannot
 * tell workspaces apart on its own. Every agent registered through the console
 * is tagged with the registering workspace (`managedBy`), and every read is
 * filtered by it. Only FORGE's own operator workspace, named in
 * FORGE_OPERATOR_TENANT_ID, sees the whole register and may resolve disputes,
 * which is the bureau's job as the data holder, not a customer's.
 */

export function isBureauOperator(tenantId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const op = env.FORGE_OPERATOR_TENANT_ID?.trim();
  return !!op && op === tenantId;
}

/** Query string fragment (`managedBy=...`) for a workspace, or '' for the operator. */
export function bureauScopeQuery(tenantId: string, env: NodeJS.ProcessEnv = process.env): string {
  return isBureauOperator(tenantId, env) ? '' : `managedBy=${encodeURIComponent(tenantId)}`;
}

/** Whether a workspace may see one agent's file. */
export function canSeeBureauAgent(
  tenantId: string,
  agent: { managedBy?: string } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!agent) return false;
  return isBureauOperator(tenantId, env) || agent.managedBy === tenantId;
}

export function withQuery(url: string, extra: string): string {
  if (!extra) return url;
  return url + (url.includes('?') ? '&' : '?') + extra;
}
