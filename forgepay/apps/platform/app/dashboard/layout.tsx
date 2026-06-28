import { ReactNode } from 'react';
import styles from './dashboard.module.css';
import Link from 'next/link';

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className={styles.dashboardContainer}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          Forge<span>Pay</span>
        </div>

        <nav className={styles.nav}>
          <div className={styles.navSection}>
            <h3>Products</h3>
            <Link href="/dashboard/payments" className={styles.navItem}>
              💳 Payments
            </Link>
            <Link href="/dashboard/treasury" className={styles.navItem}>
              💰 Treasury
            </Link>
            <Link href="/dashboard/credit-bureau" className={styles.navItem}>
              📊 Credit Bureau
            </Link>
          </div>

          <div className={styles.navSection}>
            <h3>Operations</h3>
            <Link href="/dashboard/ops" className={styles.navItem}>
              🚨 Operations
            </Link>
            <Link href="/dashboard/analytics" className={styles.navItem}>
              📈 Analytics
            </Link>
          </div>

          <div className={styles.navSection}>
            <h3>Account</h3>
            <Link href="/dashboard/settings" className={styles.navItem}>
              ⚙️ Settings
            </Link>
            <Link href="/dashboard/api-keys" className={styles.navItem}>
              🔑 API Keys
            </Link>
            <Link href="/auth/logout" className={styles.navItem}>
              🚪 Logout
            </Link>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
