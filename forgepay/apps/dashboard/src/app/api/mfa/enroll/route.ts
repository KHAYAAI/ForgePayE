import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { generateTotpSecret, buildTotpUri, totpQrCodeDataUrl, generateBackupCodes } from '@/lib/mfa';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const secret = generateTotpSecret();
    const uri = buildTotpUri(session.user.email, secret);
    const qrCode = await totpQrCodeDataUrl(uri);
    const { raw: backupCodes } = generateBackupCodes();

    return NextResponse.json({
      secret,
      qrCode,
      backupCodes,
      uri,
    });
  } catch (err) {
    console.error('[mfa] enrollment error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
