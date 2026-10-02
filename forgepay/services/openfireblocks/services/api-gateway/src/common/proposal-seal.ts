import { createHmac, timingSafeEqual } from 'crypto';

/**
 * A governance vote approves a specific payload. Without more, whoever can write to the database can
 * change a proposal's payload (the destination or amount of an approved transfer, the node list of a
 * rotation) after the votes are in, and the service executes the altered version. Each proposal's payload
 * is therefore sealed with an HMAC (CUSTODY_PROPOSAL_SECRET, held by the service, not the database) over
 * the customer, the kind, the request id and the canonical payload, and verified at execution.
 */
export function proposalSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.CUSTODY_PROPOSAL_SECRET || env.CUSTODY_ACTOR_SECRET || undefined;
}

/** JSON with sorted keys, so the seal survives JSONB reordering. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
}

function mac(secret: string, customerId: string, kind: string, requestId: string | null | undefined, payload: Record<string, unknown>): string {
  const { _seal, ...rest } = payload;
  void _seal;
  return createHmac('sha256', secret).update(['p1', customerId, kind, requestId ?? '', canonicalJson(rest)].join('\n')).digest('hex');
}

export function sealPayload(customerId: string, kind: string, requestId: string | null | undefined, payload: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const secret = proposalSecret(env);
  if (!secret) return payload;
  return { ...payload, _seal: mac(secret, customerId, kind, requestId, payload) };
}

/** Returns null if the payload is as it was voted on, else why it is refused. */
export function checkPayloadSeal(customerId: string, kind: string, requestId: string | null | undefined, payload: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = proposalSecret(env);
  const production = env.NODE_ENV === 'production';
  if (!secret) return production ? 'CUSTODY_PROPOSAL_SECRET is not configured; refusing to execute an unverifiable proposal' : null;
  const seal = payload?._seal;
  if (typeof seal !== 'string') return 'the proposal carries no integrity seal';
  const want = Buffer.from(mac(secret, customerId, kind, requestId, payload));
  const got = Buffer.from(seal);
  return want.length === got.length && timingSafeEqual(want, got) ? null : 'the proposal was altered after it was created; refusing to execute it';
}

export function stripSeal<T extends Record<string, any>>(payload: T): T {
  const { _seal, ...rest } = payload;
  void _seal;
  return rest as T;
}
