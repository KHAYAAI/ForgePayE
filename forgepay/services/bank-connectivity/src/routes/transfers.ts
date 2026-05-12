/**
 * Transfer routes — initiate, list, inspect, and cancel ACH/SEPA/wire transfers.
 *
 * All routes require a valid JWT (preHandler: verifyJwt).
 * The merchant ID comes from the JWT sub claim.
 *
 * Route summary:
 *   POST   /api/v1/transfers          initiate a new transfer
 *   GET    /api/v1/transfers          list transfers (filter by status, date range)
 *   GET    /api/v1/transfers/:id      get transfer detail and current status
 *   DELETE /api/v1/transfers/:id      cancel a pending transfer
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { verifyJwt } from '../middleware/auth';
import * as transferService from '../services/transferService';
import { logger } from '../lib/logger';

// ── Zod validation schemas ────────────────────────────────────────────────────

const InitiateTransferBody = z.object({
  fromAccountId:  z.string().uuid(),
  toAccountId:    z.string().uuid(),
  amount:         z.number().positive().finite(),
  currency:       z.string().length(3).toUpperCase(),
  description:    z.string().min(1).max(140),
  type:           z.enum(['ach', 'wire', 'sepa']),
  scheduledDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idempotencyKey: z.string().max(64).optional(),
});

const ListTransfersQuery = z.object({
  status:   z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}T/).optional(),
  toDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}T/).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  perPage:  z.coerce.number().int().min(1).max(100).default(20),
});

// ── Route registration ────────────────────────────────────────────────────────

export async function buildTransferRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', verifyJwt);

  // ── POST /api/v1/transfers ────────────────────────────────────────────────
  app.post('/transfers', async (req: FastifyRequest, reply: FastifyReply) => {
    const merchantId = req.jwtPayload.sub;

    const parsed = InitiateTransferBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        statusCode: 400,
        error:   'Bad Request',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }

    try {
      const transfer = await transferService.initiateTransfer(merchantId, parsed.data);
      return reply.code(201).send(transfer);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException & { code?: string }).code;

      if (code === 'NOT_FOUND') {
        return reply.code(404).send({
          statusCode: 404,
          error:   'Not Found',
          message: err instanceof Error ? err.message : 'Account not found',
        });
      }
      if (code === 'INSUFFICIENT_FUNDS') {
        return reply.code(422).send({
          statusCode: 422,
          error:   'Unprocessable Entity',
          message: err instanceof Error ? err.message : 'Insufficient funds',
        });
      }
      if (code === 'ACCOUNT_NOT_ACTIVE') {
        return reply.code(422).send({
          statusCode: 422,
          error:   'Unprocessable Entity',
          message: err instanceof Error ? err.message : 'Account not active',
        });
      }

      logger.error({ err, merchantId }, 'Transfer initiation failed');
      return reply.code(502).send({
        statusCode: 502,
        error:   'Bad Gateway',
        message: err instanceof Error ? err.message : 'Transfer failed',
      });
    }
  });

  // ── GET /api/v1/transfers ─────────────────────────────────────────────────
  app.get<{ Querystring: Record<string, string> }>(
    '/transfers',
    async (req, reply) => {
      const merchantId = req.jwtPayload.sub;

      const parsed = ListTransfersQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({
          statusCode: 400,
          error:   'Bad Request',
          message: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      const q = parsed.data;
      const result = transferService.listTransfers({
        merchantId,
        status:   q.status,
        fromDate: q.fromDate,
        toDate:   q.toDate,
        page:     q.page,
        perPage:  q.perPage,
      });

      return reply.code(200).send(result);
    },
  );

  // ── GET /api/v1/transfers/:id ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/transfers/:id',
    async (req, reply) => {
      const merchantId = req.jwtPayload.sub;

      try {
        const transfer = transferService.getTransfer(req.params.id, merchantId);
        return reply.code(200).send(transfer);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'NOT_FOUND') {
          return reply.code(404).send({
            statusCode: 404,
            error:   'Not Found',
            message: `Transfer ${req.params.id} not found`,
          });
        }
        throw err;
      }
    },
  );

  // ── DELETE /api/v1/transfers/:id ──────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/transfers/:id',
    async (req, reply) => {
      const merchantId = req.jwtPayload.sub;

      try {
        const cancelled = await transferService.cancelTransfer(req.params.id, merchantId);
        return reply.code(200).send(cancelled);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException & { code?: string }).code;

        if (code === 'NOT_FOUND') {
          return reply.code(404).send({
            statusCode: 404,
            error:   'Not Found',
            message: `Transfer ${req.params.id} not found`,
          });
        }
        if (code === 'INVALID_STATE') {
          return reply.code(422).send({
            statusCode: 422,
            error:   'Unprocessable Entity',
            message: err instanceof Error ? err.message : 'Transfer cannot be cancelled',
          });
        }

        logger.error({ err, transferId: req.params.id }, 'Transfer cancellation failed');
        return reply.code(502).send({
          statusCode: 502,
          error:   'Bad Gateway',
          message: err instanceof Error ? err.message : 'Cancellation failed',
        });
      }
    },
  );
}
