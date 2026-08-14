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

// ── Demo seed data ────────────────────────────────────────────────────────────

/**
 * Populates the store with realistic workspaces, keys, DKG ceremonies, and
 * signing requests so the console's /api/v1/console/summary shows real
 * depth instead of an all-zeros empty state — every stat there reads live
 * off these same Maps.
 *
 * Called once from main() — never from buildApp() or any test path — so it
 * never runs under `vitest` (tests call resetStore() and build their own
 * fixtures via createWorkspace/createKey/etc.) and the caller is
 * responsible for skipping it in production (see index.ts).
 */
export function seedDemoData(): void {
  const bank = createWorkspace('Meridian Trust Bank', 'bank');
  const fintech = createWorkspace('Northwind Robotics Treasury', 'fintech');

  issueApiKey(bank.id, 'Treasury Ops — production');
  issueApiKey(fintech.id, 'Settlement Bot — production');

  createPolicy(bank.id, 'Standard treasury policy', {
    dailyLimitUsd: 5_000_000,
    allowedChains: ['ethereum', 'polygon'],
    approvalThreshold: { amountUsd: 250_000, approvalsRequired: 2, roles: ['CFO', 'Treasury Ops'] },
  });
  createPolicy(fintech.id, 'Agent settlement policy', {
    dailyLimitUsd: 500_000,
    allowedChains: ['ethereum', 'polygon'],
    whitelist: ['0x9f2b1a4e6c8d3f5a7b9e1c2d4f6a8b0c2d4e6f80'],
  });

  const bankKey = createKey({
    workspaceId: bank.id, blockchain: 'ethereum',
    publicKey: `pk_${sha256(bank.id + 'ethereum').slice(0, 48)}`,
    address: `0x${sha256(bank.id + 'addr-eth').slice(0, 40)}`,
    totalShares: 7, threshold: 4,
    shareHolders: ['ops-1', 'ops-2', 'sre-1', 'sre-2', 'security-1', 'security-2', 'cold-backup'],
    vaultPath: `secret/forge-custody/${bank.id}/key_eth_treasury`,
  });
  const fintechKey = createKey({
    workspaceId: fintech.id, blockchain: 'polygon',
    publicKey: `pk_${sha256(fintech.id + 'polygon').slice(0, 48)}`,
    address: `0x${sha256(fintech.id + 'addr-poly').slice(0, 40)}`,
    totalShares: 7, threshold: 4,
    shareHolders: ['ops-1', 'ops-2', 'sre-1', 'sre-2', 'security-1', 'security-2', 'cold-backup'],
    vaultPath: `secret/forge-custody/${fintech.id}/key_poly_settlement`,
  });

  recordCeremony({
    workspaceId: bank.id, ceremonyType: 'dkg',
    participants: bankKey.shareHolders.map((h) => ({ participantId: h, role: h.startsWith('security') ? 'security' : 'ops' })),
    vssCommitments: bankKey.shareHolders.map((h) => sha256(`vss:${bankKey.id}:${h}`)),
    commitmentsVerified: true,
    keyId: bankKey.id,
  });

  const now = () => new Date().toISOString();
  const mkRequest = (fields: Omit<SigningRequest, 'reasonCode' | 'signature' | 'txHash' | 'blockNumber' | 'confirmationTime' | 'error' | 'updatedAt'>): SigningRequest => ({
    ...fields,
    reasonCode: null, signature: null, txHash: null, blockNumber: null, confirmationTime: null, error: null,
    updatedAt: now(),
  });

  // Confirmed — below approval threshold, straight through.
  const confirmed = mkRequest({
    id: newId('sr'), workspaceId: bank.id, customerId: 'cust_acme_holdings', keyId: bankKey.id,
    blockchain: 'ethereum',
    transaction: { to: `0x${sha256('exchange-withdrawal-1').slice(0, 40)}`, value: '50000000000000000000' },
    metadata: { forge_merchant_id: 'merch_acme_holdings' },
    amountUsd: 82_500, status: 'confirmed', approvalsRequired: 0, approverRoles: [],
    createdAt: now(),
  });
  confirmed.signature = sha256(`sig:${confirmed.id}`);
  confirmed.txHash = `0x${sha256(`tx:${confirmed.id}`).slice(0, 64)}`;
  confirmed.blockNumber = 21_453_902;
  confirmed.confirmationTime = now();
  saveSigningRequest(confirmed);

  // Confirmed on the fintech workspace — this is what usdSignedToday sums.
  const confirmed2 = mkRequest({
    id: newId('sr'), workspaceId: fintech.id, customerId: 'cust_agent_settlement_bot', keyId: fintechKey.id,
    blockchain: 'polygon',
    transaction: { to: '0x9f2b1a4e6c8d3f5a7b9e1c2d4f6a8b0c2d4e6f80', value: '12000000000000000000' },
    metadata: { agent_id: 'agent_settlement_bot', forge_payment_id: 'pay_7f3a9c' },
    amountUsd: 4_200, status: 'confirmed', approvalsRequired: 0, approverRoles: [],
    createdAt: now(),
  });
  confirmed2.signature = sha256(`sig:${confirmed2.id}`);
  confirmed2.txHash = `0x${sha256(`tx:${confirmed2.id}`).slice(0, 64)}`;
  confirmed2.blockNumber = 58_120_447;
  confirmed2.confirmationTime = now();
  saveSigningRequest(confirmed2);

  // Pending approval — above the bank's $250K threshold, one of two required
  // approvals already in.
  const pendingApproval = mkRequest({
    id: newId('sr'), workspaceId: bank.id, customerId: 'cust_globex_corp', keyId: bankKey.id,
    blockchain: 'ethereum',
    transaction: { to: `0x${sha256('exchange-withdrawal-2').slice(0, 40)}`, value: '400000000000000000000' },
    metadata: { forge_merchant_id: 'merch_globex_corp' },
    amountUsd: 640_000, status: 'pending_approval', approvalsRequired: 2, approverRoles: ['CFO', 'Treasury Ops'],
    createdAt: now(),
  });
  saveSigningRequest(pendingApproval);
  addApproval({ id: newId('appr'), signingRequestId: pendingApproval.id, approverId: 'user_cfo_meridian', approverRole: 'CFO', approvedAt: now() });

  // Rejected — outside the policy whitelist.
  const rejected = mkRequest({
    id: newId('sr'), workspaceId: fintech.id, customerId: 'cust_agent_settlement_bot', keyId: fintechKey.id,
    blockchain: 'polygon',
    transaction: { to: `0x${sha256('unwhitelisted-destination').slice(0, 40)}`, value: '3000000000000000000' },
    metadata: { agent_id: 'agent_settlement_bot' },
    amountUsd: 1_050, status: 'rejected', approvalsRequired: 0, approverRoles: [],
    createdAt: now(),
  });
  rejected.reasonCode = 'DESTINATION_NOT_WHITELISTED';
  saveSigningRequest(rejected);

  audit({
    workspaceId: bank.id, apiKeyId: null, actor: 'Treasury Ops — production',
    method: 'POST', path: '/api/v1/sign', action: 'signing.create', resourceId: confirmed.id,
    statusCode: 201, detail: { amountUsd: confirmed.amountUsd, chain: confirmed.blockchain }, ip: null,
  });
  audit({
    workspaceId: bank.id, apiKeyId: null, actor: 'user_cfo_meridian',
    method: 'POST', path: `/api/v1/signing/${pendingApproval.id}/approve`, action: 'signing.approve', resourceId: pendingApproval.id,
    statusCode: 200, detail: { role: 'CFO' }, ip: null,
  });
  audit({
    workspaceId: fintech.id, apiKeyId: null, actor: 'Settlement Bot — production',
    method: 'POST', path: '/api/v1/sign', action: 'signing.reject', resourceId: rejected.id,
    statusCode: 200, detail: { reason: rejected.reasonCode }, ip: null,
  });
}
