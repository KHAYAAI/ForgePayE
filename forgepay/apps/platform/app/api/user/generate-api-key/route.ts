import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, generateApiKey } from '@/lib/auth';
import { sendApiKeyEmail } from '@/lib/email';
import { queryOne } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const newApiKey = await generateApiKey(user.userId);

    // Send email notification
    const userData = await queryOne(
      `SELECT email FROM users WHERE id = $1`,
      [user.userId]
    );

    if (userData) {
      await sendApiKeyEmail(userData.email, newApiKey);
    }

    return NextResponse.json({
      success: true,
      apiKey: newApiKey,
      message: 'API key generated and sent to your email',
    });
  } catch (error) {
    console.error('Generate API key error:', error);
    return NextResponse.json(
      { error: 'Failed to generate API key' },
      { status: 500 }
    );
  }
}
