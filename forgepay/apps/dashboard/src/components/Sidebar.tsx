'use client';

import Link from 'next/link';
import { useCustomer } from '@/hooks/useCustomer';
import { usePathname } from 'next/navigation';

export function Sidebar() {
  const { customer } = useCustomer();
  const pathname = usePathname();
  const products = customer?.products || [];

  const isActive = (path: string) => pathname?.startsWith(path);

  return (
    <aside className="w-64 bg-gray-900 text-white h-full sticky top-0">
      <div className="p-6">
        <h1 className="text-2xl font-bold">ForgePay</h1>
      </div>

      <nav className="px-4 py-6 space-y-4">
        {/* Dashboard (always available) */}
        <div>
          <Link
            href="/dashboard"
            className={`block px-4 py-2 rounded transition ${
              isActive('/dashboard')
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:bg-gray-800'
            }`}
          >
            Dashboard
          </Link>
        </div>

        {/* Payments */}
        {products.includes('payments') && (
          <div className="border-t border-gray-700 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Payments</p>
            <Link
              href="/payments/charges"
              className={`block px-4 py-2 rounded transition text-sm ${
                isActive('/payments')
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              Charges
            </Link>
            <Link
              href="/payments/customers"
              className={`block px-4 py-2 rounded transition text-sm ${
                isActive('/payments/customers')
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              Customers
            </Link>
          </div>
        )}

        {/* Treasury */}
        {products.includes('treasury') && (
          <div className="border-t border-gray-700 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Treasury</p>
            <Link
              href="/treasury/positions"
              className={`block px-4 py-2 rounded transition text-sm ${
                isActive('/treasury')
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              Positions
            </Link>
            <Link
              href="/treasury/settlements"
              className={`block px-4 py-2 rounded transition text-sm ${
                isActive('/treasury/settlements')
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              Settlements
            </Link>
          </div>
        )}

        {/* Credit Bureau */}
        {products.includes('credit-bureau') && (
          <div className="border-t border-gray-700 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Credit Bureau</p>
            <Link
              href="/credit-bureau/agents"
              className={`block px-4 py-2 rounded transition text-sm ${
                isActive('/credit-bureau')
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              Agents
            </Link>
            <Link
              href="/credit-bureau/scores"
              className={`block px-4 py-2 rounded transition text-sm ${
                isActive('/credit-bureau/scores')
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              Scores
            </Link>
          </div>
        )}

        {/* Settings (always available) */}
        <div className="border-t border-gray-700 pt-4">
          <Link
            href="/settings"
            className={`block px-4 py-2 rounded transition text-sm ${
              isActive('/settings')
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:bg-gray-800'
            }`}
          >
            Settings
          </Link>
        </div>
      </nav>
    </aside>
  );
}
