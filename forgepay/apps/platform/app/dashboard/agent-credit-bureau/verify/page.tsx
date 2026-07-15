'use client';

import { useState } from 'react';
import {
  PageHeader,
  Panel,
  Pill,
  DataTable,
  Grid2,
  Mono,
  Addr,
} from '@/components/forge/ui';
import { GRADE_SCALE, gradeTone } from '@/lib/credit-grade';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau — Verify.
   The verification portal: run the 8-check verify against any
   agent (POST /v1/agents/:id/verify) and the published AAA–D
   rating scale (GET /v1/grade-scale).
   ──────────────────────────────────────────────────────────────── */

type CheckRun = {
  status: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'SUSPICIOUS';
  checksPassed: number;
  checks: Array<{ check: string; passed: boolean; detail: string }>;
};

const RESULTS: Record<string, CheckRun> = {
  'did:forge:agent_114': {
    status: 'VERIFIED',
    checksPassed: 8,
    checks: [
      { check: 'registration', passed: true, detail: 'Registered with the bureau since 2025-03-14.' },
      { check: 'identity_bound', passed: true, detail: 'did:forge:agent_114 bound to SnapPay (llc).' },
      { check: 'account_age', passed: true, detail: '16 months of history (minimum 3).' },
      { check: 'operator_consistency', passed: true, detail: 'Operator entity type on record: llc.' },
      { check: 'activity_level', passed: true, detail: '1,204 credit events recorded (minimum 5).' },
      { check: 'history_stability', passed: true, detail: 'No open delinquencies or defaults.' },
      { check: 'sanctions_screen', passed: true, detail: 'No sanctions hits on record; profile active.' },
      { check: 'minimum_score', passed: true, detail: 'Score 750 (minimum 500).' },
    ],
  },
  'did:forge:agent_078': {
    status: 'PARTIALLY_VERIFIED',
    checksPassed: 6,
    checks: [
      { check: 'registration', passed: true, detail: 'Registered with the bureau since 2025-11-02.' },
      { check: 'identity_bound', passed: true, detail: 'did:forge:agent_078 bound to AfroBiz Lending (corp).' },
      { check: 'account_age', passed: true, detail: '8 months of history (minimum 3).' },
      { check: 'operator_consistency', passed: true, detail: 'Operator entity type on record: corp.' },
      { check: 'activity_level', passed: true, detail: '388 credit events recorded (minimum 5).' },
      { check: 'history_stability', passed: false, detail: '1 open delinquency.' },
      { check: 'sanctions_screen', passed: true, detail: 'No sanctions hits on record; profile active.' },
      { check: 'minimum_score', passed: false, detail: 'Score 630 fails 100% utilization stress check.' },
    ],
  },
  'did:forge:agent_009': {
    status: 'SUSPICIOUS',
    checksPassed: 3,
    checks: [
      { check: 'registration', passed: true, detail: 'Registered with the bureau since 2026-03-01.' },
      { check: 'identity_bound', passed: true, detail: 'did:forge:agent_009 bound to Umuntu Group (llc).' },
      { check: 'account_age', passed: true, detail: '4 months of history (minimum 3).' },
      { check: 'operator_consistency', passed: false, detail: 'Profile frozen — operator standing cannot be confirmed.' },
      { check: 'activity_level', passed: false, detail: '3 credit events recorded (minimum 5).' },
      { check: 'history_stability', passed: false, detail: 'Default on record.' },
      { check: 'sanctions_screen', passed: false, detail: 'Profile frozen since 2026-06-28 — sanctions exposure.' },
      { check: 'minimum_score', passed: false, detail: 'Score 340 (minimum 500).' },
    ],
  },
};

const VERIFY_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  VERIFIED: 'ok',
  PARTIALLY_VERIFIED: 'accent',
  UNVERIFIED: 'warn',
  SUSPICIOUS: 'danger',
};

export default function BureauVerify() {
  const [did, setDid] = useState('did:forge:agent_114');
  const [ran, setRan] = useState<string | null>('did:forge:agent_114');

  const result = ran ? RESULTS[ran] : null;

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau / Verify"
        title={
          <>
            Eight checks, <em>one verdict</em>
          </>
        }
        lede="Verification runs identity, history, sanctions and score checks in one $2.80 pull. Any sanctions exposure returns SUSPICIOUS regardless of the other seven."
      />

      <Panel title="Run a Verification" label="POST /v1/agents/:id/verify · metered at $2.80" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={did}
            onChange={(e) => setDid(e.target.value)}
            style={{
              border: '1px solid var(--hair)',
              background: 'var(--paper)',
              padding: '10px 12px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              color: 'var(--ink)',
              minWidth: 260,
            }}
          >
            {Object.keys(RESULTS).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button className="btn-ghost btn-sm" onClick={() => setRan(did)}>
            Run 8-check verify → $2.80
          </button>
          {result && ran && (
            <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', marginLeft: 8 }}>
              <Pill tone={VERIFY_TONE[result.status]}>{result.status.replace(/_/g, ' ').toLowerCase()}</Pill>
              <Mono>{result.checksPassed} / 8 checks</Mono>
            </span>
          )}
        </div>
      </Panel>

      <Grid2>
        <Panel
          title={ran ? `Result — ${ran}` : 'Result'}
          label="each check with its evidence"
          ink
        >
          {result ? (
            <ol style={{ listStyle: 'none' }}>
              {result.checks.map((c) => (
                <li key={c.check} style={{ display: 'flex', gap: 14, padding: '9px 0', borderBottom: '1px solid rgba(244,242,238,0.14)', alignItems: 'baseline' }}>
                  <span className="mono" style={{ minWidth: 16 }}>{c.passed ? '✓' : '✗'}</span>
                  <span className="mono" style={{ minWidth: 170 }}>{c.check}</span>
                  <span style={{ fontSize: 13, opacity: 0.75 }}>{c.detail}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="lede">Select an agent and run the verification.</p>
          )}
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            8 of 8 → <strong>VERIFIED</strong> · 6–7 → <strong>PARTIALLY_VERIFIED</strong> · below 6
            → <strong>UNVERIFIED</strong> · any sanctions exposure → <strong>SUSPICIOUS</strong>.
          </p>
        </Panel>

        <Panel title="Credit Rating Scale" label="published AAA–D grades · GET /v1/grade-scale">
          <DataTable
            columns={['Grade', 'Score', 'Risk level', 'What it means']}
            rows={GRADE_SCALE.map((b) => [
              <Pill key="g" tone={gradeTone(b.grade)}>{b.grade}</Pill>,
              <Mono key="r">{b.min}–{b.max}</Mono>,
              b.riskLevel,
              b.meaning,
            ])}
          />
        </Panel>
      </Grid2>
    </>
  );
}
