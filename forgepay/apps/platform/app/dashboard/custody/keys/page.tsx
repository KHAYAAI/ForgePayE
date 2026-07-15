'use client';

import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  Pill,
  DataTable,
  Grid2,
  Mono,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Custody — Keys.
   Key inventory, rotation schedule and DKG ceremony history.
   Shares live encrypted in HashiCorp Vault behind AWS KMS —
   this console sees metadata only, never material.
   ──────────────────────────────────────────────────────────────── */

const KEYS = [
  { id: 'key_settlement_eth', chain: 'ethereum', threshold: '4-of-7', rotation: 'active', lastCeremony: '2026-05-02', nextRotation: '2026-11-02' },
  { id: 'key_settlement_polygon', chain: 'polygon', threshold: '4-of-7', rotation: 'active', lastCeremony: '2026-05-02', nextRotation: '2026-11-02' },
  { id: 'key_treasury_ops', chain: 'ethereum', threshold: '3-of-5', rotation: 'rotating', lastCeremony: '2026-07-14', nextRotation: 'in progress' },
  { id: 'key_investec_ws', chain: 'ethereum', threshold: '4-of-7', rotation: 'active', lastCeremony: '2026-06-11', nextRotation: '2026-12-11' },
  { id: 'key_umuntu_ws', chain: 'polygon', threshold: '4-of-7', rotation: 'active', lastCeremony: '2026-06-11', nextRotation: '2026-12-11' },
];

const CEREMONIES = [
  { at: '2026-07-14 09:00', key: 'key_treasury_ops', kind: 'rotation', participants: '5 of 5 shares re-dealt', result: 'in progress' },
  { at: '2026-06-11 10:30', key: 'key_investec_ws', kind: 'initial DKG', participants: '7 shares dealt · Feldman-VSS verified', result: 'complete' },
  { at: '2026-05-02 08:15', key: 'key_settlement_eth', kind: 'rotation', participants: '7 of 7 shares re-dealt', result: 'complete' },
];

export default function CustodyKeys() {
  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Keys"
        title={
          <>
            Keys that <em>never exist</em>
          </>
        }
        lede="Private keys never exist in plaintext. Each key is 4-of-7 encrypted shares dealt in a verified DKG ceremony; rotation re-deals shares without the key ever being assembled."
      />

      <StatGrid>
        <Stat label="Active keys" value={KEYS.filter((k) => k.rotation === 'active').length} delta="metadata only in console" />
        <Stat label="Rotating now" value={KEYS.filter((k) => k.rotation === 'rotating').length} delta="key_treasury_ops" />
        <Stat label="Rotation cadence" value="180 days" delta="policy-enforced" />
        <Stat label="Share storage" value="Vault + KMS" delta="encrypted at rest" deltaTone="up" />
      </StatGrid>

      <Panel title="Key Inventory" label="shares in Vault — metadata only" ink style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Key', 'Chain', 'Threshold', 'Rotation', 'Last ceremony', 'Next rotation']}
          rows={KEYS.map((k) => [
            <Mono key="1">{k.id}</Mono>,
            k.chain,
            <Mono key="t">{k.threshold}</Mono>,
            <Pill key="r" tone={k.rotation === 'active' ? 'ok' : 'warn'}>{k.rotation}</Pill>,
            <Mono key="lc">{k.lastCeremony}</Mono>,
            <Mono key="nr">{k.nextRotation}</Mono>,
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Feldman-VSS share commitments are verified at each ceremony — a corrupted or substituted
          share is detected before it can ever participate in a signature.
        </p>
      </Panel>

      <Grid2>
        <Panel title="Ceremony History" label="every deal and re-deal, logged">
          <DataTable
            columns={['When', 'Key', 'Kind', 'Participants', 'Result']}
            rows={CEREMONIES.map((c, i) => [
              <Mono key={`w${i}`}>{c.at}</Mono>,
              <Mono key={`k${i}`}>{c.key}</Mono>,
              c.kind,
              c.participants,
              <Pill key={`r${i}`} tone={c.result === 'complete' ? 'ok' : 'warn'}>{c.result}</Pill>,
            ])}
          />
        </Panel>

        <Panel title="What This Console Cannot Do" label="separation of duties, by design">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['No export', 'There is no endpoint that returns key material — encrypted or otherwise.'],
              ['No solo rotation', 'Starting a ceremony requires a 4-of-7 governance vote, like any policy change.'],
              ['No share visibility', 'Operators see ceremony outcomes and commitments, never shares.'],
            ].map(([t, d]) => (
              <li key={t} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 500, minWidth: 130 }}>{t}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{d}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </Grid2>
    </>
  );
}
