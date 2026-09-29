'use client';

import { useEffect, useState } from 'react';
import {
  PageHeader,
  Panel,
  DataTable,
  Grid2,
  Mono,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Payments — Developers.
   API key (real — one per user, from the console's own users table)
   and the three-line integration. Webhook endpoints aren't scoped
   per-tenant in unified-router yet, so that panel stays an honest
   empty state rather than a fabricated list.
   ──────────────────────────────────────────────────────────────── */

const SNIPPET = `curl https://api.forgepay.io/v1/payments \\
  -H "Authorization: Bearer sk_live_..." \\
  -d amount=250000 -d currency=ZAR \\
  -d method=card -d customer=cus_8842`;

interface ApiKey { id: string; createdAt: string; updatedAt: string }

export default function PaymentsDevelopers() {
  const [key, setKey] = useState<ApiKey | null>(null);
  const [rotating, setRotating] = useState(false);

  const load = () => {
    fetch('/api/user/api-key').then((r) => (r.ok ? r.json() : null)).then((body) => {
      if (body?.data) setKey(body.data);
    });
  };
  useEffect(load, []);

  const rotate = async () => {
    setRotating(true);
    await fetch('/api/user/generate-api-key', { method: 'POST' }).catch(() => null);
    load();
    setRotating(false);
  };

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Payments / Developers"
        title={
          <>
            Three lines to <em>first payment</em>
          </>
        }
        lede="One API for card, bank and stablecoin. Key rotation is restricted to owner and admin roles and every use is audited."
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
            rows={[]}
            emptyMessage="No webhook endpoints registered yet."
          />
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Signatures: <Mono>X-Forge-Signature</Mono> (HMAC-SHA256) + <Mono>X-Forge-Timestamp</Mono>;
            events older than 5 minutes are rejected.
          </p>
        </Panel>
      </Grid2>

      <Panel title="API Key" label="rotation is owner/admin only · every use audited">
        <DataTable
          columns={['Key', 'Created', 'Last rotated', '']}
          rows={key ? [[
            <Mono key="id">{key.id}</Mono>,
            <Mono key="c">{new Date(key.createdAt).toLocaleDateString('en-US')}</Mono>,
            <Mono key="u">{new Date(key.updatedAt).toLocaleDateString('en-US')}</Mono>,
            <button key="b" className="btn-ghost btn-sm" onClick={rotate} disabled={rotating}>
              {rotating ? 'Rotating…' : 'Rotate'}
            </button>,
          ]] : []}
          emptyMessage="Loading…"
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Rotating generates a new key immediately and emails it to your account — the old key
          stops working the moment the new one is issued.
        </p>
      </Panel>
    </>
  );
}
