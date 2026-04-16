/**
 * ARCH: Merchant Dashboard — protected route group layout
 * ──────────────────────────────────────────────────────────────────────────────
 * All pages under (dashboard)/ render inside this layout: Sidebar + TopBar + main.
 *
 * Data flow:
 *   Browser → Next.js API routes (src/app/api/) → server-side fetch to:
 *     - payment-engine (Hyperswitch) via lib/hyperswitch-server.ts
 *     - billing-engine (Kill Bill)   via lib/killbill-server.ts
 *   API key is NEVER sent to the browser — injected server-side via lib/session.ts.
 *
 * Implemented pages:
 *   /             Overview   (StatCards + RevenueChart + RecentPayments)
 *   /payments     Payments   (PaymentsTable with filter pills)
 *   /subscriptions Subscriptions (Kill Bill subscription list)
 *   /api-keys     API Keys   (key management UI — backend not yet wired)
 *
 * LAUNCH BLOCKER: 4 sidebar pages are linked but return 404 (no page.tsx):
 *   /analytics    ← needs revenue/conversion analytics from Hyperswitch
 *   /tax          ← needs tax remittance data from MoR layer
 *   /webhooks     ← needs webhook endpoint CRUD and delivery log
 *   /settings     ← needs merchant profile + notification preferences
 *
 * LAUNCH BLOCKER: This layout has NO authentication guard. Any unauthenticated
 *   user can access all dashboard routes directly. To fix:
 *   1. Wire next-auth in src/app/api/auth/[...nextauth]/route.ts
 *   2. Add middleware.ts at the src/ root:
 *      export { default } from 'next-auth/middleware';
 *      export const config = { matcher: ['/((?!login|_next|api/auth).*)'] };
 *   3. Replace the sleep() in LoginForm.tsx with signIn('credentials', ...).
 */

import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-navy-800 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
