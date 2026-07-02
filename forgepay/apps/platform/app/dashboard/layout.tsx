import { ReactNode } from 'react';
import styles from './dashboard.module.css';
import Link from 'next/link';

/**
 * FORGE console shell.
 *
 * One interconnected surface for every FORGE platform:
 * Payments, Custody (institutional signing), Wallet (consumer/agent),
 * Agent Credit Bureau, Enterprise Treasury, merchant Credit Bureau,
 * plus operations and analytics.
 */
export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
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
                Credit Bureau
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
              <Link href="/dashboard/admin" className={styles.navItem}>
                Admin / CSM
              </Link>
            </div>

            <div className={styles.navSection}>
              <h3>Account</h3>
              <Link href="/dashboard/settings" className={styles.navItem}>
                Settings
              </Link>
              <Link href="/dashboard/api-keys" className={styles.navItem}>
                API Keys
              </Link>
              <Link href="/auth/logout" className={styles.navItem}>
                Logout
              </Link>
            </div>
          </nav>
        </aside>

        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
