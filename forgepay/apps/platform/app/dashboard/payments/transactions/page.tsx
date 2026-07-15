'use client';

import { useMemo, useState } from 'react';
import {
  PageHeader,
  Panel,
  Pill,
  DataTable,
  Mono,
  Addr,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Payments — Transactions.
   Full payment log with status/method filters and the routing
   path each payment actually took (including fallbacks).
   ──────────────────────────────────────────────────────────────── */

type Tx = {
  id: string;
  merchant: string;
  amount: string;
  method: 'card' | 'bank' | 'usdc' | 'crypto';
  route: string;
  status: 'confirmed' | 'processing' | 'failed' | 'refunded' | 'disputed';
  fee: string;
  at: string;
};

const TXS: Tx[] = [
  { id: 'pay_9f31', merchant: 'SnapPay', amount: 'R2,500', method: 'card', route: 'visa → acquirer', status: 'confirmed', fee: 'R55.20', at: '2 min' },
  { id: 'pay_9f2e', merchant: 'Umuntu Group', amount: 'R5,000', method: 'bank', route: 'EFT direct', status: 'confirmed', fee: 'R110.20', at: '5 min' },
  { id: 'pay_9f2b', merchant: 'AfroBiz Lending', amount: 'R1,200', method: 'card', route: 'card → ACH (fallback)', status: 'processing', fee: '—', at: '12 min' },
  { id: 'pay_9f27', merchant: 'ComputeRent', amount: 'R3,800', method: 'usdc', route: 'polygon · 12 blocks', status: 'confirmed', fee: 'R30.40 + gas', at: '15 min' },
  { id: 'pay_9f22', merchant: 'SnapPay', amount: 'R12,400', method: 'card', route: 'visa → acquirer', status: 'disputed', fee: 'R273.00', at: '6 h' },
  { id: 'pay_9f1d', merchant: 'Kasi Markets', amount: 'R860', method: 'card', route: 'visa → acquirer', status: 'refunded', fee: 'reversed', at: '9 h' },
  { id: 'pay_9f15', merchant: 'ComputeRent', amount: 'R48,000', method: 'usdc', route: 'ethereum · 12 blocks', status: 'confirmed', fee: 'R384 + gas', at: '11 h' },
  { id: 'pay_9f09', merchant: 'Umuntu Group', amount: 'R2,200', method: 'card', route: 'card → ACH → USDC (2 fallbacks)', status: 'confirmed', fee: 'R48.60', at: '14 h' },
  { id: 'pay_9efe', merchant: 'AfroBiz Lending', amount: 'R990', method: 'bank', route: 'EFT direct', status: 'failed', fee: '—', at: '19 h' },
];

const STATUS_TONE: Record<Tx['status'], 'ok' | 'warn' | 'danger' | 'accent'> = {
  confirmed: 'ok',
  processing: 'warn',
  failed: 'danger',
  refunded: 'accent',
  disputed: 'danger',
};

const STATUSES = ['all', 'confirmed', 'processing', 'failed', 'refunded', 'disputed'] as const;
const METHODS = ['all', 'card', 'bank', 'usdc', 'crypto'] as const;

export default function PaymentsTransactions() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [method, setMethod] = useState<(typeof METHODS)[number]>('all');

  const rows = useMemo(
    () =>
      TXS.filter((t) => (status === 'all' || t.status === status) && (method === 'all' || t.method === method)),
    [status, method],
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
        lede="Every payment with the route it actually took — fallbacks included. Click-through to refund, retry or escalate to a dispute."
      />

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span className="mono" style={{ marginRight: 4 }}>status</span>
          {STATUSES.map((s) => (
            <button key={s} style={filterBtn(status === s)} onClick={() => setStatus(s)}>{s}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span className="mono" style={{ marginRight: 4 }}>method</span>
          {METHODS.map((m) => (
            <button key={m} style={filterBtn(method === m)} onClick={() => setMethod(m)}>{m}</button>
          ))}
        </div>
      </div>

      <Panel title="Transactions" label={`${rows.length} of ${TXS.length} · trailing 24h`}>
        <DataTable
          columns={['Payment', 'Merchant', 'Amount', 'Method', 'Route taken', 'FORGE fee', 'Status', 'Age']}
          rows={rows.map((t) => [
            <Mono key="id">{t.id}</Mono>,
            t.merchant,
            <Mono key="a">{t.amount}</Mono>,
            <Mono key="m">{t.method}</Mono>,
            <Addr key="r">{t.route}</Addr>,
            <Mono key="f">{t.fee}</Mono>,
            <Pill key="s" tone={STATUS_TONE[t.status]}>{t.status}</Pill>,
            <Mono key="t">{t.at}</Mono>,
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
