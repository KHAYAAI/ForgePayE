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

  const workspace = workspaces.get(record.workspaceId);
  if (!workspace || workspace.status !== 'active') return fail('workspace_inactive');

  record.lastUsedAt = new Date().toISOString();
  return { workspace, apiKey: record };
}
