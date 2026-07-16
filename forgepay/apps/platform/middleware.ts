import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { can, requiredPermissionFor } from '@/lib/rbac';

/**
 * Console route guard.
 *
 * Every /dashboard/* route requires a valid session cookie; unauthenticated
 * requests are redirected to /auth/login?next=<path>. Routes with a stricter
 * permission (admin, api-keys) additionally check the user's role — an
 * authenticated but under-privileged user is bounced to the dashboard root.
 *
 * Runs on the edge runtime, so JWT verification uses `jose` (not the Node
 * `jsonwebtoken` used server-side) — both verify the same HS256 signature.
 */

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-key');

async function readSession(req: NextRequest): Promise<{ role?: string } | null> {
  const token = req.cookies.get('auth-token')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return { role: typeof payload.role === 'string' ? payload.role : undefined };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const session = await readSession(req);

  if (!session) {
    const login = new URL('/auth/login', req.url);
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  const permission = requiredPermissionFor(pathname);
  if (permission && !can(session.role, permission)) {
    const home = new URL('/dashboard', req.url);
    home.searchParams.set('denied', permission);
    return NextResponse.redirect(home);
  }

  return NextResponse.next();
}

export const config = {
  // Guard the whole console. Public marketing pages, /auth/*, api routes and
  // static assets are intentionally excluded.
  matcher: ['/dashboard/:path*'],
};
