'use client';

import { FormEvent, useState } from 'react';
import { PageHeader, Panel, Pill, DataTable, LivePill, Mono } from '@/components/forge/ui';
import { useCustody, shortTime } from '@/components/forge/useCustody';

/* FORGE Custody — Connected Applications. Each is a named API key an
   application uses to submit transfers; the same policy and approval queue
   apply to them as to transfers requested here in the console. */

const input: React.CSSProperties = {
  width: '100%', border: '1px solid var(--hair)', background: 'var(--paper)', padding: '10px 12px',
  fontSize: 13.5, color: 'var(--ink)', borderRadius: 0, fontFamily: 'inherit',
};

export default function CustodyConnections() {
  const { data, live, act, busy, error, me } = useCustody();
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<{ name: string; api_key: string } | null>(null);

  async function issue(e: FormEvent) {
    e.preventDefault();
    const result = await act({ action: 'issue_api_key', name });
    if (result) {
      setIssued({ name: result.name, api_key: result.api_key });
      setName('');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Connected Applications"
        title={<>What's actually <em>connected</em></>}
        lede="Every application that can submit transfers to this workspace, each with its own key you can revoke on its own."
        actions={<LivePill live={live} />}
      />

      {me?.eligible && (
        <Panel title="Connect an Application" label="issues a new API key" style={{ marginBottom: 20 }}>
          <form onSubmit={issue} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12 }}>
            <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Treasury bot (production)" required />
            <button className="btn-primary" type="submit" disabled={busy}>Issue key</button>
          </form>
          {issued && (
            <div style={{ marginTop: 16, border: '1px solid var(--ink)', padding: 14 }}>
              <p style={{ fontSize: 13, marginBottom: 8 }}>
                <strong>{issued.name}</strong> — copy this key now. It will not be shown again.
              </p>
              <Mono>{issued.api_key}</Mono>
              <p style={{ fontSize: 12.5, marginTop: 10, color: 'var(--steel)' }}>
                Send it as <Mono>Authorization: Bearer &lt;key&gt;</Mono> to <Mono>POST /sign</Mono>.
              </p>
            </div>
          )}
          {error && <p style={{ fontSize: 13, marginTop: 12, color: 'var(--danger)' }}>{error}</p>}
        </Panel>
      )}

      <Panel title="Connected Applications" label="one row per API key" ink>
        <DataTable
          columns={['Application', 'Key', 'Issued by', 'Issued', 'Last used', 'Status', '']}
          emptyMessage="No applications connected yet."
          rows={data.api_keys.map((k) => [
            <strong key="n">{k.name}</strong>,
            <Mono key="p">{k.key_prefix}…</Mono>,
            k.created_by ?? '—',
            <Mono key="c">{shortTime(k.created_at)}</Mono>,
            k.last_used_at ? <Mono key="u">{shortTime(k.last_used_at)}</Mono> : <span key="u" style={{ fontStyle: 'italic' }}>never</span>,
            <Pill key="s" tone={k.revoked_at ? 'danger' : 'ok'}>{k.revoked_at ? 'revoked' : 'active'}</Pill>,
            !k.revoked_at && me?.eligible ? (
              <button key="r" className="btn-ghost btn-sm" disabled={busy} onClick={() => act({ action: 'revoke_api_key', keyId: k.id })}>Revoke</button>
            ) : <span key="r" />,
          ])}
        />
      </Panel>
    </>
  );
}
