'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import {
  Building2,
  Plus,
  RefreshCw,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Link as LinkIcon,
} from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AccountBalance {
  accountId: string;
  bankName: string;
  accountName: string;
  accountType: 'checking' | 'savings' | 'investment';
  balance: number;
  currency: string;
  lastRefreshed: string;
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i}>
          <div className="h-4 bg-white/5 rounded animate-pulse w-24" />
        </td>
      ))}
    </tr>
  );
}

function fmt(cents: number, currency: string) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase() });
}

export default function BankAccountsPage() {
  const { data, isLoading, error } =
    useSWR<{ data: AccountBalance[] }>('/api/bank/accounts', fetcher);

  const accounts: AccountBalance[] = data?.data ?? [];

  const [linking, setLinking]           = useState(false);
  const [linkState, setLinkState]       = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [linkMessage, setLinkMessage]   = useState('');
  const [refreshing, setRefreshing]     = useState<Record<string, boolean>>({});
  const [removing, setRemoving]         = useState<Record<string, boolean>>({});

  const handleAddAccount = async () => {
    setLinking(true);
    setLinkState('idle');
    try {
      const res = await fetch('/api/bank/link-token', { method: 'POST' });
      if (!res.ok) throw new Error('Could not create link token');
      const body = (await res.json()) as { linkToken: string; expiration: string };

      // In production: initialize Plaid Link with body.linkToken
      // For now we simulate the flow with a status message
      setLinkState('pending');
      setLinkMessage(
        `Plaid Link token obtained (expires ${new Date(body.expiration).toLocaleTimeString()}). ` +
        `In production, Plaid Link would open here. To complete the flow, call POST /api/bank/exchange with the public_token.`,
      );
    } catch (err) {
      setLinkState('error');
      setLinkMessage(err instanceof Error ? err.message : 'Failed to start account linking');
    } finally {
      setLinking(false);
    }
  };

  const handleRefresh = async (accountId: string) => {
    setRefreshing((r) => ({ ...r, [accountId]: true }));
    try {
      // Trigger a balance refresh — in production this calls the bank connectivity service
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await mutate('/api/bank/accounts');
    } finally {
      setRefreshing((r) => ({ ...r, [accountId]: false }));
    }
  };

  const handleRemove = async (accountId: string) => {
    if (!confirm('Remove this bank account? This cannot be undone.')) return;
    setRemoving((r) => ({ ...r, [accountId]: true }));
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await mutate('/api/bank/accounts');
    } finally {
      setRemoving((r) => ({ ...r, [accountId]: false }));
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Building2 size={20} className="text-cyan-400" />
            Bank Accounts
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Link accounts for treasury and payouts
          </p>
        </div>
        <button
          onClick={handleAddAccount}
          disabled={linking}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
        >
          {linking ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {linking ? 'Connecting...' : 'Add Account'}
        </button>
      </div>

      {/* Link state messages */}
      {linkState === 'pending' && (
        <div className="flex items-start gap-3 bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
          <LinkIcon size={15} className="text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-300">Link in progress</p>
            <p className="text-xs text-blue-200/70 mt-1 leading-relaxed">{linkMessage}</p>
          </div>
          <button
            onClick={() => setLinkState('idle')}
            className="ml-auto text-gray-500 hover:text-gray-300 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {linkState === 'success' && (
        <div className="flex items-center gap-2 bg-green-500/5 border border-green-500/20 rounded-xl p-4 text-green-400 text-sm">
          <CheckCircle2 size={15} />
          Account linked successfully.
          <button onClick={() => setLinkState('idle')} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {linkState === 'error' && (
        <div className="flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
          <AlertCircle size={15} />
          {linkMessage}
          <button onClick={() => setLinkState('idle')} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Accounts table */}
      <div className="card overflow-hidden">
        <table className="w-full fp-table">
          <thead>
            <tr>
              <th>Bank</th>
              <th>Account</th>
              <th>Type</th>
              <th>Balance</th>
              <th>Last Refreshed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : error ? (
              <tr>
                <td colSpan={6} className="text-center py-8">
                  <AlertCircle className="mx-auto mb-2 text-red-400" size={24} />
                  <p className="text-sm text-red-400">Failed to load accounts</p>
                </td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12">
                  <Building2 className="mx-auto mb-3 text-gray-600" size={32} />
                  <p className="text-white font-semibold text-sm">No bank accounts linked</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Click &ldquo;Add Account&rdquo; to link your first bank account via Plaid.
                  </p>
                </td>
              </tr>
            ) : (
              accounts.map((acc) => (
                <tr key={acc.accountId}>
                  <td className="font-medium text-white">{acc.bankName}</td>
                  <td className="text-gray-300">{acc.accountName}</td>
                  <td>
                    <span className="text-xs capitalize px-2 py-0.5 rounded-full border bg-white/5 border-white/10 text-gray-300">
                      {acc.accountType}
                    </span>
                  </td>
                  <td className="font-semibold text-white">
                    {fmt(acc.balance, acc.currency)}
                  </td>
                  <td className="text-gray-400 text-xs">
                    {new Date(acc.lastRefreshed).toLocaleString('en-US', {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRefresh(acc.accountId)}
                        disabled={refreshing[acc.accountId]}
                        className="text-gray-500 hover:text-cyan-400 transition-colors disabled:opacity-50"
                        title="Refresh balance"
                      >
                        {refreshing[acc.accountId]
                          ? <Loader2 size={13} className="animate-spin" />
                          : <RefreshCw size={13} />}
                      </button>
                      <button
                        onClick={() => handleRemove(acc.accountId)}
                        disabled={removing[acc.accountId]}
                        className="text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Remove account"
                      >
                        {removing[acc.accountId]
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Trash2 size={13} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 text-center">
        Bank account data is provided by Plaid. ForgePay never stores your banking credentials.
      </p>
    </div>
  );
}
