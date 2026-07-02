'use client';

import { ReactNode } from 'react';

/* ────────────────────────────────────────────────────────────────
   FORGE UI primitives — editorial paper/ink design system.
   Every dashboard screen composes these; no screen-local styling
   beyond layout grids.
   ──────────────────────────────────────────────────────────────── */

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="mono" style={{ marginBottom: 10 }}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 24,
        flexWrap: 'wrap',
        padding: '34px 0 26px',
        borderBottom: '1px solid var(--ink)',
        marginBottom: 28,
      }}
    >
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="forge-h1">{title}</h1>
        {lede && <p className="lede" style={{ marginTop: 14 }}>{lede}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{actions}</div>}
    </header>
  );
}

export function Stat({
  label,
  value,
  delta,
  deltaTone,
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  deltaTone?: 'up' | 'down';
}) {
  return (
    <div className="stat">
      <div className="mono">{label}</div>
      <div>
        <div className="value">{value}</div>
        {delta && <div className={`delta ${deltaTone ?? ''}`}>{delta}</div>}
      </div>
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid" style={{ marginBottom: 28 }}>{children}</div>;
}

export function Panel({
  title,
  label,
  actions,
  children,
  ink,
  deep,
  style,
}: {
  title: string;
  label?: string;
  actions?: ReactNode;
  children: ReactNode;
  ink?: boolean;
  deep?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`panel ${ink ? 'ink' : ''} ${deep ? 'deep' : ''}`} style={style}>
      <div className="panel-head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <h2 className="forge-h2" style={{ fontSize: 17 }}>{title}</h2>
          {label && <span className="mono">{label}</span>}
        </div>
        {actions}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Pill({
  tone,
  children,
}: {
  tone?: 'ok' | 'warn' | 'danger' | 'ink' | 'accent';
  children: ReactNode;
}) {
  return <span className={`pill ${tone ?? ''}`}>{children}</span>;
}

export function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="forge-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Meter({ pct, accent }: { pct: number; accent?: boolean }) {
  return (
    <div className={`meter ${accent ? 'accent' : ''}`} style={{ width: 120 }}>
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="num">{children}</span>;
}

export function Addr({ children }: { children: ReactNode }) {
  return <span className="addr">{children}</span>;
}

/** Two-column responsive grid for panels. */
export function Grid2({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(460px, 100%), 1fr))',
        gap: 20,
        marginBottom: 20,
      }}
    >
      {children}
    </div>
  );
}
