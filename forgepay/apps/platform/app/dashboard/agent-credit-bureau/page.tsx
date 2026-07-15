'use client';

import { useState } from 'react';
import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  Pill,
  DataTable,
  Grid2,
  LivePill,
  Mono,
  Addr,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';
import { INQUIRY_FEE_USD, gradeFor } from '@/lib/credit-grade';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau — Overview.
   Live-wired to agent-credit-bureau /v1/bureau/stats via the
   /api/forge/bureau proxy; demo fixtures when offline.
   The register lives in Agents, dual-mode analysis in Scores,
   verification in Verify, FCRA queue in Disputes, API in Developers.
   ──────────────────────────────────────────────────────────────── */

interface BureauSummary {
  stats: {
    totalAgents: number;
    avgScore: number;
    totalDebt: number;
    totalCreditLimit: number;
    utilizationRate: number;
    delinquentAgents?: number;
    inquiries24h?: number;
    inquiryFeeUsd?: number;
    inquiryRevenueUsd?: number;
  };
}

const DEMO: BureauSummary = {
  stats: {
    totalAgents: 312,
    avgScore: 710,
    totalDebt: 2_100_000,
    totalCreditLimit: 6_400_000,
    utilizationRate: 0.328,
    delinquentAgents: 3,
    inquiries24h: 487,
    inquiryFeeUsd: INQUIRY_FEE_USD,
    inquiryRevenueUsd: 40_880,
  },
};

const money = (n: number) => `R${n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`}`;

export default function BureauOverview() {
  const { data, live } = useForge<BureauSummary>('bureau', DEMO);
  const [extensions, setExtensions] = useState([
    {
      id: 'ext_5501',
      did: 'did:forge:agent_001',
      reason: 'Supplier payment $50K exceeds current line',
      from: 'R25K',
      to: 'R100K',
      status: 'pending' as 'pending' | 'sent',
    },
  ]);

  const requestApproval = (id: string) =>
    setExtensions((xs) => xs.map((x) => (x.id === id ? { ...x, status: 'sent' } : x)));

  const feeUsd = data.stats.inquiryFeeUsd ?? INQUIRY_FEE_USD;
  const inquiries24h = data.stats.inquiries24h ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau"
        title={
          <>
            Credit for <em>autonomous agents</em>
          </>
        }
        lede="Every agent payment recorded in the Revenue Ontology feeds a live reputation score — 0–1000 with an AAA–D grade, priced like a traditional bureau at $2.80 per inquiry."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat label="Agents scored" value={data.stats.totalAgents.toLocaleString('en-US')} delta={live ? 'from bureau register' : '+18 this week'} />
        <Stat label="Avg score" value={`${data.stats.avgScore} / 1000`} delta={`grade ${gradeFor(data.stats.avgScore).grade}`} />
        <Stat label="Inquiries / 24h" value={inquiries24h.toLocaleString('en-US')} delta={`$${feeUsd.toFixed(2)} per pull`} />
        <Stat label="Inquiry revenue" value={`$${Math.round(data.stats.inquiryRevenueUsd ?? inquiries24h * feeUsd).toLocaleString('en-US')}`} delta="metered · to date" deltaTone="up" />
        <Stat label="Credit drawn" value={money(data.stats.totalDebt)} delta={`of ${money(data.stats.totalCreditLimit)} extended`} />
        <Stat label="Delinquent agents" value={data.stats.delinquentAgents ?? 0} deltaTone={(data.stats.delinquentAgents ?? 0) > 0 ? 'down' : undefined} delta="open delinquencies" />
      </StatGrid>

      <Panel
        title="Credit Extension Queue"
        label="interacts with Enterprise Treasury"
        ink
        style={{ marginBottom: 20 }}
      >
        <DataTable
          columns={['Request', 'Agent', 'Reason', 'Line Change', 'Status', '']}
          rows={extensions.map((x) => [
            <Mono key="id">{x.id}</Mono>,
            <Addr key="d">{x.did}</Addr>,
            x.reason,
            <Mono key="c">{x.from} → {x.to}</Mono>,
            <Pill key="s" tone={x.status === 'sent' ? 'accent' : 'warn'}>
              {x.status === 'sent' ? 'sent to treasury' : 'pending'}
            </Pill>,
            x.status === 'pending' ? (
              <button key="b" className="btn-ghost btn-sm" onClick={() => requestApproval(x.id)}>
                Send to Treasury
              </button>
            ) : (
              <span key="b" className="mono">awaiting approval</span>
            ),
          ])}
        />
      </Panel>

      <Grid2>
        <Panel title="Mode 1 — FORGE FICO" label="authoritative for lending · off-chain · <15ms">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['35%', 'Payment history', 'on-time rate, open delinquencies, defaults on record'],
              ['30%', 'Credit utilization', 'total drawn / total limit across all credit lines'],
              ['15%', 'Age of credit', 'months since the first credit event'],
              ['10%', 'Credit mix', 'diversity of event types on record'],
              ['10%', 'New credit velocity', 'hard inquiries in the last 30 days'],
            ].map(([w, factor, desc]) => (
              <li key={factor} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 40 }}>{w}</span>
                <span style={{ fontWeight: 500, minWidth: 165 }}>{factor}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Mode 2 — Operational" label="behavioral lens · Qova-derived · on-chain verifiable">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['30%', 'Success rate', 'confirmed vs failed transactions from wallet + custody events'],
              ['25%', 'Transaction volume', 'total settled USD volume, tiered'],
              ['20%', 'Transaction count', 'depth of recorded activity'],
              ['15%', 'Budget compliance', 'spend attempts within configured limits'],
              ['10%', 'Account age', 'months of operational history'],
            ].map(([w, factor, desc]) => (
              <li key={factor} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 40 }}>{w}</span>
                <span style={{ fontWeight: 500, minWidth: 165 }}>{factor}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            The full dual-mode analysis — consensus levels, variance flags and on-chain settlement —
            lives in the Scores tab.
          </p>
        </Panel>
      </Grid2>

      <Panel title="Credit Line Ladder" label="score → automatic limit">
        <DataTable
          columns={['Tier (score)', 'Line', 'Terms', 'Fee']}
          rows={[
            [<Mono key="b">super prime (800+)</Mono>, <Mono key="l">up to R250K</Mono>, 'net-30 / net-60', <Mono key="f">1.0%</Mono>],
            [<Mono key="b">prime (670–799)</Mono>, <Mono key="l">up to R100K</Mono>, 'net-30', <Mono key="f">1.5%</Mono>],
            [<Mono key="b">near prime (580–669)</Mono>, <Mono key="l">up to R40K</Mono>, 'net-14', <Mono key="f">2.0%</Mono>],
            [<Mono key="b">subprime (500–579)</Mono>, <Mono key="l">up to R10K</Mono>, 'net-7 · prepaid gas', <Mono key="f">2.5%</Mono>],
            [<Mono key="b">{'deep subprime (< 500)'}</Mono>, <Mono key="l">frozen</Mono>, 'repayment plan required', <Mono key="f">—</Mono>],
          ]}
        />
      </Panel>
    </>
  );
}
