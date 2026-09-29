import { NextResponse } from 'next/server';
import { getCurrentUser, getUserById } from '@/lib/auth';

/**
 * The current user's own API key — masked, since the raw value is only ever
 * shown once (at signup or rotation, emailed via sendApiKeyEmail). Rotation
 * itself is POST /api/user/generate-api-key.
 */
export async function GET() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    data: {
      id: `${user.api_key.slice(0, 8)}…${user.api_key.slice(-4)}`,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    },
  });
}
