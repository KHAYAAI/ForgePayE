'use client';

import { useMemo, useState } from 'react';
import {
  PageHeader,
  Panel,
  DataTable,
  LivePill,
  Mono,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   FORGE Payments — Transactions.
   The real event log behind Payments Overview (same /api/forge/payments
   data), with a client-side product filter. A fresh account with no
   checkout completed sees a real empty log, not illustrative traffic.
   ──────────────────────────────────────────────────────────────── */

interface RecentEvent {
  id: string;
  product: string;
  eventType: string;
  amountUsdCents: number;
  currency: string;
  occurredAt: string;
}

interface MerchantSummary {
  activated: boolean;
  recentEvents: RecentEvent[];
}

const EMPTY: MerchantSummary = { activated: false, recentEvents: [] };

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PaymentsTransactions() {
  const { data, live } = useForge<MerchantSummary>('payments', EMPTY);
  const [product, setProduct] = useState('all');

  const products = useMemo(
    () => ['all', ...Array.from(new Set(data.recentEvents.map((e) => e.product)))],
    [data.recentEvents],
  );
  const rows = useMemo(
    () => (product === 'all' ? data.recentEvents : data.recentEvents.filter((e) => e.product === product)),
    [data.recentEvents, product],
  );

  const filterBtn = (active: boolean): React.CSSProperties => ({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    padding: '7px 11px',
    border: '1px solid',
    borderColor: active ? 'var(--ink)' : 'var(--hair)',
    background: active ? 'var(--ink)' : 'transparent',
    color: active ? 'var(--paper)' : 'var(--steel)',
    cursor: 'pointer',
  });

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Payments / Transactions"
        title={
          <>
            The payment <em>log</em>
          </>
        }
        lede="Every event recorded against your account in the Revenue Ontology."
        actions={<LivePill live={live} />}
      />

      {products.length > 1 && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <span className="mono" style={{ marginRight: 4 }}>product</span>
            {products.map((p) => (
              <button key={p} style={filterBtn(product === p)} onClick={() => setProduct(p)}>{p}</button>
            ))}
          </div>
        </div>
      )}

      <Panel title="Transactions" label={`${rows.length} of ${data.recentEvents.length}`}>
        <DataTable
          columns={['Event', 'Product', 'Amount', 'When']}
          emptyMessage={data.activated ? 'No events recorded yet.' : 'Activate FORGE Payments to start recording events.'}
          rows={rows.map((e) => [
            <Mono key="id">{e.id}</Mono>,
            e.product,
            <Mono key="a">{usd(e.amountUsdCents)} {e.currency}</Mono>,
            <Mono key="w">{new Date(e.occurredAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Mono>,
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          A failed payment is never silent: the fallback chain retries card → ACH → USDC before a
          failure surfaces here, and every attempt is recorded as its own ontology event.
        </p>
      </Panel>
    </>
  );
}
