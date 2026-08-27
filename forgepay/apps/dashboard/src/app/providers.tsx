'use client';

import { SessionProvider } from 'next-auth/react';

/**
 * Client-side session context.
 *
 * `useSession()` reads from React context, and next-auth only populates that
 * context beneath a <SessionProvider>. Without one anywhere in the tree, every
 * component that calls the hook throws at render — which is what the settings
 * page did: it has called `useSession()` since it was written, and the provider
 * was never added, so the page crashed the moment it was actually opened in a
 * browser rather than exercised through its API routes.
 *
 * Mounted at the root so both route groups get it: (dashboard) needs the
 * merchant's session for the sessions panel and profile fields, and (auth)
 * benefits from `useSession()` being safe to call on the login screen.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
