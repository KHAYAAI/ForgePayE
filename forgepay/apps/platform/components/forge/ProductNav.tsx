'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* ────────────────────────────────────────────────────────────────
   ProductNav — per-product sub-navigation.
   Each FORGE product is a standalone console with its own pages;
   this tab rail sits under the product header on every page of
   that product. Editorial style: mono uppercase, ink underline.
   ──────────────────────────────────────────────────────────────── */

export interface ProductNavItem {
  href: string;    // absolute route, e.g. /dashboard/payments/transactions
  label: string;
}

export function ProductNav({ product, items }: { product: string; items: ProductNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={`${product} navigation`}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 4,
        borderBottom: '1px solid var(--hair)',
        marginBottom: 26,
        overflowX: 'auto',
      }}
    >
      <span
        className="mono"
        style={{ marginRight: 14, whiteSpace: 'nowrap', color: 'var(--ink)', fontWeight: 700 }}
      >
        {product}
      </span>
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href.split('/').length > 3 && pathname?.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              letterSpacing: 1.6,
              textTransform: 'uppercase',
              padding: '10px 13px',
              whiteSpace: 'nowrap',
              color: active ? 'var(--ink)' : 'var(--steel)',
              borderBottom: active ? '2px solid var(--ink)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
