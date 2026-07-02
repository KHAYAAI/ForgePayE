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
  Addr,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Wallet — consumer & agent wallets, did:forge identity.
   (OpenPrivy, integrated into the FORGE ecosystem.)
   Email/password onboarding, encrypted keys, social recovery,
   gas sponsorship, and the DID registry the Agent Credit Bureau
   reads for reputation.
   ──────────────────────────────────────────────────────────────── */

export default function WalletConsole() {
  return (
    <>
      <PageHeader
        eyebrow="FORGE / Wallet"
        title={
          <>
            Wallets without <em>seed phrases</em>
          </>
        }
        lede="Email in, wallet out. Keys encrypted with AES-256-GCM, recovery through 2-of-3 trusted contacts, and a did:forge identity for every user and agent."
        actions={<button className="btn-ink btn-sm">Provision Agent Wallet</button>}
      />

      <StatGrid>
        <Stat label="Total wallets" value="18,420" delta="+312 this week" deltaTone="up" />
        <Stat label="Agent wallets" value="1,847" delta="did:forge:agent_*" />
        <Stat label="Transactions / 24h" value="1,204" delta="99.2% confirmed < 3 min" />
        <Stat label="Gas sponsored / 24h" value="$118" delta="~$0.10 per tx" />
        <Stat label="Recoveries open" value="2" delta="2-of-3 contacts required" />
        <Stat label="Routed to Custody" value="14" delta="above $100K tier" />
      </StatGrid>

      <Grid2>
        <Panel title="Recent Transactions" label="signed server-side · key never leaves backend">
          <DataTable
            columns={['Tx', 'From (DID)', 'To', 'Amount', 'Chain', 'Status']}
            rows={[
              [<Mono key="t">tx_88f2</Mono>, <Addr key="f">did:forge:user_8842</Addr>, <Addr key="to">merch_snappay</Addr>, <Mono key="a">$50 USDC</Mono>, 'polygon', <Pill key="s" tone="ok">confirmed</Pill>],
              [<Mono key="t">tx_88ee</Mono>, <Addr key="f">did:forge:agent_001</Addr>, <Addr key="to">0xsupplier…9c03</Addr>, <Mono key="a">$50K USDC</Mono>, 'polygon', <Pill key="s" tone="accent">routed → custody</Pill>],
              [<Mono key="t">tx_88e9</Mono>, <Addr key="f">did:forge:user_5511</Addr>, <Addr key="to">did:forge:user_0197</Addr>, <Mono key="a">$20 USDC</Mono>, 'polygon', <Pill key="s" tone="ok">confirmed</Pill>],
              [<Mono key="t">tx_88e1</Mono>, <Addr key="f">did:forge:agent_114</Addr>, <Addr key="to">api.compute.rent</Addr>, <Mono key="a">$340 USDC</Mono>, 'ethereum', <Pill key="s" tone="ok">confirmed</Pill>],
              [<Mono key="t">tx_88dd</Mono>, <Addr key="f">did:forge:user_2290</Addr>, <Addr key="to">merch_afrobiz</Addr>, <Mono key="a">$129 USDC</Mono>, 'solana', <Pill key="s" tone="warn">broadcast</Pill>],
            ]}
          />
        </Panel>

        <Panel title="Recovery Requests" label="social recovery — no seed phrase">
          <DataTable
            columns={['Request', 'User', 'Approvals', 'Age', 'Status']}
            rows={[
              [<Mono key="r">rec_4410</Mono>, <Addr key="u">did:forge:user_7731</Addr>, <Mono key="a">1 of 3 (need 2)</Mono>, '2h', <Pill key="s" tone="warn">awaiting contacts</Pill>],
              [<Mono key="r">rec_4409</Mono>, <Addr key="u">did:forge:user_1044</Addr>, <Mono key="a">2 of 3</Mono>, '26m', <Pill key="s" tone="accent">password reset open</Pill>],
              [<Mono key="r">rec_4399</Mono>, <Addr key="u">did:forge:user_9210</Addr>, <Mono key="a">2 of 3</Mono>, '1d', <Pill key="s" tone="ok">recovered</Pill>],
            ]}
          />
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Each trusted contact receives a single-use approval token (hash-stored). Two of three
            approvals unlock a password reset; keys re-encrypt under the new credential.
          </p>
        </Panel>
      </Grid2>

      <Grid2>
        <Panel title="DID Registry" label="read by Agent Credit Bureau" ink>
          <DataTable
            columns={['DID', 'Type', 'Chains', 'Tx count', 'Reputation feed']}
            rows={[
              [<Mono key="d">did:forge:agent_001</Mono>, <Pill key="t" tone="accent">agent</Pill>, 'eth · polygon', <Mono key="c">1,204</Mono>, <Pill key="r" tone="ok">streaming</Pill>],
              [<Mono key="d">did:forge:agent_114</Mono>, <Pill key="t" tone="accent">agent</Pill>, 'eth', <Mono key="c">388</Mono>, <Pill key="r" tone="ok">streaming</Pill>],
              [<Mono key="d">did:forge:user_8842</Mono>, <Pill key="t">user</Pill>, 'polygon · solana', <Mono key="c">92</Mono>, <Pill key="r">on demand</Pill>],
            ]}
          />
        </Panel>

        <Panel title="Signing & Routing Contract" label="tier enforcement at the wallet edge">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['< $100K', 'Wallet signs directly. Password-derived key decrypts in-memory; ECDSA/Ed25519 signature; broadcast; 12-block poll.'],
              ['≥ $100K', 'Wallet refuses with 409 route:forge-custody. FORGE Payments re-routes through institutional threshold signing.'],
              ['Every tx', 'Confirmed event emitted to the Revenue Ontology with HMAC-signed webhook — one record, every platform reads it.'],
            ].map(([tier, desc]) => (
              <li
                key={tier}
                style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}
              >
                <span className="mono" style={{ minWidth: 82 }}>{tier}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </Grid2>
    </>
  );
}
