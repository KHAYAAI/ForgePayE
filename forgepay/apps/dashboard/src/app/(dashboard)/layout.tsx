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
 *   /             Overview       (StatCards + RevenueChart + RecentPayments)
 *   /payments     Payments       (PaymentsTable with cursor pagination)
 *   /subscriptions Subscriptions (Kill Bill subscription list)
 *   /api-keys     API Keys       (key management UI)
 *   /analytics    Analytics      (AreaChart + BarChart via /api/analytics/revenue)
 *   /tax          Tax            (jurisdiction table from MoR layer)
 *   /webhooks     Webhooks       (endpoint CRUD + delivery log)
 *   /settings     Settings       (merchant profile + notifications)
 *
 * Auth guard: middleware.ts at src/middleware.ts uses next-auth/middleware to
 *   redirect unauthenticated requests to /login. The CredentialsProvider validates
 *   against DASHBOARD_ADMIN_EMAIL / DASHBOARD_ADMIN_PASSWORD env vars and stores
 *   the Hyperswitch API key in the JWT so it never reaches the browser.
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
