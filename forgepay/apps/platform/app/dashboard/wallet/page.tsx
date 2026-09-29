'use client';

import { useState } from 'react';
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
   FORGE Wallet — backed by open-privy, a real NestJS service with its
   own Postgres database (services/backend in the open-privy repo,
   vendored as the forge-wallet replacement). Every field on this page
   comes from open-privy's real wallet/transactions/recovery endpoints
   via lib/openprivy.ts — nothing here is simulated.

   Chain balances are deliberately not shown: they require a live RPC
   call per wallet, and this deployment's network egress doesn't reach
   any RPC provider. A real deployment with a configured
   ETHEREUM_RPC_SEPOLIA / ETHEREUM_RPC_POLYGON would show them.
   ──────────────────────────────────────────────────────────────── */

interface Wallet { id: string; address: string; chain: string; createdAt: string }
interface Transaction {
  id: string; txHash: string | null; fromAddress: string; toAddress: string;
  amount: string; status: string; createdAt: string; confirmedAt: string | null;
}
interface RecoveryContact { id: string; contactEmail: string; contactName: string; isVerified: boolean }

interface WalletSummary {
  stats: {
    total_wallets: number;
    chains: string[];
    transactions_total: number;
    confirmed_rate: number;
    recovery_guardians: number;
    recovery_required_approvals: number;
  };
  wallets: Wallet[];
  recent_transactions: Transaction[];
  recovery_contacts: RecoveryContact[];
}

const EMPTY: WalletSummary = {
  stats: { total_wallets: 0, chains: [], transactions_total: 0, confirmed_rate: 0, recovery_guardians: 0, recovery_required_approvals: 0 },
  wallets: [],
  recent_transactions: [],
  recovery_contacts: [],
};

const TX_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  pending: 'warn',
  confirmed: 'ok',
  failed: 'danger',
};

const CHAINS = ['ethereum', 'polygon', 'solana'] as const;

export default function WalletConsole() {
  const { data, live, reload } = useForge<WalletSummary>('wallet', EMPTY);
  const [chain, setChain] = useState<(typeof CHAINS)[number]>('ethereum');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/forge/wallet-create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chain }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? 'Could not create that wallet.');
        return;
      }
      reload();
    } catch {
      setError('Could not reach the wallet service.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Wallet"
        title={
          <>
            Wallets without <em>seed phrases</em>
          </>
        }
        lede="Keys encrypted with AES-256-GCM, one wallet per chain, recovery through trusted contacts instead of a seed phrase to lose."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat label="Total wallets" value={data.stats.total_wallets.toLocaleString('en-US')} delta={data.stats.chains.join(' · ') || 'no chains yet'} />
        <Stat label="Transactions" value={data.stats.transactions_total.toLocaleString('en-US')} delta={`${data.stats.confirmed_rate}% confirmed`} deltaTone={data.stats.confirmed_rate >= 90 ? 'up' : undefined} />
        <Stat label="Recovery guardians" value={data.stats.recovery_guardians} delta={`${data.stats.recovery_required_approvals} approvals required`} />
      </StatGrid>

      <Panel title="Create a Wallet" label="POST /wallet/create · one per chain" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--steel)', marginBottom: 6 }}>
              Chain
            </label>
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value as (typeof CHAINS)[number])}
              style={{ border: '1px solid var(--hair)', background: 'var(--paper)', padding: '10px 12px', fontSize: 13.5, color: 'var(--ink)', fontFamily: 'inherit' }}
            >
              {CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button className="btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating…' : 'Create wallet'}
          </button>
        </div>
        {error && <p className="lede" style={{ fontSize: 13, color: 'var(--danger)', marginTop: 14 }}>{error}</p>}
      </Panel>

      <Panel title="Wallets" label="GET /wallet/list" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Address', 'Chain', 'Created']}
          emptyMessage="No wallets created yet."
          rows={data.wallets.map((w) => [
            <Addr key="a">{w.address}</Addr>,
            <Pill key="c" tone="accent">{w.chain}</Pill>,
            <Mono key="d">{new Date(w.createdAt).toLocaleDateString('en-US')}</Mono>,
          ])}
        />
      </Panel>

      <Grid2>
        <Panel title="Recent Transactions" label="GET /transactions/history · signed server-side">
          <DataTable
            columns={['Tx', 'From', 'To', 'Amount', 'Status']}
            emptyMessage="No transactions yet."
            rows={data.recent_transactions.map((t) => [
              <Mono key="t">{t.id.slice(0, 8)}</Mono>,
              <Addr key="f">{t.fromAddress}</Addr>,
              <Addr key="to">{t.toAddress}</Addr>,
              <Mono key="a">{t.amount}</Mono>,
              <Pill key="s" tone={TX_TONE[t.status]}>{t.status}</Pill>,
            ])}
          />
        </Panel>

        <Panel title="Recovery Contacts" label="GET /recovery/contacts · social recovery">
          <DataTable
            columns={['Contact', 'Email', 'Verified']}
            emptyMessage="No recovery contacts added yet."
            rows={data.recovery_contacts.map((c) => [
              c.contactName,
              <Mono key="e">{c.contactEmail}</Mono>,
              <Pill key="v" tone={c.isVerified ? 'ok' : 'warn'}>{c.isVerified ? 'verified' : 'pending'}</Pill>,
            ])}
          />
        </Panel>
      </Grid2>
    </>
  );
}
