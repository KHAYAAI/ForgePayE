/**
 * In-memory store for FORGE Custody — source of truth for a running
 * instance, mirrored to Postgres best-effort via persistAsync().
 */

import { createHash, randomUUID } from 'node:crypto';
import { persistAsync } from './db';
import type {
  ApiKeyRecord,
  AuditEntry,
  Ceremony,
  CustodyKey,
  Policy,
  PolicyRules,
  SigningApproval,
  SigningRequest,
  SigningShare,
  Workspace,
} from './types';

export const workspaces = new Map<string, Workspace>();
export const apiKeys = new Map<string, ApiKeyRecord>(); // by keyHash
export const policies = new Map<string, Policy>();
export const keys = new Map<string, CustodyKey>();
export const ceremonies = new Map<string, Ceremony>();
export const signingRequests = new Map<string, SigningRequest>();
export const signingApprovals = new Map<string, SigningApproval[]>(); // by signingRequestId
export const signingShares = new Map<string, SigningShare[]>(); // by signingRequestId
export const auditLog: AuditEntry[] = [];

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

// ── Workspaces & API keys ─────────────────────────────────────────────────────

export function createWorkspace(name: string, institutionType: Workspace['institutionType']): Workspace {
  const ws: Workspace = {
    id: newId('ws'),
    name,
    institutionType,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  workspaces.set(ws.id, ws);
  persistAsync(
    `INSERT INTO forge_custody.workspaces (id, name, institution_type, status) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO NOTHING`,
    [ws.id, ws.name, ws.institutionType, ws.status],
  );
  return ws;
}

/** Returns the RAW key exactly once; only its sha256 is retained. */
export function issueApiKey(workspaceId: string, name: string): { record: ApiKeyRecord; rawKey: string } {
  const rawKey = `fck_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
  const record: ApiKeyRecord = {
    id: newId('ak'),
    workspaceId,
    keyHash: sha256(rawKey),
    name,
    createdAt: new Date().toISOString(),
    revokedAt: null,
    lastUsedAt: null,
  };
  apiKeys.set(record.keyHash, record);
  persistAsync(
    `INSERT INTO forge_custody.api_keys (id, workspace_id, key_hash, name) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO NOTHING`,
    [record.id, record.workspaceId, record.keyHash, record.name],
  );
  return { record, rawKey };
}

// ── Policies ──────────────────────────────────────────────────────────────────

export function createPolicy(workspaceId: string, name: string, rules: PolicyRules): Policy {
  const now = new Date().toISOString();
  const policy: Policy = { id: newId('pol'), workspaceId, name, enabled: true, rules, createdAt: now, updatedAt: now };
  policies.set(policy.id, policy);
  persistAsync(
    `INSERT INTO forge_custody.policies (id, workspace_id, name, enabled, rules) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO NOTHING`,
    [policy.id, policy.workspaceId, policy.name, policy.enabled, JSON.stringify(policy.rules)],
  );
  return policy;
}

export function policiesForWorkspace(workspaceId: string): Policy[] {
  return [...policies.values()].filter((p) => p.workspaceId === workspaceId && p.enabled);
}

// ── Keys & ceremonies ─────────────────────────────────────────────────────────

export function createKey(
  input: Omit<CustodyKey, 'id' | 'createdAt' | 'rotationStatus'> & { rotationStatus?: CustodyKey['rotationStatus'] },
): CustodyKey {
  const key: CustodyKey = {
    ...input,
    id: newId('key'),
    rotationStatus: input.rotationStatus ?? 'active',
    createdAt: new Date().toISOString(),
  };
  keys.set(key.id, key);
  persistAsync(
    `INSERT INTO forge_custody.keys
       (id, workspace_id, blockchain, public_key, address, total_shares, threshold, share_holders, vault_path, rotation_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
    [key.id, key.workspaceId, key.blockchain, key.publicKey, key.address, key.totalShares, key.threshold,
     JSON.stringify(key.shareHolders), key.vaultPath, key.rotationStatus],
  );
  return key;
}

export function recordCeremony(input: Omit<Ceremony, 'id' | 'createdAt'>): Ceremony {
  const ceremony: Ceremony = { ...input, id: newId('cer'), createdAt: new Date().toISOString() };
  ceremonies.set(ceremony.id, ceremony);
  persistAsync(
    `INSERT INTO forge_custody.ceremonies (id, workspace_id, ceremony_type, participants, vss_commitments, commitments_verified, key_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
    [ceremony.id, ceremony.workspaceId, ceremony.ceremonyType, JSON.stringify(ceremony.participants),
     JSON.stringify(ceremony.vssCommitments), ceremony.commitmentsVerified, ceremony.keyId],
  );
  return ceremony;
}

// ── Signing requests ──────────────────────────────────────────────────────────

export function saveSigningRequest(req: SigningRequest): void {
  req.updatedAt = new Date().toISOString();
  signingRequests.set(req.id, req);
  persistAsync(
    `INSERT INTO forge_custody.signing_requests
       (id, workspace_id, customer_id, key_id, blockchain, transaction, metadata, amount_usd, status, reason_code,
        approvals_required, approver_roles, signature, tx_hash, block_number, confirmation_time, error, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, reason_code = EXCLUDED.reason_code, signature = EXCLUDED.signature,
       tx_hash = EXCLUDED.tx_hash, block_number = EXCLUDED.block_number,
       confirmation_time = EXCLUDED.confirmation_time, error = EXCLUDED.error, updated_at = NOW()`,
    [req.id, req.workspaceId, req.customerId, req.keyId, req.blockchain, JSON.stringify(req.transaction),
     JSON.stringify(req.metadata), req.amountUsd, req.status, req.reasonCode,
     req.approvalsRequired, JSON.stringify(req.approverRoles), req.signature, req.txHash, req.blockNumber,
     req.confirmationTime, req.error],
  );
}

export function addApproval(approval: SigningApproval): void {
  const list = signingApprovals.get(approval.signingRequestId) ?? [];
  list.push(approval);
  signingApprovals.set(approval.signingRequestId, list);
  persistAsync(
    `INSERT INTO forge_custody.signing_approvals (id, signing_request_id, approver_id, approver_role)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [approval.id, approval.signingRequestId, approval.approverId, approval.approverRole],
  );
}

export function addShare(share: SigningShare): void {
  const list = signingShares.get(share.signingRequestId) ?? [];
  list.push(share);
  signingShares.set(share.signingRequestId, list);
  persistAsync(
    `INSERT INTO forge_custody.signing_shares (id, signing_request_id, share_index, holder, contribution_hash)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [share.id, share.signingRequestId, share.shareIndex, share.holder, share.contributionHash],
  );
}

/** Aggregate confirmed/broadcast USD for a workspace in the current UTC day. */
export function usdSignedToday(workspaceId: string): number {
  const today = new Date().toISOString().slice(0, 10);
  let total = 0;
  for (const r of signingRequests.values()) {
    if (r.workspaceId !== workspaceId) continue;
    if (!r.createdAt.startsWith(today)) continue;
    if (['rejected', 'failed'].includes(r.status)) continue;
    total += r.amountUsd;
  }
  return total;
}

// ── Audit log (append-only) ───────────────────────────────────────────────────

export function audit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): AuditEntry {
  const record: AuditEntry = { ...entry, id: newId('aud'), createdAt: new Date().toISOString() };
  auditLog.push(record);
  persistAsync(
    `INSERT INTO forge_custody.audit_log
       (id, workspace_id, api_key_id, actor, method, path, action, resource_id, status_code, detail, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [record.id, record.workspaceId, record.apiKeyId, record.actor, record.method, record.path,
     record.action, record.resourceId, record.statusCode, record.detail ? JSON.stringify(record.detail) : null,
     record.ip],
  );
  return record;
}

/** Test/dev helper — clears all in-memory state. */
export function resetStore(): void {
  workspaces.clear();
  apiKeys.clear();
  policies.clear();
  keys.clear();
  ceremonies.clear();
  signingRequests.clear();
  signingApprovals.clear();
  signingShares.clear();
  auditLog.length = 0;
}
