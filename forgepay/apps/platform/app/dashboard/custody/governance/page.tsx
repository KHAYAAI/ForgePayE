'use client';

import { useState } from 'react';
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
   FORGE Custody — Governance.
   The policy matrix (what needs how many signatures) and the
   signer roster. Adding a signer starts a 4-of-7 vote with a
   24-hour cooling-off — demonstrated live on this page.
   ──────────────────────────────────────────────────────────────── */

type Signer = {
  name: string;
  role: string;
  seniority: 'senior' | 'approver';
  method: string;
  status: 'active' | 'pending' | 'standby';
  votes?: string;
};

const INITIAL_SIGNERS: Signer[] = [
  { name: 'S. Mokoena', role: 'CFO', seniority: 'senior', method: 'Hardware key', status: 'active' },
  { name: 'T. Nkosi', role: 'Ops lead', seniority: 'senior', method: 'Registered device', status: 'active' },
  { name: 'R. Dlamini', role: 'Treasury lead', seniority: 'senior', method: 'Mobile', status: 'active' },
  { name: 'B. Khumalo', role: 'Finance manager', seniority: 'approver', method: 'Mobile', status: 'active' },
  { name: 'FORGE custodian α', role: 'Platform co-signer', seniority: 'approver', method: 'Automated policy check', status: 'active' },
  { name: 'FORGE custodian β', role: 'Platform co-signer', seniority: 'approver', method: 'Automated policy check', status: 'active' },
  { name: 'External auditor', role: 'Compliance co-sign', seniority: 'approver', method: 'Mobile', status: 'standby' },
];

const POLICY = [
  { action: 'Transfer < $100K', who: 'Any approver', required: '2 of 7', cooldown: 'None' },
  { action: 'Transfer $100K – $1M', who: 'Any approver, ≥1 senior', required: '4 of 7', cooldown: '15 min' },
  { action: 'Transfer > $1M', who: 'Seniors + external auditor', required: '6 of 7', cooldown: '2 hours' },
  { action: 'Create / change company wallet', who: 'Senior officers only', required: '2 of 3 seniors', cooldown: 'None' },
  { action: 'Add or remove a signer', who: 'All current signers vote', required: '4 of 7', cooldown: '24 hours' },
  { action: 'Change this policy table', who: 'All current signers vote', required: '4 of 7', cooldown: '24 hours' },
];

export default function CustodyGovernance() {
  const [signers, setSigners] = useState(INITIAL_SIGNERS);
  const [invited, setInvited] = useState(false);

  const inviteSigner = () => {
    setSigners((s) => [
      ...s,
      { name: 'N. Mabaso', role: 'Risk officer', seniority: 'approver', method: 'Hardware key (pending)', status: 'pending', votes: '1 of 4 votes' },
    ]);
    setInvited(true);
  };

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Governance"
        title={
          <>
            Policy is the <em>product</em>
          </>
        }
        lede="Who can move what, with how many signatures, after how long. The matrix below is enforced server-side on every request — and changing the matrix itself takes a 4-of-7 vote plus 24 hours."
      />

      <StatGrid>
        <Stat label="Active signers" value={signers.filter((s) => s.status === 'active').length} delta="3 senior · 4 approver" />
        <Stat label="Pending signers" value={signers.filter((s) => s.status === 'pending').length} delta="4-of-7 vote + 24h cooling-off" />
        <Stat label="Policy rules" value={POLICY.length} delta="changes need 4-of-7 + 24h" />
        <Stat label="Last policy change" value="41 days" delta="raise of >$1M quorum to 6-of-7" />
      </StatGrid>

      <Panel title="Governance Policy" label="what needs how many signatures" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Action', 'Who can sign', 'Required', 'Cooling-off']}
          rows={POLICY.map((p) => [
            p.action,
            p.who,
            <Mono key="r">{p.required}</Mono>,
            p.cooldown,
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Wallet provisioning, signer changes and policy edits are governed changes — they queue
          exactly like transfers and never take effect on a single keyholder's say-so.
        </p>
      </Panel>

      <Panel
        title="Signer Roster"
        label="add/remove requires a 4-of-7 vote + 24h cooling-off"
        ink
      >
        <div style={{ marginBottom: 14 }}>
          <button className="btn-ghost btn-sm" onClick={inviteSigner} disabled={invited}>
            {invited ? 'Invitation pending — 4-of-7 vote in progress' : '+ Invite a signer'}
          </button>
        </div>
        <DataTable
          columns={['Signer', 'Role', 'Seniority', 'Method', 'Status']}
          rows={signers.map((s) => [
            s.name,
            s.role,
            <Pill key="sen" tone={s.seniority === 'senior' ? 'accent' : undefined}>{s.seniority}</Pill>,
            s.method,
            <span key="st" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <Pill tone={s.status === 'active' ? 'ok' : s.status === 'pending' ? 'warn' : undefined}>{s.status}</Pill>
              {s.votes && <span className="mono" style={{ fontSize: 10.5 }}>{s.votes}</span>}
            </span>,
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          A newly invited signer stays <strong>pending</strong> until 4 of 7 current signers
          approve, then serves a 24-hour cooling-off before their first co-signature counts. The
          invitation you just sent is now in every active signer's approval queue.
        </p>
      </Panel>
    </>
  );
}
