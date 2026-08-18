import { NextResponse } from 'next/server';
import { getCurrentUser, listActiveSessions } from '@/lib/auth';

/** Active sessions for the current user — the "where you're signed in" panel. */
export async function GET() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sessions = await listActiveSessions(session.userId);
  return NextResponse.json({
    currentSessionId: session.jti,
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
      ipAddress: s.ip_address,
      userAgent: s.user_agent,
      current: s.id === session.jti,
    })),
  });
}
