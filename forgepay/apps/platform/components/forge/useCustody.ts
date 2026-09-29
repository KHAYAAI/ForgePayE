'use client';

import { useState } from 'react';
import { useForge } from './useForge';

/* Shape of openfireblocks' GET /admin/customers/:id/custody/console, plus
   `viewer` (the signed-in user's email), added by /api/forge/custody. */

export interface Signer {
  id: string;
  email: string;
  name: string | null;
  status: 'active' | 'removed';
  added_at: string;
  active_from: string;
  removed_at: string | null;
  eligible: boolean;
}

export interface Vote { email: string; approve: boolean; voted_at: string }

export interface Proposal {
  id: string;
  kind: 'add_signer' | 'remove_signer' | 'set_threshold' | 'approve_transaction';
  payload: Record<string, any>;
  status: 'open' | 'executed' | 'rejected' | 'failed';
  required: number;
  request_id: string | null;
  created_by: string;
  created_at: string;
  decided_at: string | null;
  result: Record<string, any> | null;
  votes: Vote[];
}

export interface CustodyTransaction {
  request_id: string;
  to_address: string;
  amount: string;
  nonce: number;
  status: 'signed' | 'broadcasted' | 'pending_approval' | 'rejected' | 'failed' | string;
  tx_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  id: string;
  event_type: string;
  actor: string;
  request_id: string | null;
  message: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CustodyConsole {
  viewer: string;
  workspace: { customer_id: string; tier: string; status: string };
  settings: { threshold: number; cooling_off_hours: number; effective_required: number };
  stats: {
    signed_24h: number;
    signed_wei_24h: string;
    pending_approval: number;
    denied_7d: number;
    active_signers: number;
    connected_apps: number;
  };
  signing_key: {
    address: string | null;
    signer_reachable: boolean;
    scheme: string;
    threshold: string;
    shared_across_workspaces: boolean;
    storage: string;
  };
  signers: Signer[];
  proposals: Proposal[];
  transactions: CustodyTransaction[];
  audit: AuditEvent[];
  api_keys: ApiKey[];
}

export const EMPTY_CUSTODY: CustodyConsole = {
  viewer: '',
  workspace: { customer_id: '', tier: '', status: '' },
  settings: { threshold: 2, cooling_off_hours: 24, effective_required: 0 },
  stats: { signed_24h: 0, signed_wei_24h: '0', pending_approval: 0, denied_7d: 0, active_signers: 0, connected_apps: 0 },
  signing_key: { address: null, signer_reachable: false, scheme: '', threshold: '', shared_across_workspaces: false, storage: '' },
  signers: [],
  proposals: [],
  transactions: [],
  audit: [],
  api_keys: [],
};

/** Wei (base-10 string) to a short ETH string, exactly — no float rounding. */
export function formatEth(wei: string | null | undefined): string {
  if (!wei) return '0 ETH';
  const n = BigInt(wei);
  const whole = n / 10n ** 18n;
  const frac = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '').slice(0, 6);
  return `${whole}${frac ? `.${frac}` : ''} ETH`;
}

export function shortTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function useCustody() {
  const { data, live, reload } = useForge<CustodyConsole>('custody', EMPTY_CUSTODY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = data.signers.find((s) => s.email === data.viewer && s.status === 'active');

  /** Run one custody action as the signed-in user, then refresh. */
  async function act(body: Record<string, unknown>): Promise<any | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/forge/custody-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.message ?? 'That action failed.');
        return null;
      }
      reload();
      return json?.data ?? {};
    } catch {
      setError('Could not reach the custody service.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { data, live, reload, act, busy, error, me };
}
