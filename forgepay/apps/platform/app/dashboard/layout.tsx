import { ReactNode } from 'react';
import styles from './dashboard.module.css';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';

/**
 * FORGE console shell.
 *
 * One interconnected surface for every FORGE platform:
 * Payments, Custody (institutional signing), Wallet (consumer/agent),
 * Agent Credit Bureau, Enterprise Treasury, merchant Credit Bureau,
 * plus operations and analytics.
 *
 * Server component: reads the session so navigation is role-aware. The
 * route itself is already guarded by middleware.ts — this only tailors
 * which controls are shown.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  const role = user?.role;
  return (
    <div className={styles.dashboardContainer}>
      <header className={styles.topbar}>
        <div className={styles.topbarRow}>
          <Link href="/dashboard" className={styles.wordmark}>
            FORGE<span>The Revenue Ontology</span>
          </Link>
          <div className={styles.topbarStatus}>
            <span><span className="dot" />All systems operational</span>
            <span>UTC {new Date().toISOString().slice(11, 16)}</span>
          </div>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <nav className={styles.nav}>
            <div className={styles.navSection}>
              <h3>Ontology</h3>
              <Link href="/dashboard" className={styles.navItem}>
                Unified Overview
              </Link>
            </div>

            <div className={styles.navSection}>
              <h3>Platforms</h3>
              <Link href="/dashboard/payments" className={styles.navItem}>
                Payments
              </Link>
              <Link href="/dashboard/custody" className={styles.navItem}>
                Custody<span className={styles.navTag}>MPC</span>
              </Link>
              <Link href="/dashboard/wallet" className={styles.navItem}>
                Wallet<span className={styles.navTag}>DID</span>
              </Link>
              <Link href="/dashboard/agent-credit-bureau" className={styles.navItem}>
                Agent Credit Bureau
              </Link>
              <Link href="/dashboard/enterprise-treasury" className={styles.navItem}>
                Enterprise Treasury
              </Link>
            </div>

            <div className={styles.navSection}>
              <h3>Merchant Products</h3>
              <Link href="/dashboard/treasury" className={styles.navItem}>
                Merchant Treasury
              </Link>
              <Link href="/dashboard/credit-bureau" className={styles.navItem}>
                Credit Bureau<span className={styles.navTag}>Dual</span>
              </Link>
            </div>

            <div className={styles.navSection}>
              <h3>Operations</h3>
              <Link href="/dashboard/ops" className={styles.navItem}>
                System Health
              </Link>
              <Link href="/dashboard/analytics" className={styles.navItem}>
                Analytics
              </Link>
              {can(role, 'manage:team') && (
                <Link href="/dashboard/admin" className={styles.navItem}>
                  Admin / CSM
                </Link>
              )}
            </div>

            <div className={styles.navSection}>
              <h3>Account</h3>
              <Link href="/dashboard/settings" className={styles.navItem}>
                Settings<span className={styles.navTag}>2FA</span>
              </Link>
              {can(role, 'manage:api_keys') && (
                <Link href="/dashboard/api-keys" className={styles.navItem}>
                  API Keys
                </Link>
              )}
              {can(role, 'view:audit') && (
                <Link href="/dashboard/audit" className={styles.navItem}>
                  Audit Log
                </Link>
              )}
              <Link href="/api/auth/logout" className={styles.navItem}>
                Logout
              </Link>
            </div>
          </nav>

          {user && (
            <div className={styles.navUser}>
              <div className={styles.navUserName}>{user.email}</div>
              <div className={styles.navUserRole}>{role}</div>
            </div>
          )}
        </aside>

        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
