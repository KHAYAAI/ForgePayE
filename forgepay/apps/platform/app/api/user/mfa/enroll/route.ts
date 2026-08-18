import { NextResponse } from 'next/server';
import { getCurrentUser, getUserById, setPendingTotpSecret } from '@/lib/auth';
import { generateTotpSecret, buildTotpUri, totpQrCodeDataUrl } from '@/lib/mfa';

/**
 * Start MFA enrollment: generate a fresh TOTP secret and return it as a QR
 * code (plus the raw secret for manual entry). Not yet enabled — the user
 * must prove they can generate a real code via POST /api/user/mfa/confirm
 * before totp_enabled flips on. Calling this again before confirming
 * discards the previous unconfirmed secret and starts over, which is fine:
 * nothing depended on it yet.
 */
export async function POST() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (user.totp_enabled) {
    return NextResponse.json({ error: 'MFA is already enabled. Disable it first to re-enroll.' }, { status: 409 });
  }

  const secret = generateTotpSecret();
  await setPendingTotpSecret(user.id, secret);

  const uri = buildTotpUri(user.email, secret);
  const qrCodeDataUrl = await totpQrCodeDataUrl(uri);

  return NextResponse.json({ secret, qrCodeDataUrl });
}
