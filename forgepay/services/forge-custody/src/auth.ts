/**
 * API-key + HMAC request authentication for FORGE Custody.
 *
 * Clients send:
 *   X-API-Key    — the raw workspace API key (stored server-side as sha256)
 *   X-Timestamp  — unix seconds; must be within ±5 minutes (replay guard)
 *   X-Signature  — HMAC-SHA256(rawApiKey, `${method}\n${path}\n${timestamp}\n${body}`)
 *
 * All comparisons are timing-safe. Every authenticated request appends an
 * audit_log row from the route handlers.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authFailuresTotal } from './lib/metrics';
import { apiKeys, sha256, workspaces } from './store';
import type { ApiKeyRecord, Workspace } from './types';

export const HMAC_WINDOW_SECONDS = 300;

export interface AuthContext {
  workspace: Workspace;
  apiKey: ApiKeyRecord;
}

// ── Replay protection ────────────────────────────────────────────────────────
//
// The timestamp window alone is NOT a replay guard — it only bounds how long a
// captured request stays replayable. Without the seen-signature set below, an
// attacker who observed one signed call to `/api/v1/sign` or
// `/api/v1/signing/:id/approve` could resubmit it unchanged for a full five
// minutes and have every copy accepted.
//
// A signature is a pure function of (apiKey, method, path, timestamp, body), so
// an identical signature arriving twice is by definition a replay. We remember
// each one until its timestamp falls outside the window, after which the
// timestamp check rejects it anyway and the entry can be dropped.
//
// ⚠️ This set is per-process. With more than one replica a replay can still
// succeed against a pod that has not seen the signature. Before scaling custody
// past a single replica this must move to the shared Redis the platform already
// runs (SET <sig> NX EX <window>), which gives the same guarantee cluster-wide.

/** signatureHash → unix-seconds expiry. */
const seenSignatures = new Map<string, number>();

/** Bounds worst-case memory if a client floods unique signatures. */
const MAX_TRACKED_SIGNATURES = 100_000;

function pruneSeenSignatures(now: number): void {
  for (const [sig, expiry] of seenSignatures) {
    if (expiry <= now) seenSignatures.delete(sig);
  }
}

/**
 * Record a signature as used. Returns false if it has been seen before —
 * i.e. the request is a replay and must be rejected.
 */
function claimSignature(signature: string, now: number): boolean {
  if (seenSignatures.size > MAX_TRACKED_SIGNATURES) pruneSeenSignatures(now);
  const key = sha256(signature);
  const existing = seenSignatures.get(key);
  if (existing !== undefined && existing > now) return false;
  seenSignatures.set(key, now + HMAC_WINDOW_SECONDS);
  return true;
}

/** Exposed for tests — clears replay state between cases. */
export function __resetReplayCache(): void {
  seenSignatures.clear();
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function computeSignature(rawKey: string, method: string, path: string, timestamp: string, body: string): string {
  return createHmac('sha256', rawKey).update(`${method}\n${path}\n${timestamp}\n${body}`).digest('hex');
}

/**
 * Fastify preHandler. On success decorates request with `authContext`;
 * on failure replies 401 and returns null.
 */
export async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const fail = (reason: string): null => {
    authFailuresTotal.inc({ reason });
    reply.code(401).send({ error: 'unauthorized', reason });
    return null;
  };

  const rawKey = req.headers['x-api-key'];
  const timestamp = req.headers['x-timestamp'];
  const signature = req.headers['x-signature'];
  if (typeof rawKey !== 'string' || typeof timestamp !== 'string' || typeof signature !== 'string') {
    return fail('missing_credentials');
  }

  const record = apiKeys.get(sha256(rawKey));
  if (!record || record.revokedAt) return fail('unknown_or_revoked_key');

  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > HMAC_WINDOW_SECONDS) {
    return fail('timestamp_out_of_window');
  }

  const body = req.body ? JSON.stringify(req.body) : '';
  const expected = computeSignature(rawKey, req.method, req.url, timestamp, body);
  if (!safeEqualHex(expected, signature)) return fail('bad_signature');

  // Only claim AFTER the signature is proven valid, so an attacker cannot
  // poison the cache with forged signatures to lock out legitimate requests.
  if (!claimSignature(signature, now)) return fail('replayed_signature');

  const workspace = workspaces.get(record.workspaceId);
  if (!workspace || workspace.status !== 'active') return fail('workspace_inactive');

  record.lastUsedAt = new Date().toISOString();
  return { workspace, apiKey: record };
}
