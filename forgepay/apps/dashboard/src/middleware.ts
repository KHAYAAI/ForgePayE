import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Route guard.
 *
 * Everything not explicitly excluded below requires a session — including the
 * API, where most routes still depend on this check rather than
 * authenticating for themselves (api-keys/rotate and the treasury routes
 * among them), so the matcher must keep covering `api/`.
 *
 * What differs by route type is the *answer* to an unauthenticated request.
 * next-auth/middleware's default is to redirect everything to /login, which
 * hands a fetch() an HTML login page: the caller's res.json() then throws a
 * parse error instead of seeing a status it can act on, and a session that
 * expired while a page was open surfaces as an unexplained failure. So API
 * routes get a 401 they can read, and page requests get the redirect.
 */
export async function middleware(req: NextRequest) {
  const token = await getToken({ req });
  if (token) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const login = new URL('/login', req.url);
  // Preserve where they were headed so login can send them back.
  login.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  // Protect all routes except login, signup, Next.js internals, and the auth
  // API itself — which covers /api/auth/[...nextauth], /api/auth/signup, and
  // the /api/auth/sso/* handshake, all of which must work signed-out.
  matcher: ['/((?!login|signup|_next/static|_next/image|favicon\\.ico|api/auth).*)'],
};
