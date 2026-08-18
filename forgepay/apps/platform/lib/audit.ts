import { query } from './db';

/**
 * Platform-wide audit trail. `rbac.ts` has had a `view:audit` permission
 * since before this file existed, with nothing behind it — this is what
 * backs it.
 *
 * A best-effort write: a failed audit-log insert must never break the
 * request it's describing (logging in should still work if, say, the audit
 * table briefly can't be reached) — logged to the server console instead so
 * the gap is at least visible operationally.
 */

export type AuditAction =
  | 'auth.login_success'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.sso_login_success'
  | 'auth.signup'
  | 'mfa.enrolled'
  | 'mfa.disabled'
  | 'mfa.challenge_failed'
  | 'session.revoked'
  | 'session.revoked_all'
  | 'user.role_changed'
  | 'user.api_key_rotated';

export interface AuditEventInput {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  resource?: string | null;
  detail?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function logAuditEvent(event: AuditEventInput): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, actor_email, action, resource, detail, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.tenantId ?? null,
        event.actorUserId ?? null,
        event.actorEmail ?? null,
        event.action,
        event.resource ?? null,
        event.detail ? JSON.stringify(event.detail) : null,
        event.ipAddress ?? null,
        event.userAgent ?? null,
      ],
    );
  } catch (err) {
    console.error('[audit] failed to record event (request proceeds regardless):', event.action, err);
  }
}

export interface AuditLogRow {
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  resource: string | null;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

/** Tenant-scoped page of recent audit entries — the query behind GET /api/audit. */
export async function listAuditLog(
  tenantId: string,
  { limit = 50, before }: { limit?: number; before?: string } = {},
): Promise<AuditLogRow[]> {
  const cappedLimit = Math.min(Math.max(limit, 1), 200);
  if (before) {
    return query<AuditLogRow>(
      `SELECT * FROM audit_log WHERE tenant_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3`,
      [tenantId, before, cappedLimit],
    );
  }
  return query<AuditLogRow>(
    `SELECT * FROM audit_log WHERE tenant_id = $1 ORDER BY id DESC LIMIT $2`,
    [tenantId, cappedLimit],
  );
}

/** Best-effort client IP from standard proxy headers (Vercel/most LBs set x-forwarded-for). */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}
