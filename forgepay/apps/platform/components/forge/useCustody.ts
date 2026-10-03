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

export interface Vote { email: string; approve: boolean; voted_at: string; signed?: boolean }

export interface Proposal {
  id: string;
  kind: 'add_signer' | 'remove_signer' | 'set_threshold' | 'rotate_key' | 'approve_transaction';
  payload: Record<string, any>;
  status: 'open' | 'executed' | 'rejected' | 'failed';
  required: number;
  request_id: string | null;
  created_by: string;
  created_at: string;
  decided_at: string | null;
  result: Record<string, any> | null;
  votes: Vote[];
  /** What a signer signs to vote (see the signer's CLI). `required` is true when votes must carry the signer's own signature. */
  signing?: { required: boolean; digest: string; domain: string };
  /** The transfer's row in signing.transactions (approve_transaction proposals only, once one exists). */
  tx?: ChainTx | null;
}

/** Where a transfer stands on the network. */
export interface ChainTx {
  status: TxStatus;
  tx_hash: string | null;
  nonce: number | null;
  block_number: number | null;
  confirmations: number | null;
  /** Broadcast error, revert reason or stuck explanation. */
  detail: string | null;
  chain_id: number | null;
}

export type TxStatus =
  | 'pending_approval' | 'rejected' | 'failed'
  | 'signed'                // signed, no network configured
  | 'broadcasting' | 'signed_not_broadcast' | 'broadcasted' | 'confirmed' | 'stuck';

export interface CustodyTransaction {
  request_id: string;
  to_address: string;
  amount: string;
  nonce: number;
  status: TxStatus | string;
  tx_hash: string | null;
  created_at: string;
  updated_at: string;
  chain_id: number | null;
  block_number: number | null;
  confirmations: number | null;
  detail: string | null;
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
  /** The network the gateway broadcasts to, and the signing address's balance on it. */
  network: {
    rpc_configured: boolean;
    chain_id: number | null;
    network_name: string | null;
    address: string | null;
    /** Wei, base-10 string. null when there is no network or it can't be reached (see balance_error). */
    balance_wei: string | null;
    balance_error: string | null;
    confirmations_required: number;
  };
  signing_key: {
    mode: 'threshold' | 'single' | '';
    /** false until the workspace's key has been created (threshold mode creates it on first use). */
    provisioned: boolean;
    address: string | null;
    signer_reachable: boolean;
    scheme: string;
    threshold: string;
    shared_across_workspaces: boolean;
    storage: string;
    nodes: Array<{
      id: string;
      domain: string;
      reachable: boolean;
      /** Whether this node holds a share of this workspace's key. */
      holds_key?: boolean;
      /** Where the node keeps its seal key: file (development only), env, vault, awskms. */
      seal_provider?: string;
      mtls?: boolean;
      /** The node's own report of its encrypted key-share backups. */
  backup?: { enabled: boolean; stale?: boolean; coversCurrentShares?: boolean; lastError?: string; lastOk?: string } | null;
      /** The node's own signing rules, which it enforces whatever the gateway asks. */
      policy?: { digest: string; active: string[] } | null;
    }>;
    trust_domains: number;
    /** Trust domains that hold enough nodes to sign without anyone else. Empty is what a sound setup looks like. */
    exposed_domains: string[];
    production: boolean;
    can_sign: boolean;
    created_at: string | null;
    /** How many times the key has been re-split; 0 = as first generated. The address never changes. */
    epoch: number;
    /** The nodes that currently hold a share. */
    committee: string[];
    signers_needed: number;
    /** Nodes still holding a share from before the last rotation (they were offline for it). */
    stale_nodes: string[];
    rotated_at: string | null;
    /** Address of the old shared signer key that signed this workspace's earlier transactions, if any. */
    legacy_signer_address: string | null;
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
  network: { rpc_configured: false, chain_id: null, network_name: null, address: null, balance_wei: null, balance_error: null, confirmations_required: 1 },
  signing_key: { mode: '', provisioned: false, address: null, signer_reachable: false, scheme: '', threshold: '', shared_across_workspaces: false, storage: '', nodes: [], trust_domains: 0, exposed_domains: [], production: false, can_sign: false, created_at: null, epoch: 0, committee: [], signers_needed: 0, stale_nodes: [], rotated_at: null, legacy_signer_address: null },
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

/** Block-explorer link for a tx hash, or null unless NEXT_PUBLIC_EXPLORER_TX_URL is configured.
    The value is a URL with `{hash}` in it, or a base URL the hash is appended to. */
export function explorerUrl(hash: string | null | undefined): string | null {
  const tpl = process.env.NEXT_PUBLIC_EXPLORER_TX_URL;
  if (!tpl || !hash) return null;
  return tpl.includes('{hash}') ? tpl.replace('{hash}', hash) : `${tpl}${hash}`;
}

export function shortTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function useCustody() {
  const { data, live, reload } = useForge<CustodyConsole>('custody', EMPTY_CUSTODY, 5_000);
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


/**
 * When the workspace requires signed votes, the signer signs on their own machine (scripts/signer-cli.ts in the
 * OpenFireblocks gateway) and pastes the signature here. The console never holds a signing key, so it cannot vote for
 * anyone. Returns undefined when no signature is needed, null if the signer cancelled.
 */
export function askSignature(p: { id: string; kind: string; signing?: { required: boolean; digest: string } }, approve: boolean): string | undefined | null {
  if (!p.signing?.required) return undefined;
  const v = window.prompt(
    `This workspace requires your own signature to ${approve ? 'approve' : 'reject'} this ${p.kind.replace(/_/g, ' ')}.\n\n` +
    `On your own machine run:\n  signer-cli vote --key <your key file> --proposal <proposal.json> --${approve ? 'approve' : 'reject'}\n` +
    `and check that what it prints is what you mean to approve (digest ${p.signing.digest.slice(0, 16)}…).\n\nPaste the signature:`,
  );
  return v === null ? null : v.trim();
}
