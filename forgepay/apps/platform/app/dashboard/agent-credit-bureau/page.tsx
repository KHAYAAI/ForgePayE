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
  Meter,
  Mono,
  Addr,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau — reputation & credit for autonomous agents.
   Reads did:forge identities and wallet/custody events from the
   Revenue Ontology; issues scores and credit lines; requests
   extensions from Enterprise Treasury.
   ──────────────────────────────────────────────────────────────── */

type AgentRow = {
  did: string;
  platform: string;
  score: number;
  trend: string;
  line: string;
  drawn: string;
  onTime: string;
  status: 'good' | 'watch' | 'frozen';
};

const AGENTS: AgentRow[] = [
  { did: 'did:forge:agent_001', platform: 'Umuntu Group', score: 82, trend: '+4 (repaid on-time)', line: 'R250K', drawn: 'R0', onTime: '52 / 52', status: 'good' },
  { did: 'did:forge:agent_114', platform: 'SnapPay', score: 75, trend: '+1', line: 'R100K', drawn: 'R38K', onTime: '31 / 31', status: 'good' },
  { did: 'did:forge:agent_078', platform: 'AfroBiz Lending', score: 63, trend: '−3 (late 2d)', line: 'R40K', drawn: 'R40K', onTime: '18 / 20', status: 'watch' },
  { did: 'did:forge:agent_231', platform: 'ComputeRent', score: 71, trend: '+2', line: 'R60K', drawn: 'R12K', onTime: '44 / 45', status: 'good' },
  { did: 'did:forge:agent_009', platform: 'Umuntu Group', score: 34, trend: '−12 (missed repayment)', line: 'R0 (frozen)', drawn: 'R25K overdue', onTime: '9 / 14', status: 'frozen' },
];

const STATUS_TONE = { good: 'ok', watch: 'warn', frozen: 'danger' } as const;

export default function AgentCreditBureau() {
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

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau"
        title={
          <>
            Credit for <em>autonomous agents</em>
          </>
        }
        lede="Every agent payment recorded in the Revenue Ontology feeds a live reputation score. Scores set credit lines; Enterprise Treasury approves extensions; repayment closes the loop."
        actions={<button className="btn-ink btn-sm">Score an Agent</button>}
      />

      <StatGrid>
        <Stat label="Agents scored" value="312" delta="+18 this week" deltaTone="up" />
        <Stat label="Avg score" value="71 / 100" delta="+2.4 pts / 30d" deltaTone="up" />
        <Stat label="Credit extended" value="R2.1M" delta="across 87 lines" />
        <Stat label="On-time repayment" value="96.8%" delta="target ≥ 95%" deltaTone="up" />
        <Stat label="Frozen lines" value="3" delta="1 overdue > 7d" deltaTone="down" />
        <Stat label="Extension requests" value="1" delta="awaiting treasury" />
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

      <Panel title="Agent Register" label="scores from ontology events · updated live" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Agent DID', 'Platform', 'Score', '', 'Trend', 'Credit Line', 'Drawn', 'On-time', 'Status']}
          rows={AGENTS.map((a) => [
            <Addr key="d">{a.did}</Addr>,
            a.platform,
            <Mono key="s">{a.score}</Mono>,
            <Meter key="m" pct={a.score} accent={a.score >= 70} />,
            <span key="t" style={{ fontSize: 12.5, color: a.trend.startsWith('−') ? 'var(--danger)' : 'var(--ok)' }}>{a.trend}</span>,
            <Mono key="l">{a.line}</Mono>,
            <Mono key="dr">{a.drawn}</Mono>,
            <Mono key="o">{a.onTime}</Mono>,
            <Pill key="st" tone={STATUS_TONE[a.status]}>{a.status}</Pill>,
          ])}
        />
      </Panel>

      <Grid2>
        <Panel title="Scoring Model" label="event-driven · explainable">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['35%', 'Payment success rate', 'confirmed vs failed transfers from wallet + custody events'],
              ['30%', 'Volume consistency', 'amount variance across trailing 90 days'],
              ['20%', 'Compliance record', 'sanctions screens, policy rejections, chargebacks'],
              ['15%', 'Account age', 'time since did:forge registration'],
            ].map(([w, factor, desc]) => (
              <li key={factor} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 40 }}>{w}</span>
                <span style={{ fontWeight: 500, minWidth: 180 }}>{factor}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Score changes are event-sourced: each `wallet.transaction.confirmed` and
            `custody.signature.confirmed` ontology event replays into the model, so every score is
            auditable back to the transactions that produced it.
          </p>
        </Panel>

        <Panel title="Credit Line Ladder" label="score → automatic limit">
          <DataTable
            columns={['Score band', 'Line', 'Terms', 'Fee']}
            rows={[
              [<Mono key="b">80 – 100</Mono>, <Mono key="l">up to R250K</Mono>, 'net-30 / net-60', <Mono key="f">1.0%</Mono>],
              [<Mono key="b">70 – 79</Mono>, <Mono key="l">up to R100K</Mono>, 'net-30', <Mono key="f">1.5%</Mono>],
              [<Mono key="b">55 – 69</Mono>, <Mono key="l">up to R40K</Mono>, 'net-14', <Mono key="f">2.0%</Mono>],
              [<Mono key="b">40 – 54</Mono>, <Mono key="l">up to R10K</Mono>, 'net-7 · prepaid gas', <Mono key="f">2.5%</Mono>],
              [<Mono key="b">{'< 40'}</Mono>, <Mono key="l">frozen</Mono>, 'repayment plan required', <Mono key="f">—</Mono>],
            ]}
          />
        </Panel>
      </Grid2>
    </>
  );
}
