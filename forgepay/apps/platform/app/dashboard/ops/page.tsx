'use client';

import { useEffect, useState } from 'react';
import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  Pill,
  DataTable,
  Mono,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   System Health — real reachability pings against every backend
   service this console talks to (GET /api/forge/health), polled
   every 15s. No synthetic uptime percentages or fabricated queue
   depths: there is no historical monitoring store behind this
   console yet, so this reports only what it can observe right now.
   ──────────────────────────────────────────────────────────────── */

interface ServiceHealth {
  name: string;
  reachable: boolean;
  latencyMs: number | null;
  error?: string;
}

export default function OpsDashboard() {
  const [services, setServices] = useState<ServiceHealth[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/forge/health', { cache: 'no-store' });
        const body = await res.json();
        if (!cancelled) {
          setServices(body.services);
          setCheckedAt(new Date());
        }
      } catch {
        if (!cancelled) setServices([]);
      }
    };
    void poll();
    const timer = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const reachableCount = services?.filter((s) => s.reachable).length ?? 0;
  const total = services?.length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="FORGE / System Health"
        title={
          <>
            What&apos;s actually <em>reachable</em>
          </>
        }
        lede="A live ping against every backend service this console talks to — not a historical uptime dashboard. Polled every 15 seconds."
        actions={checkedAt && <span className="mono">checked {checkedAt.toLocaleTimeString('en-US')}</span>}
      />

      <StatGrid>
        <Stat
          label="Services reachable"
          value={services ? `${reachableCount} / ${total}` : '—'}
          deltaTone={services && reachableCount < total ? 'down' : 'up'}
          delta={services ? (reachableCount === total ? 'all systems reachable' : `${total - reachableCount} unreachable`) : 'checking…'}
        />
      </StatGrid>

      <Panel title="Service Reachability" label="GET /health on every backend, 15s poll">
        <DataTable
          columns={['Service', 'Status', 'Latency', 'Detail']}
          emptyMessage="Checking…"
          rows={(services ?? []).map((s) => [
            <Mono key="n">{s.name}</Mono>,
            <Pill key="s" tone={s.reachable ? 'ok' : 'danger'}>{s.reachable ? 'reachable' : 'unreachable'}</Pill>,
            <Mono key="l">{s.latencyMs != null ? `${s.latencyMs}ms` : '—'}</Mono>,
            s.error ?? '—',
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          A service reporting unreachable here is exactly why pages that depend on it (Custody,
          Wallet, Enterprise Treasury, Agent Credit Bureau) show a real empty state instead of
          data — nothing on those pages is ever backfilled with a placeholder.
        </p>
      </Panel>
    </>
  );
}
