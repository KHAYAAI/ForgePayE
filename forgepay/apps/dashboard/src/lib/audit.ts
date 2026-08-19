import { query } from './db';

export type AuditAction =
  | 'auth.login_success'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.signup'
  | 'mfa.enrolled'
  | 'mfa.disabled'
  | 'mfa.challenge_failed'
  | 'session.revoked'
  | 'session.revoked_all';

export interface AuditEventInput {
  merchantId?: string | null;
  actorMerchantId?: string | null;
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
         (merchant_id, actor_merchant_id, actor_email, action, resource, detail, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.merchantId ?? null,
        event.actorMerchantId ?? null,
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
  merchant_id: string | null;
  actor_merchant_id: string | null;
  actor_email: string | null;
  action: string;
  resource: string | null;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export async function listAuditLog(
  merchantId: string,
  { limit = 50, before }: { limit?: number; before?: string } = {},
): Promise<AuditLogRow[]> {
  const cappedLimit = Math.min(Math.max(limit, 1), 200);
  if (before) {
    return query<AuditLogRow>(
      `SELECT * FROM audit_log WHERE merchant_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3`,
      [merchantId, before, cappedLimit],
    );
  }
  return query<AuditLogRow>(
    `SELECT * FROM audit_log WHERE merchant_id = $1 ORDER BY id DESC LIMIT $2`,
    [merchantId, cappedLimit],
  );
}

export function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}
