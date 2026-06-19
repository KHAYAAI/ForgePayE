/**
 * KYAPay integration routes.
 *
 *   GET  /.well-known/jwks.json          — Serve ES256 public key for token verification
 *   POST /v1/agents/import-kya           — Import external agent from KYA/KYA-PAY token
 *   POST /v1/agents/:id/kyapay-token     — Issue ForgePay-enhanced KYAPay token
 *
 * Auth: The JWKS endpoint is public (no API key). The other two routes
 * are protected by the existing apiKeyAuth plugin via normal ForgePay API keys.
 */

import type { FastifyInstance } from 'fastify';
import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { v4 as uuidv4 } from 'uuid';
import { getKeySet, buildJwks } from '../lib/kyapay-keys.js';
import { getAgent, setAgent, getAgentByKyapaySub } from '../store.js';
import type { AgentIdentity } from '../types.js';

const FORGEPAY_ISSUER  = process.env['FORGEPAY_ISSUER_URL'] ?? 'https://api.forgepay.com';
const TOKEN_TTL        = 300; // 5 minutes — short-lived per KYAPay spec

const TRUSTED_ISSUERS: string[] = (
  process.env['KYAPAY_TRUSTED_ISSUERS'] ?? 'https://skyfire.xyz'
).split(',').map(s => s.trim()).filter(Boolean);

// Per-issuer JWKS fetcher cache
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwksFetcher(issuer: string) {
  if (!jwksCache.has(issuer)) {
    const uri = `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`;
    jwksCache.set(issuer, createRemoteJWKSet(new URL(uri)));
  }
  return jwksCache.get(issuer)!;
}

export async function buildKYAPayRoutes(app: FastifyInstance) {
  // ── GET /.well-known/jwks.json — public, no auth ──────────────────────────
  app.get('/.well-known/jwks.json', {
    config: { skipAuth: true },
  }, async (_req, reply) => {
    const jwks = await buildJwks();
    return reply
      .header('Cache-Control', 'public, max-age=3600')
      .send(jwks);
  });

  // ── POST /v1/agents/import-kya ────────────────────────────────────────────
  //
  // Accepts a KYA or KYA-PAY JWT from an external issuer (e.g. Skyfire).
  // Verifies the JWT, then upserts the agent in our registry using
  // (kyapay_sub, kyapay_iss) as the external identity key.
  //
  // Body: { kyapayToken: string, ownerMerchantId: string }
  app.post('/v1/agents/import-kya', async (req, reply) => {
    const body = req.body as Record<string, unknown>;

    if (!body['kyapayToken'] || typeof body['kyapayToken'] !== 'string') {
      return reply.status(400).send({ error: 'ValidationError', message: 'kyapayToken is required' });
    }
    if (!body['ownerMerchantId'] || typeof body['ownerMerchantId'] !== 'string') {
      return reply.status(400).send({ error: 'ValidationError', message: 'ownerMerchantId is required' });
    }

    const jwt   = body['kyapayToken'] as string;
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      return reply.status(400).send({ error: 'ValidationError', message: 'Invalid JWT format' });
    }

    // Pre-decode to extract iss before full verification
    let rawPayload: Record<string, unknown>;
    try {
      rawPayload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      return reply.status(400).send({ error: 'ValidationError', message: 'Could not decode JWT payload' });
    }

    const issuer = rawPayload['iss'] as string | undefined;
    const sub    = rawPayload['sub'] as string | undefined;
    if (!issuer || !sub) {
      return reply.status(400).send({ error: 'ValidationError', message: 'JWT must contain iss and sub claims' });
    }
    if (!TRUSTED_ISSUERS.includes(issuer)) {
      return reply.status(401).send({ error: 'UntrustedIssuer', message: `Issuer not trusted: ${issuer}` });
    }

    // Full signature + expiry verification
    let verifiedPayload: Record<string, unknown>;
    try {
      const { payload } = await jwtVerify(jwt, getJwksFetcher(issuer), { algorithms: ['ES256'] });
      verifiedPayload = payload as Record<string, unknown>;
    } catch (err) {
      app.log.warn({ err: (err as Error).message, issuer, sub }, '[kyapay] import-kya token verification failed');
      return reply.status(401).send({ error: 'InvalidToken', message: (err as Error).message });
    }

    const bid         = verifiedPayload['bid'] as Record<string, unknown> | undefined;
    const businessName = bid?.['businessName'] as string | undefined;
    const kycVerified  = Boolean(bid?.['kycVerified']);

    const now = new Date().toISOString();

    // Upsert by KYAPay identity
    const existing = await getAgentByKyapaySub(sub, issuer);
    if (existing) {
      const updated: AgentIdentity = {
        ...existing,
        name:         businessName ?? existing.name,
        lastActiveAt: now,
      };
      await setAgent(updated, { kyapaySub: sub, kyapayIss: issuer });
      app.log.info({ agentId: existing.id, sub }, '[kyapay] Agent re-imported from KYA token');
      return reply.status(200).send({ data: updated, imported: false });
    }

    const id = uuidv4();
    const agent: AgentIdentity = {
      id,
      did:                   `did:forgepay:${id}`,
      name:                  businessName ?? `KYAPay Agent ${sub.slice(0, 8)}`,
      framework:             'custom',
      ownerMerchantId:       body['ownerMerchantId'] as string,
      capabilities:          ['payment'],
      trustLevel:            kycVerified ? 'verified' : 'unverified',
      reputationScore:       500,
      totalTransactions:     0,
      totalVolumeUsd:        0,
      successRate:           1.0,
      averageResponseTimeMs: 0,
      tags:                  ['kyapay', 'external'],
      createdAt:             now,
      lastActiveAt:          now,
      status:                'active',
    };

    await setAgent(agent, { kyapaySub: sub, kyapayIss: issuer });
    app.log.info({ agentId: id, sub, issuer }, '[kyapay] New agent imported from KYA token');
    return reply.status(201).send({ data: agent, imported: true });
  });

  // ── POST /v1/agents/:id/kyapay-token — Issue ForgePay KYAPay token ─────────
  //
  // Issues a short-lived ES256 JWT in KYAPay format, enriched with ForgePay's
  // reputation, OFAC status, and credit claims. External merchants and agents
  // can use this token when calling KYAPay-compatible services.
  //
  // Body (all optional):
  //   value             — spend limit, e.g. "100.00"
  //   currency          — ISO 4217, default "USD"
  //   settlementAsset   — e.g. "USDC", default "USDC"
  //   settlementChain   — e.g. "polygon", default "polygon"
  //   recipientMerchantId — target merchant / service
  //   audience          — JWT aud claim, default FORGEPAY_ISSUER
  app.post<{ Params: { id: string } }>('/v1/agents/:id/kyapay-token', async (req, reply) => {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      return reply.status(404).send({ error: 'NotFound', message: `Agent ${req.params.id} not found` });
    }
    if (agent.status !== 'active') {
      return reply.status(409).send({ error: 'Conflict', message: 'Cannot issue token for inactive agent' });
    }

    const body              = req.body as Record<string, unknown>;
    const { privateKey, keyId } = await getKeySet();
    const nowSec            = Math.floor(Date.now() / 1000);

    const token = await new SignJWT({
      // KYAPay standard payment claims
      ...(body['value'] ? { value: body['value'] as string } : {}),
      cur: (body['currency'] as string | undefined) ?? 'USD',
      sps: (body['settlementAsset'] as string | undefined) ?? 'USDC',
      spr: (body['settlementChain'] as string | undefined) ?? 'polygon',
      ...(body['recipientMerchantId'] ? { rec: body['recipientMerchantId'] as string } : {}),
      bid: {
        kycVerified:  agent.trustLevel !== 'unverified',
        businessName: agent.name,
      },
      // ForgePay-extended claims (our competitive differentiator)
      fp_reputation:       agent.reputationScore,
      fp_trust_level:      agent.trustLevel,
      fp_lifetime_volume:  agent.totalVolumeUsd.toFixed(2),
      fp_success_rate:     agent.successRate,
      fp_ofac_cleared:     true,
      fp_defaults:         0,
      fp_credit_available: '0.00',
    })
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setSubject(agent.did)
      .setIssuer(FORGEPAY_ISSUER)
      .setAudience((body['audience'] as string | undefined) ?? FORGEPAY_ISSUER)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + TOKEN_TTL)
      .setJti(uuidv4())
      .sign(privateKey);

    app.log.info({ agentId: agent.id, did: agent.did }, '[kyapay] Token issued');
    return reply.send({ token, agentId: agent.id, did: agent.did, expiresIn: TOKEN_TTL });
  });
}
