'use client';

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
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   FORGE Custody — Keys.
   Key inventory — live-wired to forge-custody's real console/summary
   `keys` field (services/forge-custody/src/index.ts). Shares live
   encrypted in HashiCorp Vault behind AWS KMS — this console sees
   metadata only, never material.

   Ceremony history has no read endpoint in forge-custody today
   (POST /api/v1/ceremonies records one, but nothing lists them) —
   that table stays a real, permanent empty state until one exists.
   ──────────────────────────────────────────────────────────────── */

interface KeyRow { id: string; blockchain: string; threshold: string; rotation_status: 'active' | 'rotating' | 'retired' }
interface CustodySummary { keys?: KeyRow[] }

const EMPTY: CustodySummary = { keys: [] };

const ROTATION_TONE: Record<string, 'ok' | 'warn' | 'danger'> = {
  active: 'ok',
  rotating: 'warn',
  retired: 'danger',
};

export default function CustodyKeys() {
  const { data, live } = useForge<CustodySummary>('custody', EMPTY);
  const keys = data.keys ?? [];

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Keys"
        title={
          <>
            Keys that <em>never exist</em>
          </>
        }
        lede="Private keys never exist in plaintext. Each key is threshold-encrypted shares dealt in a verified DKG ceremony; rotation re-deals shares without the key ever being assembled."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat label="Active keys" value={keys.filter((k) => k.rotation_status === 'active').length} delta="metadata only in console" />
        <Stat label="Rotating now" value={keys.filter((k) => k.rotation_status === 'rotating').length} delta="in progress" />
        <Stat label="Retired" value={keys.filter((k) => k.rotation_status === 'retired').length} delta="superseded" />
        <Stat label="Share storage" value="Vault + KMS" delta="encrypted at rest" deltaTone="up" />
      </StatGrid>

      <Panel title="Key Inventory" label="GET /api/v1/console/summary · shares in Vault, metadata only" ink style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Key', 'Chain', 'Threshold', 'Rotation']}
          emptyMessage="No keys dealt yet."
          rows={keys.map((k) => [
            <Mono key="1">{k.id}</Mono>,
            k.blockchain,
            <Mono key="t">{k.threshold}</Mono>,
            <Pill key="r" tone={ROTATION_TONE[k.rotation_status]}>{k.rotation_status}</Pill>,
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Feldman-VSS share commitments are verified at each ceremony — a corrupted or substituted
          share is detected before it can ever participate in a signature.
        </p>
      </Panel>

      <Grid2>
        <Panel title="Ceremony History" label="no list endpoint in forge-custody yet">
          <DataTable
            columns={['When', 'Key', 'Kind', 'Participants', 'Result']}
            emptyMessage="forge-custody records ceremonies (POST /api/v1/ceremonies) but has no endpoint to list them yet."
            rows={[]}
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
