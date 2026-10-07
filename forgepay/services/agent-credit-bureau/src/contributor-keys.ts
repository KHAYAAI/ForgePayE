/**
 * Key lifecycle for data contributors (furnishers and lenders, such as microfinance institutions).
 *
 * A contributor used to have exactly one key, set at registration, with no way to replace it. A leaked key could only be
 * answered by suspending the whole institution, and a planned rotation meant downtime. Now an institution can hold several
 * keys at once (up to MAX_ACTIVE_KEYS), issue a new one, move its systems over, and revoke the old one. Keys can expire.
 *
 * The original registration key stays on `apiKeyHash` and is addressed as key id "primary"; later keys live in `apiKeys`.
 * Only sha256 digests are stored. Pure functions over a contributor record, so they are tested without a server.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { hashApiKey, safeEqualHex } from './hash';
import type { ContributorApiKey, DataContributor } from './types';

export const MAX_ACTIVE_KEYS = 5;
export const PRIMARY_KEY_ID = 'primary';
/** lastUsedAt is only updated (and written back) when it is this stale, so reads are not turned into database writes. */
export const LAST_USED_PERSIST_MS = 10 * 60 * 1000;

export interface KeyView {
  id: string;
  label?: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  status: 'active' | 'revoked' | 'expired';
}

function isLive(k: { revokedAt?: string; expiresAt?: string }, nowMs: number): boolean {
  if (k.revokedAt) return false;
  if (k.expiresAt && Date.parse(k.expiresAt) <= nowMs) return false;
  return true;
}

function viewOf(k: ContributorApiKey, nowMs: number): KeyView {
  return {
    id: k.id, label: k.label, createdAt: k.createdAt, expiresAt: k.expiresAt, revokedAt: k.revokedAt, lastUsedAt: k.lastUsedAt,
    status: k.revokedAt ? 'revoked' : isLive(k, nowMs) ? 'active' : 'expired',
  };
}

/** Every key the contributor has, the primary one first, with no hashes. */
export function listKeys(c: DataContributor, nowMs = Date.now()): KeyView[] {
  const primary: KeyView = {
    id: PRIMARY_KEY_ID, label: 'registration key', createdAt: c.createdAt, revokedAt: c.primaryKeyRevokedAt,
    status: c.primaryKeyRevokedAt ? 'revoked' : 'active',
  };
  return [primary, ...(c.apiKeys ?? []).map((k) => viewOf(k, nowMs))];
}

export function activeKeyCount(c: DataContributor, nowMs = Date.now()): number {
  return listKeys(c, nowMs).filter((k) => k.status === 'active').length;
}

/**
 * Does the presented digest match a live key of this contributor? Returns that key's id, or null.
 * Compares against every candidate in constant time per comparison; a revoked or expired key matches nothing.
 */
export function matchKey(c: DataContributor, presentedHash: string, nowMs = Date.now()): string | null {
  if (c.apiKeyHash && !c.primaryKeyRevokedAt && safeEqualHex(presentedHash, c.apiKeyHash)) return PRIMARY_KEY_ID;
  for (const k of c.apiKeys ?? []) {
    if (isLive(k, nowMs) && safeEqualHex(presentedHash, k.hash)) return k.id;
  }
  return null;
}

/** Record use of a key. Returns true when the change is old enough that the caller should persist it. */
export function touchKey(c: DataContributor, keyId: string, nowMs = Date.now()): boolean {
  if (keyId === PRIMARY_KEY_ID) return false; // the primary key carries no per-key record to update
  const k = (c.apiKeys ?? []).find((x) => x.id === keyId);
  if (!k) return false;
  const previous = k.lastUsedAt ? Date.parse(k.lastUsedAt) : 0;
  // Precision is LAST_USED_PERSIST_MS: the value only moves when it is that stale, which is also when it is worth writing.
  if (nowMs - previous <= LAST_USED_PERSIST_MS) return false;
  k.lastUsedAt = new Date(nowMs).toISOString();
  return true;
}

export type IssueResult =
  | { ok: true; key: KeyView; rawKey: string }
  | { ok: false; error: 'TooManyKeys'; message: string };

export function issueKey(c: DataContributor, opts: { label?: string; expiresInDays?: number }, nowMs = Date.now()): IssueResult {
  if (activeKeyCount(c, nowMs) >= MAX_ACTIVE_KEYS) {
    return {
      ok: false, error: 'TooManyKeys',
      message: `An institution may hold at most ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`,
    };
  }
  const rawKey = `ck_${randomBytes(24).toString('base64url')}`;
  const record: ContributorApiKey = {
    id: `key_${randomUUID().slice(0, 12)}`,
    hash: hashApiKey(rawKey),
    label: opts.label,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: opts.expiresInDays ? new Date(nowMs + opts.expiresInDays * 86_400_000).toISOString() : undefined,
  };
  c.apiKeys = [...(c.apiKeys ?? []), record];
  return { ok: true, key: viewOf(record, nowMs), rawKey };
}

export type RevokeResult =
  | { ok: true; key: KeyView }
  | { ok: false; error: 'NotFound' | 'AlreadyRevoked' | 'LastKey'; message: string };

/**
 * Revoke a key. An institution cannot revoke its only remaining active key (that would lock it out with no way back
 * except an operator); an operator can, which is the answer to a leaked key.
 */
export function revokeKey(c: DataContributor, keyId: string, byOperator: boolean, nowMs = Date.now()): RevokeResult {
  const existing = listKeys(c, nowMs).find((k) => k.id === keyId);
  if (!existing) return { ok: false, error: 'NotFound', message: `No key ${keyId} on this contributor.` };
  if (existing.status === 'revoked') return { ok: false, error: 'AlreadyRevoked', message: 'That key is already revoked.' };
  if (existing.status === 'active' && !byOperator && activeKeyCount(c, nowMs) <= 1) {
    return {
      ok: false, error: 'LastKey',
      message: 'This is the only active key. Issue a new key first, then revoke this one. An operator can revoke the last key.',
    };
  }
  const at = new Date(nowMs).toISOString();
  if (keyId === PRIMARY_KEY_ID) {
    c.primaryKeyRevokedAt = at;
  } else {
    const k = (c.apiKeys ?? []).find((x) => x.id === keyId);
    if (k) k.revokedAt = at;
  }
  return { ok: true, key: listKeys(c, nowMs).find((k) => k.id === keyId) as KeyView };
}
