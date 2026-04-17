export { default } from 'next-auth/middleware';

export const config = {
  // Protect all routes except login, signup, Next.js internals, and the auth API itself.
  matcher: ['/((?!login|signup|_next/static|_next/image|favicon\\.ico|api/auth).*)'],
};
