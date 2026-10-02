import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Request } from 'express';

/**
 * Custody governance acts "on behalf of a named person", but the person is only a header. Anyone holding the
 * shared admin key could therefore cast every signer's vote. The operator console now signs each custody
 * request with a secret it shares with this service (CUSTODY_ACTOR_SECRET), over the actor, the method, the
 * path and a hash of the body, with a timestamp and a one-time nonce. A leaked admin key alone can no longer
 * forge a vote, and a captured request cannot be replayed or altered.
 *
 * What this is not: per-person cryptography. The console decides who the person is (after it has
 * authenticated them); whoever holds BOTH the admin key and CUSTODY_ACTOR_SECRET, or controls the console,
 * can still vote as anyone. Making each signer prove themselves directly (WebAuthn / per-signer keys) is the
 * stronger design and is not built.
 */
const MAX_SKEW_MS = 60_000;
const seen = new Map<string, number>();

export function actorSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const s = env.CUSTODY_ACTOR_SECRET;
  return s && s.length > 0 ? s : undefined;
}

/** An absent body and an empty object hash the same, so a request with no body signs consistently on both sides. */
export function bodyHash(body: unknown): string {
  const empty = body === undefined || body === null || body === '' || (typeof body === 'object' && Object.keys(body as object).length === 0);
  return createHash('sha256').update(empty ? '' : typeof body === 'string' ? body : JSON.stringify(body)).digest('hex');
}

function mac(secret: string, parts: { ts: string; nonce: string; actor: string; method: string; path: string; body: string }): string {
  return createHmac('sha256', secret).update(['v1', parts.ts, parts.nonce, parts.actor, parts.method.toUpperCase(), parts.path, parts.body].join('\n')).digest('hex');
}

export function signActorAssertion(secret: string, actor: string, method: string, path: string, body: unknown, now = Date.now()): string {
  const ts = String(now);
  const nonce = randomBytes(12).toString('hex');
  return `v1.${ts}.${nonce}.${mac(secret, { ts, nonce, actor: actor.toLowerCase(), method, path, body: bodyHash(body) })}`;
}

export function verifyActorAssertion(
  secret: string, header: string | undefined, actor: string, method: string, path: string, body: unknown, now = Date.now(),
): string | null {
  if (!header) return 'missing actor assertion';
  const [v, ts, nonce, sig] = header.split('.');
  if (v !== 'v1' || !ts || !nonce || !sig) return 'malformed actor assertion';
  if (!/^\d+$/.test(ts) || Math.abs(now - Number(ts)) > MAX_SKEW_MS) return 'actor assertion expired';
  const want = Buffer.from(mac(secret, { ts, nonce, actor: actor.toLowerCase(), method, path, body: bodyHash(body) }));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return 'actor assertion does not match this request';
  for (const [k, t] of seen) if (now - t > 2 * MAX_SKEW_MS) seen.delete(k);
  if (seen.has(nonce)) return 'actor assertion already used';
  seen.set(nonce, now);
  return null;
}

@Injectable()
export class ActorAssertionGuard implements CanActivate {
  private readonly logger = new Logger(ActorAssertionGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const secret = actorSecret();
    const production = process.env.NODE_ENV === 'production';
    if (!secret) {
      if (production) throw new UnauthorizedException('CUSTODY_ACTOR_SECRET is not configured: custody actions are refused');
      this.logger.warn('CUSTODY_ACTOR_SECRET is not set: actor identity is unauthenticated (development only)');
      return true;
    }
    const actor = String(req.headers['x-actor-email'] ?? '');
    const isRead = req.method === 'GET' && !actor;
    if (isRead) return true;
    const path = (req.originalUrl ?? req.url).split('?')[0];
    const err = verifyActorAssertion(secret, req.headers['x-actor-assertion'] as string | undefined, actor, req.method, path, req.body);
    if (err) throw new UnauthorizedException(err);
    return true;
  }
}
