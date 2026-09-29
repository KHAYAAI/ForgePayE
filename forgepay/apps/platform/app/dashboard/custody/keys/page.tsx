'use client';

import { PageHeader, Panel, Pill, DataTable, LivePill, Mono, Addr } from '@/components/forge/ui';
import { useCustody } from '@/components/forge/useCustody';

/* FORGE Custody — Keys. Reported exactly as the signer runs today: one
   ECDSA key, shared by every workspace. Threshold (MPC) signing exists in
   openfireblocks' codebase but is not in the live signing path yet. */

export default function CustodyKeys() {
  const { data, live } = useCustody();
  const k = data.signing_key;

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Keys"
        title={<>The key that <em>signs</em></>}
        lede="What actually signs your transfers, as it runs today."
        actions={<LivePill live={live} />}
      />

      <Panel title="Signing Key" label="read from the signer service" ink style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Address', 'Scheme', 'Threshold', 'Stored in', 'Signer']}
          emptyMessage="The signer service is unreachable."
          rows={k.address ? [[
            <Addr key="a">{k.address}</Addr>,
            k.scheme,
            <Mono key="t">{k.threshold}</Mono>,
            k.storage,
            <Pill key="r" tone={k.signer_reachable ? 'ok' : 'danger'}>{k.signer_reachable ? 'online' : 'unreachable'}</Pill>,
          ]] : []}
        />
      </Panel>

      <Panel title="What this means" label="current limits, stated plainly">
        <ul style={{ paddingLeft: 18, display: 'grid', gap: 10, fontSize: 13.5 }}>
          <li>
            <strong>One key, not threshold signing.</strong> A single private key signs every transfer. Your
            workspace's approval quorum decides <em>whether</em> a transfer is signed — it is not split across
            separate key holders.
          </li>
          {k.shared_across_workspaces && (
            <li>
              <strong>Shared across workspaces.</strong> Every workspace on this deployment signs with the same
              address. Per-workspace keys arrive with threshold (MPC) signing.
            </li>
          )}
          <li>
            <strong>{k.storage === 'environment variable' ? 'Not in Vault yet.' : 'Held in Vault.'}</strong>{' '}
            {k.storage === 'environment variable'
              ? 'The key is supplied to the signer as an environment variable. Production deployments load it from HashiCorp Vault instead.'
              : 'The signer loads the key from HashiCorp Vault at start-up.'}
          </li>
        </ul>
      </Panel>
    </>
  );
}
