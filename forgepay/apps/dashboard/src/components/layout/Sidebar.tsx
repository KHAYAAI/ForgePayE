'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CreditCard, BarChart3, Key, Settings,
  RefreshCw, Globe, Webhook, Bot, Users, TrendingUp,
  Vault, LineChart, Building2, Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/',              icon: LayoutDashboard, label: 'Overview' },
  { href: '/payments',      icon: CreditCard,      label: 'Payments' },
  { href: '/customers',     icon: Users,           label: 'Customers' },
  { href: '/analytics',     icon: BarChart3,       label: 'Analytics' },
  { href: '/credit-bureau', icon: LineChart,       label: 'Credit Bureau' },
  { href: '/treasury',      icon: Vault,           label: 'Treasury' },
  { href: '/rwa',           icon: TrendingUp,      label: 'RWA Assets' },
  { href: '/subscriptions', icon: RefreshCw,       label: 'Subscriptions' },
  { href: '/tax',           icon: Globe,           label: 'Tax & MoR' },
  { href: '/webhooks',      icon: Webhook,         label: 'Webhooks' },
  { href: '/api-keys',      icon: Key,             label: 'API Keys' },
  { href: '/agent',         icon: Bot,             label: 'Forge Agent' },
  { href: '/settings',      icon: Settings,        label: 'Settings' },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-16 flex flex-col items-center py-4 bg-[#0D0D0D] border-r border-[#1A1A1A] shrink-0 relative">
      {/* Logo — asterisk in mono */}
      <div className="mb-6 flex items-center justify-center w-10 h-10">
        <span className="text-white font-mono text-2xl font-bold select-none">✳</span>
      </div>

      {/* Nav pill container */}
      <div className="relative flex flex-col items-center gap-1 bg-[#111111] border border-[#1E1E1E] rounded-2xl px-2 py-3">
        {/* Connector line — top */}
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-px h-4 bg-[#39D353]/30" />

        {NAV.slice(0, 5).map(({ href, icon: Icon, label }) => {
          const active = href === '/' ? pathname === '/' : pathname?.startsWith(href);
          return (
            <div key={href} className="relative flex items-center">
              {/* Active indicator dot to the left */}
              {active && (
                <div className="absolute -left-4 w-1.5 h-1.5 rounded-full bg-[#39D353] shadow-[0_0_6px_#39D353]" />
              )}
              <Link
                href={href}
                title={label}
                className={cn(
                  'flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150',
                  active
                    ? 'bg-[#39D353]/10 text-[#39D353]'
                    : 'text-[#444] hover:text-[#888] hover:bg-[#1A1A1A]'
                )}
              >
                <Icon size={16} strokeWidth={active ? 2 : 1.5} />
              </Link>
            </div>
          );
        })}

        {/* Divider */}
        <div className="w-6 h-px bg-[#1E1E1E] my-1" />

        {NAV.slice(5).map(({ href, icon: Icon, label }) => {
          const active = href === '/' ? pathname === '/' : pathname?.startsWith(href);
          return (
            <div key={href} className="relative flex items-center">
              {active && (
                <div className="absolute -left-4 w-1.5 h-1.5 rounded-full bg-[#39D353] shadow-[0_0_6px_#39D353]" />
              )}
              <Link
                href={href}
                title={label}
                className={cn(
                  'flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150',
                  active
                    ? 'bg-[#39D353]/10 text-[#39D353]'
                    : 'text-[#444] hover:text-[#888] hover:bg-[#1A1A1A]'
                )}
              >
                <Icon size={16} strokeWidth={active ? 2 : 1.5} />
              </Link>
            </div>
          );
        })}

        {/* Connector line — bottom */}
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-px h-4 bg-[#39D353]/30" />
      </div>

      {/* Status dot at bottom */}
      <div className="mt-auto mb-2">
        <div className="w-9 h-9 rounded-full bg-[#111] border border-[#1E1E1E] flex items-center justify-center">
          <Activity size={14} className="text-[#39D353]" />
        </div>
      </div>
    </aside>
  );
}
