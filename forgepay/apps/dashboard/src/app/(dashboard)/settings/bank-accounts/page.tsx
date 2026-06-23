'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { usePlaidLink } from 'react-plaid-link';
import { Building2, Plus, RefreshCw, Trash2, CheckCircle, AlertTriangle, Landmark } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then(r => r.json());

// PlaidLinkButton: inner component that holds usePlaidLink hook
// (must receive token as prop so hook only runs when token is available)
function PlaidLinkButton({ token, onSuccess, onExit }: {
  token: string;
  onSuccess: (publicToken: string, metadata: unknown) => void;
  onExit: (err: unknown) => void;
}) {
  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });
  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-semibold transition-colors disabled:opacity-50"
    >
      <Plus size={14} />
      {ready ? 'Add Account' : 'Loading...'}
    </button>
  );
}

export default function BankAccountsPage() {
  const { data, isLoading, mutate } = useSWR('/api/bank/accounts', fetcher);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const accounts = data?.data ?? [];

  const handleAddAccount = async () => {
    setLinking(true);
    setError(null);
    try {
      const res = await fetch('/api/bank/link-token', { method: 'POST' });
      const { linkToken: token } = await res.json();
      setLinkToken(token);
    } catch (e) {
      setError('Failed to start account linking. Try again.');
      setLinking(false);
    }
  };

  const handleSuccess = useCallback(async (publicToken: string, metadata: unknown) => {
    try {
      const res = await fetch('/api/bank/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicToken, metadata }),
      });
      if (res.ok) {
        setSuccess('Account linked successfully');
        setLinkToken(null);
        setLinking(false);
        await mutate();
      }
    } catch {
      setError('Account linking failed.');
    }
  }, [mutate]);

  const handleExit = useCallback((err: unknown) => {
    if (err) setError('Account linking cancelled or failed.');
    setLinkToken(null);
    setLinking(false);
  }, []);

  const handleRefresh = async (accountId: string) => { /* PATCH /api/bank/accounts/{id}/refresh */ };
  const handleRemove  = async (accountId: string) => {
    await fetch(`/api/bank/accounts/${accountId}`, { method: 'DELETE' });
    await mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Bank Accounts</h1>
          <p className="text-sm text-gray-400">Link accounts for treasury and payouts</p>
        </div>
        {!linkToken && (
          <button
            onClick={handleAddAccount}
            disabled={linking}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-semibold transition-colors disabled:opacity-50"
          >
            <Plus size={14} />
            {linking ? 'Starting...' : 'Add Account'}
          </button>
        )}
        {linkToken && (
          <PlaidLinkButton token={linkToken} onSuccess={handleSuccess} onExit={handleExit} />
        )}
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertTriangle size={16} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle size={16} className="text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300">{success}</p>
        </div>
      )}

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Linked Accounts</h3>
        {isLoading ? (
          <div className="space-y-3">
            {[1,2].map(i => <div key={i} className="h-12 rounded-lg bg-white/[0.03] animate-pulse" />)}
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-3">
            <Landmark size={32} className="text-gray-600" />
            <p className="text-sm text-gray-400">No accounts linked yet</p>
            <p className="text-xs text-gray-600">Add a bank account to enable treasury sweeps and payouts</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-500 border-b border-white/[0.05]">
                  <th className="text-left pb-2">Bank</th>
                  <th className="text-left pb-2">Account</th>
                  <th className="text-left pb-2">Type</th>
                  <th className="text-right pb-2">Balance</th>
                  <th className="text-right pb-2">Refreshed</th>
                  <th className="text-right pb-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {accounts.map((acct: Record<string, unknown>) => (
                  <tr key={acct.id as string} className="text-xs">
                    <td className="py-3 text-white font-medium">{acct.bankName as string}</td>
                    <td className="py-3 text-gray-300">{acct.accountName as string}</td>
                    <td className="py-3">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                        {acct.accountType as string}
                      </span>
                    </td>
                    <td className="py-3 text-right text-white">
                      ${Number(acct.balanceAvail ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 text-right text-gray-500 text-[11px]">
                      {acct.lastRefreshed ? new Date(acct.lastRefreshed as string).toLocaleString() : '—'}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleRefresh(acct.id as string)}
                          className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
                          title="Refresh balance"
                        >
                          <RefreshCw size={12} className="text-gray-400" />
                        </button>
                        <button
                          onClick={() => handleRemove(acct.id as string)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                          title="Remove account"
                        >
                          <Trash2 size={12} className="text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-5 border border-cyan-500/10">
        <div className="flex items-start gap-3">
          <Building2 size={16} className="text-cyan-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-white mb-1">How bank linking works</h4>
            <p className="text-xs text-gray-400 leading-relaxed">
              ForgePay uses Plaid to securely link your bank accounts. Your credentials are never stored —
              only an encrypted access token that allows balance reads and payment initiation.
              Linked accounts are used for treasury sweeps, payouts, and intercompany netting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
