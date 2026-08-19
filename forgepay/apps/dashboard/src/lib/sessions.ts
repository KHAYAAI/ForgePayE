import { randomUUID } from 'node:crypto';
import { query, queryOne, execute } from './db';

export interface SessionRow {
  id: string;
  merchant_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at: Date;
  ip_address: string | null;
  user_agent: string | null;
}

export interface SessionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession(
  merchantId: string,
  ctx: SessionContext = {},
): Promise<{ sessionId: string }> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await query(
    `INSERT INTO sessions (id, merchant_id, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, merchantId, expiresAt, ctx.ipAddress ?? null, ctx.userAgent ?? null],
  );

  return { sessionId };
}

export async function getValidSession(sessionId: string): Promise<SessionRow | null> {
  const session = await queryOne<SessionRow>(
    `SELECT * FROM sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [sessionId],
  );
  if (!session) return null;

  void execute(`UPDATE sessions SET last_seen_at = NOW() WHERE id = $1`, [sessionId]).catch((err) =>
    console.error('[sessions] failed to touch session last_seen_at:', err),
  );

  return session;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await execute(`UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
}

export async function revokeAllSessions(merchantId: string, exceptSessionId?: string): Promise<number> {
  if (exceptSessionId) {
    return execute(
      `UPDATE sessions SET revoked_at = NOW() WHERE merchant_id = $1 AND id != $2 AND revoked_at IS NULL`,
      [merchantId, exceptSessionId],
    );
  }
  return execute(`UPDATE sessions SET revoked_at = NOW() WHERE merchant_id = $1 AND revoked_at IS NULL`, [merchantId]);
}

export async function listActiveSessions(merchantId: string): Promise<SessionRow[]> {
  return query<SessionRow>(
    `SELECT * FROM sessions WHERE merchant_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY last_seen_at DESC`,
    [merchantId],
  );
}

export async function getSessionById(sessionId: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>(`SELECT * FROM sessions WHERE id = $1`, [sessionId]);
}
