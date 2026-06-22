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
  Bot,
  Users,
  TrendingUp,
  Vault,
  LineChart,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'Overview',      href: '/',              icon: LayoutDashboard, badge: null },
  { label: 'Payments',      href: '/payments',      icon: CreditCard,      badge: null },
  { label: 'Customers',     href: '/customers',     icon: Users,           badge: null },
  { label: 'Subscriptions', href: '/subscriptions', icon: RefreshCw,       badge: null },
  { label: 'Analytics',     href: '/analytics',     icon: BarChart3,       badge: null },
  { label: 'RWA',           href: '/rwa',           icon: TrendingUp,      badge: 'New' },
  { label: 'Treasury',      href: '/treasury',      icon: Vault,           badge: null },
  { label: 'Credit Bureau', href: '/credit-bureau', icon: LineChart,       badge: null },
  { label: 'Tax & MoR',     href: '/tax',           icon: Globe,           badge: null },
  { label: 'Webhooks',      href: '/webhooks',      icon: Webhook,         badge: null },
  { label: 'API Keys',      href: '/api-keys',      icon: Key,             badge: null },
  { label: 'Forge Agent',   href: '/agent',         icon: Bot,             badge: 'Beta' },
  { label: 'Settings',      href: '/settings',      icon: Settings,        badge: null },
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
        {NAV_ITEMS.map(({ label, href, icon: Icon, badge }) => {
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
              <span className="flex-1">{label}</span>
              {badge && (
                <span className="rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-400">
                  {badge}
                </span>
              )}
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
