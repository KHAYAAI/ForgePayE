import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

interface TeamMemberRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  created_at: string;
}

/** This tenant's real team roster — used by Analytics and Admin/CSM. */
export async function GET() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const members = await query<TeamMemberRow>(
    `SELECT id, email, name, role, status, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at ASC`,
    [session.tenantId],
  );

  return NextResponse.json({
    data: members.map((m) => ({
      id: m.id, email: m.email, name: m.name, role: m.role, status: m.status, createdAt: m.created_at,
    })),
  });
}
