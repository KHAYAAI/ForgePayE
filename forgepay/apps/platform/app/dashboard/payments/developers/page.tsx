'use client';

import { useEffect, useState } from 'react';
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
   API key (real — one per user, from the console's own users table)
   and a real webhook endpoint registry, scoped to this tenant's own
   unified-router customer id (see /api/payments/webhooks and
   routes/events.ts's now-fixed merchant_id scoping). Registering
   requires FORGE Payments to be activated first — there's no
   merchant id to scope against before that.
   ──────────────────────────────────────────────────────────────── */

const SNIPPET = `curl https://api.myforgepay.com/v1/payments \\
  -H "Authorization: Bearer sk_live_..." \\
  -d amount=250000 -d currency=ZAR \\
  -d method=card -d customer=cus_8842`;

interface ApiKey { id: string; createdAt: string; updatedAt: string }
interface WebhookEndpoint { id: string; endpoint_url: string; enabled: boolean; created_at: string }

export default function PaymentsDevelopers() {
  const [key, setKey] = useState<ApiKey | null>(null);
  const [rotating, setRotating] = useState(false);

  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [activated, setActivated] = useState<boolean | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const loadKey = () => {
    fetch('/api/user/api-key').then((r) => (r.ok ? r.json() : null)).then((body) => {
      if (body?.data) setKey(body.data);
    });
  };
  const loadWebhooks = () => {
    fetch('/api/payments/webhooks').then((r) => r.json()).then((body) => {
      setActivated(body.activated ?? false);
      setWebhooks(body.data ?? []);
    });
  };
  useEffect(() => { loadKey(); loadWebhooks(); }, []);

  const rotate = async () => {
    setRotating(true);
    await fetch('/api/user/generate-api-key', { method: 'POST' }).catch(() => null);
    loadKey();
    setRotating(false);
  };

  const register = async () => {
    if (!newUrl.trim()) return;
    setRegistering(true);
    setRegisterError(null);
    setNewSecret(null);
    const res = await fetch('/api/payments/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: newUrl.trim() }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setRegisterError(body?.message ?? 'Could not register endpoint.');
    } else {
      setNewSecret(body.data.signing_secret);
      setNewUrl('');
      loadWebhooks();
    }
    setRegistering(false);
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
          {activated === false ? (
            <p className="lede" style={{ fontSize: 13 }}>
              Activate FORGE Payments (complete checkout) before registering a webhook endpoint —
              endpoints are scoped to your merchant account, which doesn&apos;t exist yet.
            </p>
          ) : (
            <>
              <DataTable
                columns={['Endpoint', 'Status', 'Registered']}
                rows={webhooks.map((w) => [
                  <Mono key="u">{w.endpoint_url}</Mono>,
                  <Pill key="s" tone={w.enabled ? 'ok' : undefined}>{w.enabled ? 'enabled' : 'disabled'}</Pill>,
                  <Mono key="c">{new Date(w.created_at).toLocaleDateString('en-US')}</Mono>,
                ])}
                emptyMessage="No webhook endpoints registered yet."
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <input
                  type="url"
                  placeholder="https://your-app.com/hooks/forge"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  style={{ flex: 1, border: '1px solid var(--hair)', background: 'var(--paper)', padding: '9px 11px', fontSize: 13 }}
                />
                <button className="btn-ghost btn-sm" onClick={register} disabled={registering || !newUrl.trim()}>
                  {registering ? 'Registering…' : 'Register'}
                </button>
              </div>
              {registerError && <p className="lede" style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }}>{registerError}</p>}
              {newSecret && (
                <p className="lede" style={{ fontSize: 12.5, marginTop: 8 }}>
                  Signing secret (shown once): <Mono>{newSecret}</Mono>
                </p>
              )}
            </>
          )}
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
