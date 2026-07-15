'use client';

import { useState } from 'react';
import {
  PageHeader,
  Panel,
  Pill,
  DataTable,
  Grid2,
  Mono,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Payments — Developers.
   API keys, webhook endpoints, and the three-line integration.
   Key rotation is a governed action (owner/admin only).
   ──────────────────────────────────────────────────────────────── */

const SNIPPET = `curl https://api.forgepay.io/v1/payments \\
  -H "Authorization: Bearer sk_live_..." \\
  -d amount=250000 -d currency=ZAR \\
  -d method=card -d customer=cus_8842`;

export default function PaymentsDevelopers() {
  const [keys, setKeys] = useState([
    { id: 'sk_live_…9f2a', label: 'Production', created: '2026-03-02', lastUsed: '2 min ago', status: 'active' as 'active' | 'revoked' },
    { id: 'sk_test_…77b1', label: 'Staging', created: '2026-03-02', lastUsed: '1 h ago', status: 'active' as 'active' | 'revoked' },
    { id: 'sk_live_…104c', label: 'Legacy (v0)', created: '2025-11-18', lastUsed: '41 days ago', status: 'revoked' as 'active' | 'revoked' },
  ]);

  const revoke = (id: string) =>
    setKeys((ks) => ks.map((k) => (k.id === id ? { ...k, status: 'revoked' } : k)));

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Payments / Developers"
        title={
          <>
            Three lines to <em>first payment</em>
          </>
        }
        lede="One API for card, bank and stablecoin. Webhooks are HMAC-signed with timestamp replay protection; key rotation is restricted to owner and admin roles."
      />

      <Grid2>
        <Panel title="Create a Payment" label="the whole integration" ink>
          <pre className="mono" style={{ fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{SNIPPET}</pre>
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            The router picks the rail (tiering + fallbacks) — the request shape never changes. SDKs:
            <Mono> @forgepay/sdk</Mono> (Node) and <Mono>forgepay</Mono> (Python).
          </p>
        </Panel>

        <Panel title="Webhook Endpoints" label="HMAC-signed · replay-protected">
          <DataTable
            columns={['Endpoint', 'Events', 'Status']}
            rows={[
              [<Mono key="u">https://snappay.co.za/hooks/forge</Mono>, 'payment.confirmed, payment.failed', <Pill key="s" tone="ok">healthy</Pill>],
              [<Mono key="u">https://snappay.co.za/hooks/disputes</Mono>, 'dispute.*', <Pill key="s" tone="ok">healthy</Pill>],
              [<Mono key="u">https://legacy.snappay.co.za/ipn</Mono>, 'payment.confirmed', <Pill key="s" tone="danger">failing · 410</Pill>],
            ]}
          />
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Signatures: <Mono>X-Forge-Signature</Mono> (HMAC-SHA256) + <Mono>X-Forge-Timestamp</Mono>;
            events older than 5 minutes are rejected. Failing endpoints retry with exponential
            backoff for 72 hours.
          </p>
        </Panel>
      </Grid2>

      <Panel title="API Keys" label="rotation is owner/admin only · every use audited">
        <DataTable
          columns={['Key', 'Label', 'Created', 'Last used', 'Status', '']}
          rows={keys.map((k) => [
            <Mono key="id">{k.id}</Mono>,
            k.label,
            <Mono key="c">{k.created}</Mono>,
            <Mono key="u">{k.lastUsed}</Mono>,
            <Pill key="s" tone={k.status === 'active' ? 'ok' : 'danger'}>{k.status}</Pill>,
            k.status === 'active' ? (
              <button key="b" className="btn-ghost btn-sm" onClick={() => revoke(k.id)}>Revoke</button>
            ) : (
              <span key="b" />
            ),
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Revoking a key takes effect within 60 seconds across the mesh. Creating a new live key
          requires re-authentication and is written to the immutable audit log.
        </p>
      </Panel>
    </>
  );
}
