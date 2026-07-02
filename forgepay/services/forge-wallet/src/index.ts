/**
 * FORGE Wallet — consumer & agent wallet-as-a-service and identity layer.
 * (OpenPrivy, integrated into the FORGE ecosystem.)
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: email/password wallets with no seed phrases. Keys are generated
 *       server-side, encrypted with AES-256-GCM under a scrypt-derived key,
 *       and never returned in plaintext by any endpoint. Every user and agent
 *       gets a did:forge identity that the Agent Credit Bureau reads for
 *       reputation.
 *
 * Routing tier contract: transactions at or above LARGE_PAYMENT_THRESHOLD
 * (default $100K) are refused with 409 {route:'forge-custody'} — wallets
 * never sign institutional-size transfers; FORGE Payments re-routes them
 * through FORGE Custody's 4-of-7 threshold signing.
 *
 * Port: 3020
 *
 * Env vars:
 *   PORT                     — default 3020
 *   DATABASE_URL             — Postgres (schema forge_wallet)
 *   JWT_SECRET               — REQUIRED in production (no default accepted)
 *   AGENT_API_KEY            — platform key for POST /api/v1/agents/wallets
 *   LARGE_PAYMENT_THRESHOLD  — USD; default 100000
 *   UNIFIED_ROUTER_URL       — revenue-ontology webhook target
 *   WEBHOOK_SECRET           — HMAC secret for ontology events; REQUIRED in production
 *   CORS_ORIGIN              — default: none
 *   RATE_LIMIT_PER_MIN       — default 120 (stricter burst limit on auth routes)
 *   LOG_LEVEL                — default info
 */

import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { runMigrations } from './db';
import { logger } from './lib/logger';
import { getMetrics, gasSponsoredUsdTotal, recoveryRequestsTotal, webhookEmissionsTotal } from './lib/metrics';
import { CHAIN_ADAPTERS, decryptPrivateKey, transactionHash } from './crypto';
import {
  GAS_SPONSORSHIP_USD_PER_TX,
  addTrustedContact,
  approveRecovery,
  completeRecovery,
  createAgentWallets,
  createTransaction,
  createUser,
  findUserByEmail,
  getActiveWallet,
  getActiveWallets,
  getEncryptedKey,
  getUser,
  initiateRecovery,
  listGasSponsorship,
  listTransactions,
  listTrustedContacts,
  lookupDidByAddress,
  recordGasSponsorship,
  transitionTransaction,
  updateUserPasswordHash,
} from './store';
import type { Blockchain, WalletTransaction } from './types';

const PORT = Number(process.env.PORT ?? 3020);
const BCRYPT_ROUNDS = 12;
const JWT_TTL = '1h';
const CONFIRMATIONS_REQUIRED = 12;

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret.length < 32 || secret === 'dev-secret') {
      throw new Error('[wallet] JWT_SECRET must be set to a strong value in production');
    }
    return secret;
  }
  return secret ?? 'forge-wallet-dev-secret-not-for-production';
}

function requireProductionSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return;
  jwtSecret();
  const missing = ['WEBHOOK_SECRET', 'DATABASE_URL', 'AGENT_API_KEY'].filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(`[wallet] refusing to start in production without: ${missing.join(', ')}`);
  }
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

interface JwtClaims {
  sub: string;
  did: string;
}

function issueToken(userId: string, did: string): string {
  return jwt.sign({ sub: userId, did } satisfies JwtClaims, jwtSecret(), {
    algorithm: 'HS256',
    expiresIn: JWT_TTL,
  });
}

function requireUser(req: FastifyRequest, reply: FastifyReply): JwtClaims | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  try {
    // Algorithm pinned — 'none' and RS/ES downgrade attacks are rejected.
    return jwt.verify(header.slice(7), jwtSecret(), { algorithms: ['HS256'] }) as JwtClaims;
  } catch {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
}

function requireAgentPlatformKey(req: FastifyRequest, reply: FastifyReply): boolean {
  const configured = process.env.AGENT_API_KEY;
  const presented = req.headers['x-api-key'];
  if (!configured || typeof presented !== 'string') {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(configured, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

// ── Revenue Ontology emission ────────────────────────────────────────────────

async function emitOntologyEvent(tx: WalletTransaction): Promise<void> {
  const routerUrl = process.env.UNIFIED_ROUTER_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!routerUrl || !secret) {
    logger.warn({ txId: tx.id }, '[wallet] UNIFIED_ROUTER_URL/WEBHOOK_SECRET not set — ontology event not emitted');
    return;
  }
  const payload = JSON.stringify({
    event_type: 'wallet.transaction.confirmed',
    actor_id: tx.did,
    amount: tx.amount,
    currency: tx.currency,
    blockchain: tx.blockchain,
    from_address: tx.fromAddress,
    to_address: tx.toAddress,
    tx_hash: tx.txHash,
    payment_terms: tx.paymentTerms,
    metadata: { wallet_transaction_id: tx.id },
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  try {
    const res = await fetch(`${routerUrl.replace(/\/$/, '')}/webhooks/forge-wallet`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forge-timestamp': timestamp,
        'x-forge-signature': signature,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    webhookEmissionsTotal.inc({ result: res.ok ? "delivered" : "failed" });
  } catch (err) {
    webhookEmissionsTotal.inc({ result: "failed" });
    logger.error({ err, txId: tx.id }, '[wallet] ontology webhook delivery failed');
  }
}

// ── App ───────────────────────────────────────────────────────────────────────

export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });

  await app.register(helmet);
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin) {
    await app.register(cors, { origin: corsOrigin.split(',') });
  }
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_PER_MIN ?? 120),
    timeWindow: '1 minute',
  });

  app.get('/api/health', async () => ({ status: 'ok', service: 'forge-wallet' }));
  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', 'text/plain');
    return getMetrics();
  });

  // ── Auth ────────────────────────────────────────────────────────────────────
  const signupSchema = z.object({
    email: z.string().email().max(320),
    password: z.string().min(10).max(256),
    name: z.string().min(1).max(120).optional(),
  });

  // Stricter burst limit on credential endpoints (brute-force guard).
  const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post('/api/v1/auth/signup', { config: authRateLimit }, async (req, reply) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.flatten() });
    if (findUserByEmail(parsed.data.email)) return reply.code(409).send({ error: 'email_taken' });

    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
    const { user, wallets } = createUser(parsed.data.email, passwordHash, parsed.data.password, parsed.data.name ?? null);
    return reply.code(201).send({
      token: issueToken(user.id, user.did),
      user: { id: user.id, did: user.did, email: user.email, name: user.name },
      wallets: wallets.map((w) => ({ blockchain: w.blockchain, address: w.address, did: w.did })),
    });
  });

  const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(256) });

  app.post('/api/v1/auth/login', { config: authRateLimit }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const user = findUserByEmail(parsed.data.email);
    // Constant-shape failure: hash compare runs even for unknown emails.
    const hash = user?.passwordHash ?? '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7Kxm5eVn6PqB1S8mYQ2eGgGvCSKAV6y';
    const ok = await bcrypt.compare(parsed.data.password, hash);
    if (!user || !ok) return reply.code(401).send({ error: 'invalid_credentials' });
    return {
      token: issueToken(user.id, user.did),
      user: { id: user.id, did: user.did, email: user.email, name: user.name },
    };
  });

  // ── Wallets ────────────────────────────────────────────────────────────────
  app.get('/api/v1/wallets', async (req, reply) => {
    const claims = requireUser(req, reply);
    if (!claims) return;
    return getActiveWallets(claims.sub).map((w) => ({
      id: w.id, blockchain: w.blockchain, address: w.address, did: w.did, status: w.status,
    }));
  });

  // ── Transactions ───────────────────────────────────────────────────────────
  const txSchema = z.object({
    to_address: z.string().min(4).max(128),
    amount: z.number().positive(),
    currency: z.string().min(2).max(12).default('USDC'),
    blockchain: z.enum(['ethereum', 'polygon', 'solana']),
    payment_terms: z.string().max(40).optional(),
    /** The user's password unlocks the encrypted key for this single signing. Never logged, never stored. */
    password: z.string().min(1).max(256),
  });

  app.post('/api/v1/transactions/create', async (req, reply) => {
    const claims = requireUser(req, reply);
    if (!claims) return;
    const parsed = txSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.flatten() });
    const input = parsed.data;

    // Routing tier contract — institutional-size transfers go to FORGE Custody.
    const threshold = Number(process.env.LARGE_PAYMENT_THRESHOLD ?? 100_000);
    if (input.amount >= threshold) {
      return reply.code(409).send({
        error: 'amount_exceeds_wallet_tier',
        route: 'forge-custody',
        threshold_usd: threshold,
        detail: 'FORGE Payments must route this transfer through FORGE Custody threshold signing.',
      });
    }

    const user = getUser(claims.sub);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });

    const wallet = getActiveWallet(claims.sub, input.blockchain as Blockchain);
    if (!wallet) return reply.code(404).send({ error: 'no_wallet_for_chain' });
    const encryptedKey = getEncryptedKey(wallet.keyId);
    if (!encryptedKey) return reply.code(500).send({ error: 'key_unavailable' });

    const tx = createTransaction({
      ownerId: claims.sub,
      did: user.did,
      walletId: wallet.id,
      blockchain: wallet.blockchain,
      fromAddress: wallet.address,
      toAddress: input.to_address,
      amount: input.amount,
      currency: input.currency,
      paymentTerms: input.payment_terms ?? null,
    });

    try {
      // Decrypt → sign → discard. The plaintext key lives only in this scope.
      const privateKeyPem = decryptPrivateKey(encryptedKey, input.password);
      const nonce = tx.id;
      const hash = transactionHash({
        from_address: wallet.address, to_address: input.to_address, amount: input.amount,
        currency: input.currency, blockchain: wallet.blockchain, nonce,
      });
      const adapter = CHAIN_ADAPTERS[wallet.blockchain];
      const signature = adapter.signTransactionHash(hash, privateKeyPem);
      transitionTransaction(tx.id, 'signed', { signature });

      const txHash = await adapter.broadcast({
        from_address: wallet.address, to_address: input.to_address, amount: input.amount,
        currency: input.currency, blockchain: wallet.blockchain, signature, nonce,
      });
      transitionTransaction(tx.id, 'broadcast', { txHash });

      const confirmed = transitionTransaction(tx.id, 'confirmed', {
        confirmations: CONFIRMATIONS_REQUIRED,
        confirmedAt: new Date().toISOString(),
      })!;

      const sponsorship = recordGasSponsorship(confirmed);
      gasSponsoredUsdTotal.inc(sponsorship.sponsoredUsd ?? GAS_SPONSORSHIP_USD_PER_TX);
      await emitOntologyEvent(confirmed);

      return reply.code(201).send({
        transaction_id: confirmed.id,
        status: confirmed.status,
        tx_hash: confirmed.txHash,
        confirmations: confirmed.confirmations,
        gas_sponsored_usd: GAS_SPONSORSHIP_USD_PER_TX,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Wrong password surfaces as an AES-GCM auth failure — report cleanly.
      if (/unable to authenticate|bad decrypt|auth/i.test(message)) {
        transitionTransaction(tx.id, 'failed', { failureReason: 'key_decrypt_failed' });
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      transitionTransaction(tx.id, 'failed', { failureReason: message });
      logger.error({ err, txId: tx.id }, '[wallet] transaction pipeline failed');
      return reply.code(502).send({ error: 'transaction_failed', transaction_id: tx.id });
    }
  });

  app.get('/api/v1/transactions', async (req, reply) => {
    const claims = requireUser(req, reply);
    if (!claims) return;
    return listTransactions(claims.sub).map((t) => ({
      id: t.id, blockchain: t.blockchain, to_address: t.toAddress, amount: t.amount,
      currency: t.currency, status: t.status, tx_hash: t.txHash, created_at: t.createdAt,
    }));
  });

  app.get('/api/v1/gas-sponsorship', async (req, reply) => {
    const claims = requireUser(req, reply);
    if (!claims) return;
    return listGasSponsorship(claims.sub);
  });

  // ── Agent wallets (platform-to-platform) ───────────────────────────────────
  const agentSchema = z.object({
    name: z.string().min(1).max(120),
    owner_platform: z.string().min(1).max(120),
  });

  app.post('/api/v1/agents/wallets', async (req, reply) => {
    if (!requireAgentPlatformKey(req, reply)) return;
    const parsed = agentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.flatten() });
    const { agent, wallets, signingSecret } = createAgentWallets(parsed.data.name, parsed.data.owner_platform);
    // signingSecret is returned exactly once; only its hash is retained.
    return reply.code(201).send({
      agent: { id: agent.id, did: agent.did, name: agent.name },
      wallets: wallets.map((w) => ({ blockchain: w.blockchain, address: w.address })),
      signing_secret: signingSecret,
    });
  });

  // ── DID lookup (Agent Credit Bureau reads this) ────────────────────────────
  app.get('/api/v1/dids/by-address/:address', async (req, reply) => {
    const { address } = req.params as { address: string };
    const found = lookupDidByAddress(address);
    if (!found) return reply.code(404).send({ error: 'not_found' });
    return found;
  });

  // ── Trusted contacts & social recovery ─────────────────────────────────────
  const contactSchema = z.object({ email: z.string().email(), name: z.string().max(120).optional() });

  app.post('/api/v1/contacts', async (req, reply) => {
    const claims = requireUser(req, reply);
    if (!claims) return;
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const result = addTrustedContact(claims.sub, parsed.data.email, parsed.data.name ?? null);
    if ('error' in result) return reply.code(409).send(result);
    return reply.code(201).send(result);
  });

  app.get('/api/v1/contacts', async (req, reply) => {
    const claims = requireUser(req, reply);
    if (!claims) return;
    return listTrustedContacts(claims.sub);
  });

  const recoveryInitSchema = z.object({ email: z.string().email() });

  app.post('/api/v1/recovery/initiate', { config: authRateLimit }, async (req, reply) => {
    const parsed = recoveryInitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const user = findUserByEmail(parsed.data.email);
    // Do not reveal whether the email exists.
    if (!user) return reply.code(202).send({ status: 'accepted' });
    const result = initiateRecovery(user.id);
    if ('error' in result) return reply.code(409).send(result);
    recoveryRequestsTotal.inc({ status: 'initiated' });
    // Tokens are emailed to trusted contacts via email-service in production.
    // They are returned inline ONLY outside production (dev/test flows).
    const devTokens = process.env.NODE_ENV === 'production' ? undefined : result.tokens;
    return reply.code(202).send({
      status: 'accepted',
      request_id: result.request.id,
      required_approvals: result.request.requiredApprovals,
      ...(devTokens ? { dev_tokens: devTokens } : {}),
    });
  });

  app.post('/api/v1/recovery/approve/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const result = approveRecovery(token);
    if ('error' in result) return reply.code(400).send(result);
    return {
      request_id: result.request.id,
      status: result.request.status,
      approvals: result.approvals,
      required_approvals: result.request.requiredApprovals,
    };
  });

  const recoveryCompleteSchema = z.object({
    request_id: z.string().min(4),
    new_password: z.string().min(10).max(256),
  });

  app.post('/api/v1/recovery/complete', async (req, reply) => {
    const parsed = recoveryCompleteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.flatten() });
    const result = completeRecovery(parsed.data.request_id, parsed.data.new_password);
    if ('error' in result) return reply.code(409).send(result);
    const passwordHash = await bcrypt.hash(parsed.data.new_password, BCRYPT_ROUNDS);
    updateUserPasswordHash(result.request.userId, passwordHash);
    recoveryRequestsTotal.inc({ status: 'completed' });
    const user = getUser(result.request.userId)!;
    return {
      status: 'recovered',
      token: issueToken(user.id, user.did),
      wallets: result.wallets.map((w) => ({ blockchain: w.blockchain, address: w.address })),
    };
  });

  return app;
}

async function main(): Promise<void> {
  requireProductionSecrets();
  try {
    await runMigrations();
  } catch (err) {
    if (process.env.NODE_ENV === 'production') throw err;
    logger.warn({ err }, '[wallet] Postgres unavailable — running in-memory only (dev)');
  }
  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info({ port: PORT }, '[wallet] FORGE Wallet listening');
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, '[wallet] fatal startup error');
    process.exit(1);
  });
}
