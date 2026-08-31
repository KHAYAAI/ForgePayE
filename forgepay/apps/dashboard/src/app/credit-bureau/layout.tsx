'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { label: 'OVERVIEW',     href: '/credit-bureau' },
  { label: 'AGENTS',       href: '/credit-bureau/agents' },
  { label: 'DISPUTES',     href: '/credit-bureau/disputes' },
  { label: 'LENDERS',      href: '/credit-bureau/lenders' },
];

export default function CreditBureauLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col h-full">
      {/* Sub-nav */}
      <div className="flex items-center gap-1 px-6 pt-4 pb-0 border-b border-[#1A1A1A]">
        {TABS.map(({ label, href }) => {
          const active = href === '/credit-bureau' ? pathname === href : pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'tab-pill pb-3 rounded-none border-b-2 border-transparent -mb-px',
                active ? 'active border-b-[#39D353] text-white' : 'border-b-transparent',
              )}
            >
              {label}
            </Link>
          );
        })}
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
