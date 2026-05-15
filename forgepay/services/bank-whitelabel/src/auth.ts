/**
 * Bank Admin Authentication
 *
 * Provides JWT-based auth separate from ForgePay merchant auth.
 * Tokens carry { adminId, bankId, role } so every downstream handler
 * can enforce tenant isolation without an extra DB lookup.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Admins, Banks, hashPassword } from './store.js';
import { randomUUID } from 'node:crypto';

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
      if (!admin || admin.passwordHash !== hashPassword(password)) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const bank = Banks.findById(admin.bankId);
      if (!bank || bank.status === 'suspended') {
        return reply.status(403).send({ error: 'Bank account is suspended' });
      }

      const token = (app as any).jwt.sign(
        {
          adminId: admin.id,
          bankId:  admin.bankId,
          role:    admin.role,
        },
        { expiresIn: '8h' },
      );

      Admins.updateLastLogin(admin.id);

      return reply.send({ token, bankId: admin.bankId, role: admin.role });
    },
  );

  // ── Seed admin (dev/testing only — remove in production) ─────────────────
  app.post<{
    Body: { bankId: string; email: string; password: string; role?: string };
  }>(
    '/v1/auth/seed',
    {
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
        role:         (role as any) ?? 'admin',
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

// ── Middleware helper ──────────────────────────────────────────────────────────

export function extractBankId(request: FastifyRequest): string {
  return (request.user as any)?.bankId as string;
}

export function extractRole(request: FastifyRequest): string {
  return (request.user as any)?.role as string;
}

/**
 * Prehandler that verifies the JWT and populates request.user.
 * Used as a preHandler on all protected routes.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized — valid JWT required' });
  }
}
