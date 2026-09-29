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

interface KeyRow { id: string; chain: string; threshold: string; rotation: 'active' | 'rotating'; lastCeremony: string; nextRotation: string }
interface CeremonyRow { at: string; key: string; kind: string; participants: string; result: string }

// Not yet backed by a live feed — forge-custody has no key-inventory or
// ceremony-history read endpoint wired into this console today, so both
// tables below render the real state for every account: no keys dealt yet.
const KEYS: KeyRow[] = [];
const CEREMONIES: CeremonyRow[] = [];

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
        <Stat label="Rotating now" value={KEYS.filter((k) => k.rotation === 'rotating').length} delta="in progress" />
        <Stat label="Rotation cadence" value="180 days" delta="policy-enforced" />
        <Stat label="Share storage" value="Vault + KMS" delta="encrypted at rest" deltaTone="up" />
      </StatGrid>

      <Panel title="Key Inventory" label="shares in Vault — metadata only" ink style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Key', 'Chain', 'Threshold', 'Rotation', 'Last ceremony', 'Next rotation']}
          emptyMessage="No keys dealt yet."
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
            emptyMessage="No ceremonies yet."
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
