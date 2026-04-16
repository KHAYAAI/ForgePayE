'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  CreditCard,
  BarChart3,
  Key,
  Settings,
  RefreshCw,
  Globe,
  Webhook,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'Overview',      href: '/',              icon: LayoutDashboard },
  { label: 'Payments',      href: '/payments',      icon: CreditCard },
  { label: 'Subscriptions', href: '/subscriptions', icon: RefreshCw },
  { label: 'Analytics',     href: '/analytics',     icon: BarChart3 },
  { label: 'Tax & MoR',     href: '/tax',           icon: Globe },
  { label: 'Webhooks',      href: '/webhooks',      icon: Webhook },
  { label: 'API Keys',      href: '/api-keys',      icon: Key },
  { label: 'Settings',      href: '/settings',      icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[var(--sidebar-width)] flex flex-col bg-surface-900 border-r border-white/[0.07] shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/[0.07]">
        <Zap size={18} className="text-cyan-500" />
        <span className="font-bold text-white text-sm">ForgePay</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-cyan-500/10 text-cyan-400'
                  : 'text-gray-400 hover:text-white hover:bg-white/[0.04]',
              )}
            >
              <Icon size={15} className={active ? 'text-cyan-400' : ''} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom — merchant switcher placeholder */}
      <div className="px-3 py-4 border-t border-white/[0.07]">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] cursor-pointer">
          <div className="w-6 h-6 rounded bg-cyan-500/20 flex items-center justify-center">
            <span className="text-[10px] font-bold text-cyan-400">AC</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-white truncate">Acme Corp</div>
            <div className="text-[10px] text-gray-500">Growth Plan</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
