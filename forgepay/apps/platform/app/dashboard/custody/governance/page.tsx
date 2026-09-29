'use client';

import {
  PageHeader,
  Panel,
  DataTable,
  Mono,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Custody — Governance.
   The policy matrix (what needs how many signatures — real
   configuration, not activity) and the signer roster.

   The signer roster has no backing data model anywhere in
   forge-custody — its Workspace type carries no signers field, and
   CustodyKey's shareHolders is metadata on a key, not a roster with
   roles/status/invitations. This isn't a wiring gap, it's a feature
   that doesn't exist yet; the table stays a real, permanent empty
   state until one is built.
   ──────────────────────────────────────────────────────────────── */

const POLICY = [
  { action: 'Transfer < $100K', who: 'Any approver', required: '2 of 7', cooldown: 'None' },
  { action: 'Transfer $100K – $1M', who: 'Any approver, ≥1 senior', required: '4 of 7', cooldown: '15 min' },
  { action: 'Transfer > $1M', who: 'Seniors + external auditor', required: '6 of 7', cooldown: '2 hours' },
  { action: 'Create / change company wallet', who: 'Senior officers only', required: '2 of 3 seniors', cooldown: 'None' },
  { action: 'Add or remove a signer', who: 'All current signers vote', required: '4 of 7', cooldown: '24 hours' },
  { action: 'Change this policy table', who: 'All current signers vote', required: '4 of 7', cooldown: '24 hours' },
];

export default function CustodyGovernance() {
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
        <DataTable
          columns={['Signer', 'Role', 'Seniority', 'Method', 'Status']}
          rows={[]}
          emptyMessage="No signers added yet."
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          A newly invited signer stays <strong>pending</strong> until 4 of 7 current signers
          approve, then serves a 24-hour cooling-off before their first co-signature counts.
        </p>
      </Panel>
    </>
  );
}
