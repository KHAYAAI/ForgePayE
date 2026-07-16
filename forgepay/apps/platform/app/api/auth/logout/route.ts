import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth';

/** Clear the session cookie and bounce to the login screen. */
export async function GET(req: Request) {
  await clearAuthCookie();
  return NextResponse.redirect(new URL('/auth/login', req.url));
}

export async function POST() {
  await clearAuthCookie();
  return NextResponse.json({ success: true });
}
