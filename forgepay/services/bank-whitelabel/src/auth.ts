/**
 * Bank Admin Authentication
 *
 * Provides JWT-based auth separate from ForgePay merchant auth.
 * Tokens carry { adminId, bankId, role } so every downstream handler
 * can enforce tenant isolation without an extra DB lookup.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Admins, Banks, hashPassword, verifyPassword } from './store.js';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';

const isProduction = (): boolean => process.env['NODE_ENV'] === 'production';
/** Passwords set through the API in production. (Login keeps its looser check so existing short passwords can still sign in.) */
export const MIN_PRODUCTION_PASSWORD = 12;
const PLATFORM_BANK_ID = 'platform';

/**
 * The seed route created admins, including super_admins, for any bank with no authentication at all, in every environment
 * ("dev/testing only" in a comment, nothing in the code). Anyone who could reach the service in production could mint themselves
 * a super_admin and read every bank's customers and transactions. In production it now needs a signed-in super_admin; outside
 * production it stays open for local development.
 */
async function seedGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isProduction()) return;
  await authenticate(request, reply);
  if (reply.sent) return;
  if (extractRole(request) !== 'super_admin') {
    reply.status(403).send({ error: 'Forbidden', message: 'Only a super_admin can create admins.' });
  }
}

function tokensMatch(presented: unknown, expected: string): boolean {
  if (typeof presented !== 'string') return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ── Login ─────────────────────────────────────────────────────────────────
  app.post<{
    Body: { email: string; password: string };
  }>(
    '/v1/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email:    { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const admin = Admins.findByEmail(email);
      if (!admin || !verifyPassword(password, admin.passwordHash)) {
        // Constant-time-ish rejection: verifyPassword uses timingSafeEqual internally
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const bank = Banks.findById(admin.bankId);
      if (!bank || bank.status === 'suspended') {
        return reply.status(403).send({ error: 'Bank account is suspended' });
      }

      const token = (app as unknown as { jwt: { sign: (payload: unknown, opts: unknown) => string } })
        .jwt.sign(
          { adminId: admin.id, bankId: admin.bankId, role: admin.role },
          { expiresIn: '8h' },
        );

      Admins.updateLastLogin(admin.id);

      return reply.send({ token, bankId: admin.bankId, role: admin.role });
    },
  );

  // ── Create an admin ────────────────────────────────────────────────────────
  // Open in development. In production it needs a signed-in super_admin (see seedGuard).
  app.post<{
    Body: { bankId: string; email: string; password: string; role?: string };
  }>(
    '/v1/auth/seed',
    {
      preHandler: [seedGuard],
      schema: {
        body: {
          type: 'object',
          required: ['bankId', 'email', 'password'],
          properties: {
            bankId:   { type: 'string' },
            email:    { type: 'string' },
            password: { type: 'string' },
            role:     { type: 'string', enum: ['super_admin', 'admin', 'viewer'] },
          },
        },
      },
    },
    async (request, reply) => {
      const { bankId, email, password, role } = request.body;

      if (isProduction() && password.length < MIN_PRODUCTION_PASSWORD) {
        return reply.status(400).send({ error: `Password must be at least ${MIN_PRODUCTION_PASSWORD} characters.` });
      }

      if (!Banks.findById(bankId)) {
        return reply.status(404).send({ error: `Bank '${bankId}' not found` });
      }

      const existing = Admins.findByEmail(email);
      if (existing) {
        return reply.status(409).send({ error: 'Admin with this email already exists' });
      }

      const admin = Admins.create({
        id:           randomUUID(),
        bankId,
        email,
        passwordHash: hashPassword(password),
        role:         (role as 'super_admin' | 'admin' | 'viewer') ?? 'admin',
        createdAt:    new Date().toISOString(),
      });

      return reply.status(201).send({
        id:     admin.id,
        email:  admin.email,
        bankId: admin.bankId,
        role:   admin.role,
      });
    },
  );
}

// The first super_admin in production. There is no seeded account in production, so without this nobody could ever sign in.
// Needs BANK_BOOTSTRAP_TOKEN (32+ characters, from the secret store) presented as `x-bootstrap-token`, and works only while there
// are no admins at all: once the first exists it answers 409, so a leaked token cannot add a second super_admin later.
export async function registerBootstrapRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email: string; password: string } }>(
    '/v1/auth/bootstrap',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const expected = process.env['BANK_BOOTSTRAP_TOKEN'];
      // Not configured (or too weak to trust): the route does not exist as far as a caller can tell.
      if (!expected || expected.length < 32) return reply.status(404).send({ error: 'NotFound', path: request.url });
      if (!tokensMatch(request.headers['x-bootstrap-token'], expected)) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Missing or wrong bootstrap token.' });
      }
      if (Admins.count() > 0) {
        return reply.status(409).send({ error: 'AlreadyBootstrapped', message: 'An admin already exists. Remove BANK_BOOTSTRAP_TOKEN.' });
      }
      const { email, password } = request.body;
      if (password.length < MIN_PRODUCTION_PASSWORD) {
        return reply.status(400).send({ error: `Password must be at least ${MIN_PRODUCTION_PASSWORD} characters.` });
      }

      if (!Banks.findById(PLATFORM_BANK_ID)) {
        Banks.create({
          id: PLATFORM_BANK_ID, name: 'FORGE Platform', slug: PLATFORM_BANK_ID, webhookFormat: 'forgepay',
          webhookSigningKey: randomBytes(24).toString('hex'), kycInherited: false, amlLevel: 'standard',
          settlementCurrency: 'USD', settlementSchedule: 'daily', createdAt: new Date().toISOString(), status: 'active', adminEmails: [email],
        });
      }
      const admin = Admins.create({
        id: randomUUID(), bankId: PLATFORM_BANK_ID, email, passwordHash: hashPassword(password), role: 'super_admin',
        createdAt: new Date().toISOString(),
      });
      request.log.warn({ adminId: admin.id, email }, 'first super_admin created through bootstrap');
      return reply.status(201).send({ id: admin.id, email: admin.email, bankId: admin.bankId, role: admin.role });
    },
  );
}

// ── Middleware helpers ─────────────────────────────────────────────────────────

export function extractBankId(request: FastifyRequest): string {
  return (request.user as { bankId: string }).bankId;
}

export function extractAdminId(request: FastifyRequest): string {
  return (request.user as { adminId: string }).adminId;
}

export function extractRole(request: FastifyRequest): string {
  return (request.user as { role: string }).role;
}

export function extractIp(request: FastifyRequest): string {
  return (request.headers['x-forwarded-for'] as string | undefined)
    ?.split(',')[0]?.trim() ?? request.ip ?? 'unknown';
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({ error: 'Unauthorized — valid JWT required' });
  }
}
