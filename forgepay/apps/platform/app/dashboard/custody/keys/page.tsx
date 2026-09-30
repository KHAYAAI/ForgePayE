'use client';

import { PageHeader, Panel, Pill, DataTable, LivePill, Mono, Addr } from '@/components/forge/ui';
import { useCustody, shortTime } from '@/components/forge/useCustody';

/* FORGE Custody — Keys. Describes the key exactly as it runs: either this
   workspace's own threshold key, whose shares sit on separate signing nodes,
   or the signer's single shared key. */

export default function CustodyKeys() {
  const { data, live } = useCustody();
  const k = data.signing_key;
  const threshold = k.mode === 'threshold';
  const online = k.nodes.filter((n) => n.reachable).length;

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
            columns={['Address', 'Scheme', 'Threshold', threshold ? 'Created' : 'Stored in', 'Signer']}
            emptyMessage="The signer service is unreachable."
            rows={k.address ? [[
              <Addr key="a">{k.address}</Addr>,
              k.scheme,
              <Mono key="t">{k.threshold}</Mono>,
              threshold ? <Mono key="c">{shortTime(k.created_at)}</Mono> : k.storage,
              <Pill key="r" tone={(threshold ? k.can_sign : k.signer_reachable) ? 'ok' : 'danger'}>
                {(threshold ? k.can_sign : k.signer_reachable) ? 'online' : 'unavailable'}
              </Pill>,
            ]] : []}
          />
        </Panel>
      )}

      {threshold && (
        <Panel title="Signing Nodes" label={`${online} of ${k.nodes.length} reachable · any ${k.threshold.split('-')[0]} sign together`} style={{ marginBottom: 20 }}>
          <DataTable
            columns={['Node', 'Trust domain', 'Status']}
            emptyMessage="The signer service is unreachable."
            rows={k.nodes.map((n) => [
              <Mono key="i">{n.id}</Mono>,
              n.domain,
              <Pill key="s" tone={n.reachable ? 'ok' : 'danger'}>{n.reachable ? 'online' : 'unreachable'}</Pill>,
            ])}
          />
          {k.trust_domains < 2 && (
            <p style={{ fontSize: 13.5, marginTop: 14, color: 'var(--danger)' }}>
              <strong>All {k.nodes.length} nodes are in one trust domain.</strong> Splitting a key only protects
              you when the pieces live in separate places — on one host, breaking into that host exposes the
              whole key. Run each node on separate infrastructure before relying on this.
            </p>
          )}
        </Panel>
      )}

      <Panel title="What this means" label="current limits, stated plainly">
        <ul style={{ paddingLeft: 18, display: 'grid', gap: 10, fontSize: 13.5 }}>
          {threshold ? (
            <>
              <li>
                <strong>The key never exists in one place.</strong> Each node holds one share. Any {k.threshold.split('-')[0]} of
                the {k.nodes.length} sign together, and the full private key is never assembled — not when it is created, not
                when it signs.
              </li>
              <li>
                <strong>It is yours alone.</strong> Only this workspace's transfers are signed with this address.
              </li>
              <li>
                <strong>Approvals and nodes both have a say.</strong> Your signers' approvals decide whether a transfer is sent
                for signing; each node then rebuilds the transaction itself and can refuse on its own limits.
              </li>
              <li>
                <strong>Fewer nodes than needed means no signing.</strong> With fewer than {k.threshold.split('-')[0]} nodes online,
                an approved transfer is not signed and says why; retry it once enough nodes are back.
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
