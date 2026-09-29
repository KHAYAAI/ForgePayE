/**
 * open-privy adapter — the real backend behind FORGE Wallet.
 *
 * open-privy's own signup (Supabase-backed) and SSO (WorkOS) paths both
 * require external accounts we don't run in this deployment. Its JWT
 * strategy accepts a Bearer token signed with a shared secret, so instead
 * we provision one open-privy `users` row per FORGE tenant directly (a
 * narrow, deliberate exception to "talk to services over HTTP, not their
 * database" — justified only because open-privy's own provisioning route
 * isn't reachable here) and mint short-lived tokens for it ourselves. One
 * open-privy identity per FORGE tenant, not per FORGE human user — wallets
 * in the console are a tenant-level resource, matching how Custody/Wallet
 * have always been modeled here.
 */

import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { query as platformQuery, execute as platformExecute } from './db';

const OPENPRIVY_URL = process.env.OPENPRIVY_URL ?? 'http://localhost:3021';
const TIMEOUT_MS = 5000;

let openPrivyPool: Pool | null = null;
function getOpenPrivyPool(): Pool {
  if (!openPrivyPool) {
    const connectionString = process.env.OPENPRIVY_DATABASE_URL;
    if (!connectionString) throw new Error('OPENPRIVY_DATABASE_URL is not set');
    openPrivyPool = new Pool({ connectionString, max: 5 });
  }
  return openPrivyPool;
}

function getJwtSecret(): string {
  const secret = process.env.OPENPRIVY_JWT_SECRET;
  if (!secret) throw new Error('OPENPRIVY_JWT_SECRET is not set');
  return secret;
}

interface OpenPrivyIdentity {
  userId: string;
  email: string;
}

/** Look up (or provision, on first use) this tenant's open-privy identity. */
export async function ensureOpenPrivyIdentity(tenantId: string): Promise<OpenPrivyIdentity> {
  const email = `tenant-${tenantId}@forge.internal`;

  const rows = await platformQuery<{ openprivy_user_id: string | null }>(
    'SELECT openprivy_user_id FROM tenants WHERE id = $1',
    [tenantId],
  );
  if (rows[0]?.openprivy_user_id) {
    return { userId: rows[0].openprivy_user_id, email };
  }

  const pool = getOpenPrivyPool();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (id, email, "emailVerified")
     VALUES (gen_random_uuid(), $1, true)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email],
  );
  const userId = result.rows[0].id;
  await platformExecute('UPDATE tenants SET openprivy_user_id = $1 WHERE id = $2', [userId, tenantId]);
  return { userId, email };
}

function mintToken(identity: OpenPrivyIdentity): string {
  return jwt.sign({ sub: identity.userId, email: identity.email }, getJwtSecret(), { expiresIn: '5m' });
}

async function call<T>(identity: OpenPrivyIdentity, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${OPENPRIVY_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${mintToken(identity)}`,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`open-privy ${path} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface OpenPrivyWallet {
  id: string;
  address: string;
  chain: string;
  createdAt: string;
}

export interface OpenPrivyTransaction {
  id: string;
  txHash: string | null;
  fromAddress: string;
  toAddress: string;
  amount: string;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface OpenPrivyRecoveryContact {
  id: string;
  contactEmail: string;
  contactName: string;
  isVerified: boolean;
}

export interface OpenPrivyRecoveryStatus {
  totalGuardians: number;
  approvedGuardians: number;
  requiredApprovals: number;
  recoveryInitiated: boolean;
  canComplete: boolean;
}

export async function listWallets(tenantId: string): Promise<OpenPrivyWallet[]> {
  const identity = await ensureOpenPrivyIdentity(tenantId);
  return call<OpenPrivyWallet[]>(identity, '/wallet/list');
}

export async function createWallet(tenantId: string, chain: string): Promise<OpenPrivyWallet> {
  const identity = await ensureOpenPrivyIdentity(tenantId);
  return call<OpenPrivyWallet>(identity, '/wallet/create', {
    method: 'POST',
    body: JSON.stringify({ chain }),
  });
}

export async function getWalletBalance(
  tenantId: string,
  walletId: string,
): Promise<{ balance: string; unit: string }> {
  const identity = await ensureOpenPrivyIdentity(tenantId);
  return call(identity, `/wallet/${encodeURIComponent(walletId)}/balance`);
}

export async function listTransactions(tenantId: string, limit = 20): Promise<OpenPrivyTransaction[]> {
  const identity = await ensureOpenPrivyIdentity(tenantId);
  const body = await call<{ count: number; transactions: OpenPrivyTransaction[] }>(
    identity,
    `/transactions/history?limit=${limit}`,
  );
  return body.transactions;
}

export async function listRecoveryContacts(tenantId: string): Promise<OpenPrivyRecoveryContact[]> {
  const identity = await ensureOpenPrivyIdentity(tenantId);
  return call<OpenPrivyRecoveryContact[]>(identity, '/recovery/contacts');
}

export async function getRecoveryStatus(tenantId: string): Promise<OpenPrivyRecoveryStatus> {
  const identity = await ensureOpenPrivyIdentity(tenantId);
  return call<OpenPrivyRecoveryStatus>(identity, '/recovery/status');
}

export interface OpenPrivyWalletSummary {
  stats: {
    total_wallets: number;
    chains: string[];
    transactions_total: number;
    confirmed_rate: number;
    recovery_guardians: number;
    recovery_required_approvals: number;
  };
  wallets: OpenPrivyWallet[];
  recent_transactions: OpenPrivyTransaction[];
  recovery_contacts: OpenPrivyRecoveryContact[];
}

interface LiveResult<T> {
  live: boolean;
  data: T | null;
  error?: string;
}

/**
 * Composite summary for the console's wallet page — the equivalent of
 * forge-wallet's old GET /api/v1/console/summary, but built from open-privy's
 * real per-resource endpoints since open-privy has no aggregate endpoint of
 * its own. Balances are intentionally left out here: they require a live
 * chain RPC call per wallet, which this deployment's network egress doesn't
 * allow — fetch a wallet's balance on demand instead of blocking the whole
 * summary on it.
 */
export async function getWalletSummary(tenantId: string): Promise<LiveResult<OpenPrivyWalletSummary>> {
  try {
    const [wallets, transactions, recovery, contacts] = await Promise.all([
      listWallets(tenantId),
      listTransactions(tenantId, 20),
      getRecoveryStatus(tenantId),
      listRecoveryContacts(tenantId),
    ]);
    const confirmed = transactions.filter((t) => t.status === 'confirmed').length;
    return {
      live: true,
      data: {
        stats: {
          total_wallets: wallets.length,
          chains: [...new Set(wallets.map((w) => w.chain))],
          transactions_total: transactions.length,
          confirmed_rate: transactions.length > 0 ? Math.round((confirmed / transactions.length) * 100) : 0,
          recovery_guardians: recovery.totalGuardians,
          recovery_required_approvals: recovery.requiredApprovals,
        },
        wallets,
        recent_transactions: transactions,
        recovery_contacts: contacts,
      },
    };
  } catch (err) {
    return { live: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}
