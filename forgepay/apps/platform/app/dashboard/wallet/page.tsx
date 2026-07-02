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
  Addr,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   FORGE Wallet — consumer & agent wallets, did:forge identity.
   (OpenPrivy, integrated into the FORGE ecosystem.)
   Live-wired to forge-wallet GET /api/v1/console/summary via the
   /api/forge/wallet proxy; demo fixtures render when offline.
   ──────────────────────────────────────────────────────────────── */

interface WalletSummary {
  stats: {
    total_wallets: number;
    agent_wallets: number;
    user_wallets: number;
    transactions_24h: number;
    confirmed_rate_24h: number;
    gas_sponsored_24h_usd: number;
    recoveries_open: number;
    routed_to_custody_24h: number;
  };
  recent_transactions: Array<{
    id: string;
    from_did: string;
    to_address: string;
    amount: number;
    currency: string;
    blockchain: string;
    status: string;
    created_at: string;
  }>;
  recovery_requests: Array<{
    id: string;
    user_did: string;
    approvals: number;
    required_approvals: number;
    status: string;
    created_at: string;
  }>;
  dids: Array<{ did: string; type: 'user' | 'agent'; chains: string[]; tx_count: number }>;
}

const DEMO: WalletSummary = {
  stats: {
    total_wallets: 18_420,
    agent_wallets: 1_847,
    user_wallets: 16_573,
    transactions_24h: 1_204,
    confirmed_rate_24h: 99.2,
    gas_sponsored_24h_usd: 118,
    recoveries_open: 2,
    routed_to_custody_24h: 14,
  },
  recent_transactions: [
    { id: 'tx_88f2', from_did: 'did:forge:user_8842', to_address: 'merch_snappay', amount: 50, currency: 'USDC', blockchain: 'polygon', status: 'confirmed', created_at: '' },
    { id: 'tx_88ee', from_did: 'did:forge:agent_001', to_address: '0xsupplier…9c03', amount: 50_000, currency: 'USDC', blockchain: 'polygon', status: 'confirmed', created_at: '' },
    { id: 'tx_88e9', from_did: 'did:forge:user_5511', to_address: 'did:forge:user_0197', amount: 20, currency: 'USDC', blockchain: 'polygon', status: 'confirmed', created_at: '' },
    { id: 'tx_88e1', from_did: 'did:forge:agent_114', to_address: 'api.compute.rent', amount: 340, currency: 'USDC', blockchain: 'ethereum', status: 'confirmed', created_at: '' },
    { id: 'tx_88dd', from_did: 'did:forge:user_2290', to_address: 'merch_afrobiz', amount: 129, currency: 'USDC', blockchain: 'solana', status: 'broadcast', created_at: '' },
  ],
  recovery_requests: [
    { id: 'rec_4410', user_did: 'did:forge:user_7731', approvals: 1, required_approvals: 2, status: 'pending', created_at: '' },
    { id: 'rec_4409', user_did: 'did:forge:user_1044', approvals: 2, required_approvals: 2, status: 'approved', created_at: '' },
    { id: 'rec_4399', user_did: 'did:forge:user_9210', approvals: 2, required_approvals: 2, status: 'completed', created_at: '' },
  ],
  dids: [
    { did: 'did:forge:agent_001', type: 'agent', chains: ['ethereum', 'polygon'], tx_count: 1204 },
    { did: 'did:forge:agent_114', type: 'agent', chains: ['ethereum'], tx_count: 388 },
    { did: 'did:forge:user_8842', type: 'user', chains: ['polygon', 'solana'], tx_count: 92 },
  ],
};

const TX_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  created: 'warn',
  signed: 'accent',
  broadcast: 'warn',
  confirmed: 'ok',
  failed: 'danger',
};

const REC_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  pending: 'warn',
  approved: 'accent',
  completed: 'ok',
  expired: 'danger',
};

export default function WalletConsole() {
  const { data, live } = useForge<WalletSummary>('wallet', DEMO);

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
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat label="Total wallets" value={data.stats.total_wallets.toLocaleString('en-US')} delta={`${data.stats.user_wallets.toLocaleString('en-US')} users`} />
        <Stat label="Agent wallets" value={data.stats.agent_wallets.toLocaleString('en-US')} delta="did:forge:agent_*" />
        <Stat label="Transactions / 24h" value={data.stats.transactions_24h.toLocaleString('en-US')} delta={`${data.stats.confirmed_rate_24h}% confirmed`} deltaTone={data.stats.confirmed_rate_24h >= 99 ? 'up' : 'down'} />
        <Stat label="Gas sponsored / 24h" value={`$${data.stats.gas_sponsored_24h_usd}`} delta="~$0.10 per tx" />
        <Stat label="Recoveries open" value={data.stats.recoveries_open} delta="2-of-3 contacts required" />
        <Stat label="Routed to Custody" value={data.stats.routed_to_custody_24h} delta="above $100K tier" />
      </StatGrid>

      <Grid2>
        <Panel title="Recent Transactions" label="signed server-side · key never leaves backend">
          <DataTable
            columns={['Tx', 'From (DID)', 'To', 'Amount', 'Chain', 'Status']}
            rows={data.recent_transactions.map((t) => [
              <Mono key="t">{t.id.slice(0, 8)}</Mono>,
              <Addr key="f">{t.from_did}</Addr>,
              <Addr key="to">{t.to_address}</Addr>,
              <Mono key="a">${t.amount.toLocaleString('en-US')} {t.currency}</Mono>,
              t.blockchain,
              <Pill key="s" tone={TX_TONE[t.status]}>{t.status}</Pill>,
            ])}
          />
        </Panel>

        <Panel title="Recovery Requests" label="social recovery — no seed phrase">
          <DataTable
            columns={['Request', 'User', 'Approvals', 'Status']}
            rows={data.recovery_requests.map((r) => [
              <Mono key="r">{r.id.slice(0, 10)}</Mono>,
              <Addr key="u">{r.user_did}</Addr>,
              <Mono key="a">{r.approvals} of {r.required_approvals} required</Mono>,
              <Pill key="s" tone={REC_TONE[r.status]}>{r.status}</Pill>,
            ])}
          />
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Each trusted contact receives a single-use approval token (hash-stored). Two of three
            approvals unlock a password reset; keys rotate under the new credential.
          </p>
        </Panel>
      </Grid2>

      <Grid2>
        <Panel title="DID Registry" label="read by Agent Credit Bureau" ink>
          <DataTable
            columns={['DID', 'Type', 'Chains', 'Tx count']}
            rows={data.dids.map((d) => [
              <Mono key="d">{d.did}</Mono>,
              <Pill key="t" tone={d.type === 'agent' ? 'accent' : undefined}>{d.type}</Pill>,
              d.chains.join(' · '),
              <Mono key="c">{d.tx_count.toLocaleString('en-US')}</Mono>,
            ])}
          />
        </Panel>

        <Panel title="Signing & Routing Contract" label="tier enforcement at the wallet edge">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['< $100K', 'Wallet signs directly. Password-derived key decrypts in-memory; signature; broadcast; 12-block poll.'],
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
