'use client';

import { useState } from 'react';
import { PageHeader, Panel, Pill, DataTable, LivePill, Mono, Addr } from '@/components/forge/ui';
import { useCustody, shortTime } from '@/components/forge/useCustody';

/* FORGE Custody — Keys. Describes the key exactly as it runs: either this
   workspace's own threshold key, whose shares sit on separate signing nodes,
   or the signer's single shared key. Every claim here is read from the nodes
   themselves; nothing is assumed. */

const SEAL_LABEL: Record<string, { text: string; ok: boolean }> = {
  vault: { text: 'Vault', ok: true },
  awskms: { text: 'AWS KMS', ok: true },
  env: { text: 'environment', ok: false },
  file: { text: 'file beside the data', ok: false },
};

export default function CustodyKeys() {
  const { data, live, act, busy, error, me } = useCustody();
  const k = data.signing_key;
  const threshold = k.mode === 'threshold';
  const online = k.nodes.filter((n) => n.reachable).length;
  const [picked, setPicked] = useState<string[] | null>(null);
  const [needed, setNeeded] = useState<number | null>(null);
  const [proposed, setProposed] = useState(false);

  const committee = picked ?? k.committee;
  const signersNeeded = needed ?? Math.min(Math.max(k.signers_needed, 2), Math.max(committee.length, 2));
  const changed =
    committee.length !== k.committee.length || committee.some((n) => !k.committee.includes(n)) || signersNeeded !== k.signers_needed;
  const validPlan = committee.length >= 2 && signersNeeded >= 2 && signersNeeded <= committee.length;
  const openRotation = data.proposals.find((p) => p.kind === 'rotate_key' && p.status === 'open');
  const rotations = data.proposals.filter((p) => p.kind === 'rotate_key');

  function toggle(id: string) {
    const cur = picked ?? k.committee;
    setPicked(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  async function propose() {
    setProposed(false);
    const r = await act({ action: 'propose', kind: 'rotate_key', payload: { nodes: committee, signers_needed: signersNeeded } });
    if (r) {
      setProposed(true);
      setPicked(null);
      setNeeded(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Keys"
        title={<>The key that <em>signs</em></>}
        lede={threshold
          ? 'Your workspace has its own key, split across independent signing nodes.'
          : 'What actually signs your transfers, as it runs today.'}
        actions={<LivePill live={live} />}
      />

      {threshold && !k.provisioned ? (
        <Panel title="Signing Key" label="not created yet" style={{ marginBottom: 20 }}>
          <p className="lede" style={{ fontSize: 14 }}>
            Your workspace's key is created automatically the first time it needs to sign — usually
            your first transfer — and takes about ten seconds.
          </p>
        </Panel>
      ) : (
        <Panel title="Signing Key" label={threshold ? "this workspace's own key" : 'read from the signer service'} ink style={{ marginBottom: 20 }}>
          <DataTable
            columns={threshold
              ? ['Address', 'Scheme', 'Threshold', 'Created', 'Re-split', 'Signer']
              : ['Address', 'Scheme', 'Threshold', 'Stored in', 'Signer']}
            emptyMessage="The signer service is unreachable."
            rows={k.address ? [threshold ? [
              <Addr key="a">{k.address}</Addr>,
              k.scheme,
              <Mono key="t">{k.threshold}</Mono>,
              <Mono key="c">{shortTime(k.created_at)}</Mono>,
              k.epoch === 0 ? 'never' : <Mono key="e">{k.epoch}× · last {shortTime(k.rotated_at)}</Mono>,
              <Pill key="r" tone={k.can_sign ? 'ok' : 'danger'}>{k.can_sign ? 'online' : 'unavailable'}</Pill>,
            ] : [
              <Addr key="a">{k.address}</Addr>,
              k.scheme,
              <Mono key="t">{k.threshold}</Mono>,
              k.storage,
              <Pill key="r" tone={k.signer_reachable ? 'ok' : 'danger'}>{k.signer_reachable ? 'online' : 'unavailable'}</Pill>,
            ]] : []}
          />
        </Panel>
      )}

      {threshold && (
        <Panel title="Signing Nodes" label={`${online} of ${k.nodes.length} reachable · any ${k.signers_needed} of the ${k.committee.length} holding a share sign together`} style={{ marginBottom: 20 }}>
          <DataTable
            columns={['Node', 'Trust domain', 'Holds a share', 'Seal key kept in', 'Backup', 'Transport', 'Its own limits', 'Status']}
            emptyMessage="The signer service is unreachable."
            rows={k.nodes.map((n) => {
              const seal = SEAL_LABEL[n.seal_provider ?? ''] ?? { text: n.seal_provider || 'unknown', ok: false };
              const stale = k.stale_nodes.includes(n.id);
              return [
                <Mono key="i">{n.id}</Mono>,
                n.domain,
                stale ? <Pill key="h" tone="warn">old share</Pill> : n.holds_key ? 'yes' : '—',
                <Pill key="s" tone={seal.ok ? 'ok' : 'warn'}>{seal.text}</Pill>,
                !n.reachable ? '—'
                  : !n.backup?.enabled ? <Pill key="b" tone="warn">none</Pill>
                  : n.backup.lastError ? <Pill key="b" tone="danger">failing</Pill>
                  : n.backup.stale || !n.backup.coversCurrentShares ? <Pill key="b" tone="warn">behind</Pill>
                  : <Pill key="b" tone="ok">current</Pill>,
                <Pill key="m" tone={n.mtls ? 'ok' : 'warn'}>{n.mtls ? 'mutual TLS' : 'plain HTTP'}</Pill>,
                n.policy && n.policy.active.length ? (
                  <span key="p" title={`policy ${n.policy.digest}`}>{n.policy.active.map((r) => r.replace(/_/g, ' ')).join(', ')}</span>
                ) : <Pill key="p" tone="warn">none</Pill>,
                <Pill key="st" tone={n.reachable ? 'ok' : 'danger'}>{n.reachable ? 'online' : 'unreachable'}</Pill>,
              ];
            })}
          />
          {k.exposed_domains.length > 0 && (
            <p style={{ fontSize: 13.5, marginTop: 14, color: 'var(--danger)' }}>
              <strong>{k.exposed_domains.length === 1 ? `The “${k.exposed_domains[0]}” domain holds` : `These domains (${k.exposed_domains.join(', ')}) each hold`} enough nodes to sign without anyone else.</strong>{' '}
              Splitting a key only protects you when the pieces live in separate places: whoever controls that
              domain controls the key. Run each node on separate infrastructure, under separate control, before relying on this.
              {k.production && ' (This deployment is flagged production; it should have refused to start like this.)'}
            </p>
          )}
          {k.nodes.some((n) => n.seal_provider === 'file' || n.mtls === false) && (
            <p style={{ fontSize: 13.5, marginTop: 10, color: 'var(--steel)' }}>
              Nodes marked “file beside the data” keep their encryption key next to their share, so a stolen disk includes the key;
              “plain HTTP” means the coordinator talks to that node without mutual TLS. Both are development settings.
            </p>
          )}
          {k.stale_nodes.length > 0 && (
            <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <p style={{ fontSize: 13.5, color: 'var(--danger)', margin: 0 }}>
                <strong>{k.stale_nodes.join(', ')}</strong> {k.stale_nodes.length === 1 ? 'was' : 'were'} offline when the key was last re-split and still
                {k.stale_nodes.length === 1 ? ' holds' : ' hold'} an old share.
              </p>
              {me?.eligible && (
                <button className="btn-primary btn-sm" disabled={busy} onClick={() => act({ action: 'retire_stale' })}>Destroy old shares</button>
              )}
            </div>
          )}
        </Panel>
      )}

      {threshold && k.provisioned && (
        <Panel title="Re-split the key" label="same address, new shares" style={{ marginBottom: 20 }}>
          <p className="lede" style={{ fontSize: 13.5, marginBottom: 14 }}>
            Move the key to a different set of nodes, or a different number needed to sign, without changing its address —
            so no funds move. Use it to replace a node you no longer trust, or to refresh shares on a schedule. Your signers approve it
            like any other governance change.
          </p>
          {me?.eligible ? (
            <>
              <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 14 }}>
                {k.nodes.map((n) => (
                  <label key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
                    <input type="checkbox" checked={committee.includes(n.id)} onChange={() => toggle(n.id)} disabled={!!openRotation} />
                    <Mono>{n.id}</Mono> <span style={{ color: 'var(--steel)' }}>{n.domain}</span>
                    {!n.reachable && <Pill tone="danger">unreachable</Pill>}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 13.5 }}>
                  Nodes needed to sign{' '}
                  <select value={signersNeeded} onChange={(e) => setNeeded(Number(e.target.value))} disabled={!!openRotation}
                    style={{ border: '1px solid var(--hair)', background: 'var(--paper)', padding: '6px 8px', fontSize: 13.5 }}>
                    {Array.from({ length: Math.max(committee.length - 1, 1) }, (_, i) => i + 2).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>{' '}
                  of {committee.length}
                </label>
                <button className="btn-primary" disabled={busy || !changed || !validPlan || !!openRotation} onClick={propose}>
                  {busy ? 'Submitting…' : 'Propose re-split'}
                </button>
              </div>
              {openRotation && (
                <p style={{ fontSize: 13, marginTop: 12, color: 'var(--steel)' }}>
                  A re-split is waiting for approval on the Governance page ({openRotation.votes.filter((v) => v.approve).length} of {openRotation.required} approvals).
                </p>
              )}
              {proposed && !openRotation && <p style={{ fontSize: 13, marginTop: 12, color: 'var(--ok)' }}>Done — see Governance for the result.</p>}
              {error && <p style={{ fontSize: 13, marginTop: 12, color: 'var(--danger)' }}>{error}</p>}
            </>
          ) : (
            <p className="lede" style={{ fontSize: 13.5 }}>Only active signers can propose a re-split.</p>
          )}
          {rotations.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <DataTable
                columns={['Proposed', 'To', 'Status']}
                emptyMessage=""
                rows={rotations.slice(0, 5).map((p) => [
                  <Mono key="w">{shortTime(p.created_at)}</Mono>,
                  `${(p.payload.nodes ?? []).join(', ')} · ${p.payload.signers_needed} needed`,
                  <span key="s">
                    <Pill tone={p.status === 'executed' ? 'ok' : p.status === 'open' ? 'warn' : 'danger'}>{p.status === 'failed' ? 'approved · not carried out' : p.status}</Pill>
                    {p.status === 'failed' && p.result?.error && (
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--danger)', maxWidth: 320, marginTop: 4 }}>{p.result.error}</span>
                    )}
                  </span>,
                ])}
              />
            </div>
          )}
        </Panel>
      )}

      <Panel title="What this means" label="current limits, stated plainly">
        <ul style={{ paddingLeft: 18, display: 'grid', gap: 10, fontSize: 13.5 }}>
          {threshold ? (
            <>
              <li>
                <strong>The key never exists in one place.</strong> Each node holds one share. Any {k.signers_needed} of
                the {k.committee.length} sign together, and the full private key is never assembled — not when it is created,
                not when it signs, not when it is re-split.
              </li>
              <li>
                <strong>It is yours alone.</strong> Only this workspace's transfers are signed with this address.
                {k.legacy_signer_address && <> Earlier transfers, before it had its own key, were signed by the old shared key <Addr>{k.legacy_signer_address}</Addr>.</>}
              </li>
              <li>
                <strong>Approvals and nodes both have a say.</strong> Your signers' approvals decide whether a transfer is sent
                for signing; each node then rebuilds the transaction itself and applies its own limits, which the gateway can't change.
              </li>
              <li>
                <strong>Fewer nodes than needed means no signing.</strong> With fewer than {k.signers_needed} of the nodes holding a share
                online, an approved transfer is not signed and says why; retry it once enough nodes are back.
              </li>
              <li>
                <strong>Re-splitting protects against slow theft, not a completed one.</strong> Shares stolen one at a time before a
                re-split stop being useful. Someone who already holds {k.signers_needed} shares can rebuild the key, and re-splitting
                does not undo that — that needs a new key and moving the funds.
              </li>
            </>
          ) : (
            <>
              <li>
                <strong>One key, not threshold signing.</strong> A single private key signs every transfer. Your workspace's
                approval quorum decides <em>whether</em> a transfer is signed — it is not split across separate key holders.
              </li>
              {k.shared_across_workspaces && (
                <li>
                  <strong>Shared across workspaces.</strong> Every workspace on this deployment signs with the same address.
                </li>
              )}
              <li>
                <strong>{k.storage === 'environment variable' ? 'Not in Vault yet.' : 'Held in Vault.'}</strong>{' '}
                {k.storage === 'environment variable'
                  ? 'The key is supplied to the signer as an environment variable. Production deployments load it from HashiCorp Vault instead.'
                  : 'The signer loads the key from HashiCorp Vault at start-up.'}
              </li>
            </>
          )}
        </ul>
      </Panel>
    </>
  );
}
