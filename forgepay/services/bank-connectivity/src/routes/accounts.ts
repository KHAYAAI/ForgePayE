/**
 * Account routes — link, list, refresh, and manage bank accounts.
 *
 * All routes require a valid JWT (injected via preHandler hook).
 * The merchant ID is extracted from the JWT sub claim.
 *
 * Route summary:
 *   POST /api/v1/link/plaid/token         create Plaid Link token
 *   POST /api/v1/link/plaid/exchange      exchange public token, persist account
 *   GET  /api/v1/accounts                 list merchant's linked accounts
 *   GET  /api/v1/accounts/:id             get account detail + current balance
 *   PUT  /api/v1/accounts/:id             update nickname / status
 *   DELETE /api/v1/accounts/:id           disconnect account
 *   POST /api/v1/accounts/:id/refresh     force real-time balance refresh
 *   GET  /api/v1/accounts/:id/transactions paginated transaction history
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { verifyJwt } from '../middleware/auth';
import * as plaid from '../plaid/client';
import * as accountService from '../services/accountService';
import type { PlaidExchangeRequest } from '../types';
import { logger } from '../lib/logger';

// ── Zod validation schemas ────────────────────────────────────────────────────

const ExchangeBody = z.object({
  publicToken: z.string().min(1),
  metadata: z.object({
    institution: z.object({
      name:           z.string().optional(),
      institution_id: z.string().optional(),
    }).optional(),
    accounts: z.array(z.object({
      id:      z.string(),
      name:    z.string(),
      mask:    z.string(),
      type:    z.string(),
      subtype: z.string(),
    })).optional(),
  }).default({}),
});

const UpdateAccountBody = z.object({
  nickname: z.string().max(100).optional(),
  status:   z.enum(['active', 'disconnected']).optional(),
});

const TransactionQueryParams = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page:      z.coerce.number().int().min(1).default(1),
  perPage:   z.coerce.number().int().min(1).max(500).default(100),
});

// ── Route registration ────────────────────────────────────────────────────────

export async function buildAccountRoutes(app: FastifyInstance): Promise<void> {
  // Apply JWT auth to all routes in this plugin
  app.addHook('preHandler', verifyJwt);

  // ── POST /api/v1/link/plaid/token ─────────────────────────────────────────
  app.post('/link/plaid/token', async (req: FastifyRequest, reply: FastifyReply) => {
    const merchantId = req.jwtPayload.sub;

    // userId can be merchant-scoped — use merchantId as the Plaid user ID
    // so the same merchant always gets the same Plaid user bucket.
    try {
      const token = await plaid.createLinkToken(merchantId, merchantId);
      return reply.code(200).send(token);
    } catch (err) {
      logger.error({ err, merchantId }, 'createLinkToken failed');
      return reply.code(502).send({
        statusCode: 502,
        error:   'Bad Gateway',
        message: err instanceof Error ? err.message : 'Failed to create Plaid link token',
      });
    }
  });

  // ── POST /api/v1/link/plaid/exchange ──────────────────────────────────────
  app.post('/link/plaid/exchange', async (req: FastifyRequest, reply: FastifyReply) => {
    const merchantId = req.jwtPayload.sub;

    const parsed = ExchangeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        statusCode: 400,
        error:   'Bad Request',
        message: parsed.error.issues.map((i) => i.message).join(', '),
      });
    }

    const body = parsed.data as PlaidExchangeRequest;

    try {
      const { accessToken, itemId } = await plaid.exchangePublicToken(body.publicToken);
      const linkedAccounts = await accountService.linkPlaidAccount(
        merchantId,
        body,
        accessToken,
        itemId,
      );

      return reply.code(201).send({
        accounts: linkedAccounts,
        count:    linkedAccounts.length,
      });
    } catch (err) {
      logger.error({ err, merchantId }, 'exchangePublicToken failed');
      return reply.code(502).send({
        statusCode: 502,
        error:   'Bad Gateway',
        message: err instanceof Error ? err.message : 'Failed to exchange Plaid token',
      });
    }
  });

  // ── GET /api/v1/accounts ──────────────────────────────────────────────────
  app.get('/accounts', async (req: FastifyRequest, reply: FastifyReply) => {
    const merchantId = req.jwtPayload.sub;
    const accts      = accountService.getAccountsForMerchant(merchantId);
    return reply.code(200).send({ accounts: accts, count: accts.length });
  });

  // ── GET /api/v1/accounts/:id ──────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/accounts/:id',
    async (req, reply) => {
      const merchantId = req.jwtPayload.sub;

      try {
        const account = accountService.getAccount(req.params.id, merchantId);
        return reply.code(200).send(account);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'NOT_FOUND') {
          return reply.code(404).send({
            statusCode: 404,
            error:   'Not Found',
            message: `Account ${req.params.id} not found`,
          });
        }
        throw err;
      }
    },
  );

  // ── PUT /api/v1/accounts/:id ──────────────────────────────────────────────
  app.put<{ Params: { id: string } }>(
    '/accounts/:id',
    async (req, reply) => {
      const merchantId = req.jwtPayload.sub;

      const parsed = UpdateAccountBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          statusCode: 400,
          error:   'Bad Request',
          message: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      try {
        const updated = accountService.updateAccount(
          req.params.id,
          merchantId,
          parsed.data,
        );
        return reply.code(200).send(updated);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'NOT_FOUND') {
          return reply.code(404).send({
            statusCode: 404,
            error:   'Not Found',
            message: `Account ${req.params.id} not found`,
          });
        }
        throw err;
      }
    },
  );

  // ── DELETE /api/v1/accounts/:id ───────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/accounts/:id',
    async (req, reply) => {
      const merchantId = req.jwtPayload.sub;

      try {
        await accountService.disconnectAccount(req.params.id, merchantId);
        return reply.code(204).send();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'NOT_FOUND') {
          return reply.code(404).send({
            statusCode: 404,
            error:   'Not Found',
            message: `Account ${req.params.id} not found`,
          });
        }
        throw err;
      }
    },
  );

  // ── POST /api/v1/accounts/:id/refresh ────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/accounts/:id/refresh',
    async (req, reply) => {
      const merchantId = req.jwtPayload.sub;

      try {
        const account = await accountService.refreshBalance(req.params.id, merchantId);
        return reply.code(200).send(account);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'NOT_FOUND') {
          return reply.code(404).send({
            statusCode: 404,
            error:   'Not Found',
            message: `Account ${req.params.id} not found`,
          });
        }
        logger.error({ err, accountId: req.params.id }, 'Balance refresh failed');
        return reply.code(502).send({
          statusCode: 502,
          error:   'Bad Gateway',
          message: err instanceof Error ? err.message : 'Balance refresh failed',
        });
      }
    },
  );

  // ── GET /api/v1/accounts/:id/transactions ────────────────────────────────
  app.get<{
    Params:      { id: string };
    Querystring: Record<string, string>;
  }>(
    '/accounts/:id/transactions',
    async (req, reply) => {
      const merchantId = req.jwtPayload.sub;

      const parsed = TransactionQueryParams.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({
          statusCode: 400,
          error:   'Bad Request',
          message: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      const q = parsed.data;

      // Default date range: last 30 days
      const endDate   = q.endDate   ?? new Date().toISOString().slice(0, 10);
      const startDate = q.startDate ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const offset    = (q.page - 1) * q.perPage;

      try {
        const account = accountService.getAccount(req.params.id, merchantId);

        if (account.provider === 'plaid') {
          const accessToken = accountService.getAccessToken(req.params.id);
          const { transactions, totalTransactions } = await plaid.getTransactions(
            accessToken,
            startDate,
            endDate,
            offset,
            q.perPage,
          );

          return reply.code(200).send({
            transactions,
            total:   totalTransactions,
            page:    q.page,
            perPage: q.perPage,
            hasMore: offset + q.perPage < totalTransactions,
          });
        } else if (account.provider === 'open_banking' && account.obAccountId) {
          const { getOpenBankingClient } = await import('../openbanking/client');
          const consentId   = accountService.getConsentId(req.params.id);
          const obClient    = getOpenBankingClient();
          const transactions = await obClient.getTransactions(
            account.obAccountId,
            consentId,
            startDate,
            endDate,
          );

          const page    = q.page;
          const perPage = q.perPage;
          const sliced  = transactions.slice(offset, offset + perPage);

          return reply.code(200).send({
            transactions: sliced,
            total:   transactions.length,
            page,
            perPage,
            hasMore: offset + perPage < transactions.length,
          });
        } else {
          return reply.code(422).send({
            statusCode: 422,
            error:   'Unprocessable Entity',
            message: 'Transaction history is not available for manual accounts',
          });
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'NOT_FOUND') {
          return reply.code(404).send({
            statusCode: 404,
            error:   'Not Found',
            message: `Account ${req.params.id} not found`,
          });
        }
        logger.error({ err, accountId: req.params.id }, 'Fetch transactions failed');
        return reply.code(502).send({
          statusCode: 502,
          error:   'Bad Gateway',
          message: err instanceof Error ? err.message : 'Failed to fetch transactions',
        });
      }
    },
  );
}
