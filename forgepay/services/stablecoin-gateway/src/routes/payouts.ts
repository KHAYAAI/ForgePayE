/**
 * Outbound payout routes.
 *
 * The inverse of the x402 inbound flow: where /x402/pay opens an intent for
 * money coming in, these move money out — the rail the credit bureau needs to
 * pay furnishers the revenue share it already computes and cannot currently
 * disburse.
 *
 * Submission is deliberately a separate call from creation. Creating a payout
 * records an obligation; submitting it moves money. Collapsing the two would
 * mean a client retry of "record what I owe" becomes a second transfer, and
 * would leave no point at which an approver can stand between the two for
 * amounts that warrant it.
 */

import type { FastifyInstance } from 'fastify';
import {
  createPayout, getPayout, listPayouts, approvePayout, rejectPayout, submitPayout,
  validatePayoutRequest, requiresApproval,
  PAYOUT_AUTO_APPROVE_MAX_USD, PAYOUT_ABSOLUTE_MAX_USD, currentBroadcaster,
  type PayoutStatus,
} from '../lib/payouts.js';

interface CreateBody {
  external_id?:   string;
  payee_id?:      string;
  payee_address?: string;
  chain?:         string;
  amount_usdc?:   number;
  reason?:        string;
}

export async function buildPayoutRoutes(app: FastifyInstance) {
  // ── Configuration, so a caller can see the limits before hitting them ──────
  app.get('/config', async (_req, reply) => {
    return reply.send({
      auto_approve_max_usd: PAYOUT_AUTO_APPROVE_MAX_USD,
      absolute_max_usd:     PAYOUT_ABSOLUTE_MAX_USD,
      broadcaster:          currentBroadcaster().name,
      note: currentBroadcaster().name === 'unconfigured'
        ? 'No outbound signer is configured. Payouts can be recorded and approved, but ' +
          'submission is refused in production rather than simulated.'
        : undefined,
    });
  });

  // ── Create ────────────────────────────────────────────────────────────────
  app.post<{ Body: CreateBody }>('/', async (req, reply) => {
    const body = req.body ?? {};
    const requestedBy = (req.headers['x-forge-service'] as string) || 'unknown';

    if (!body.payee_id) {
      return reply.code(400).send({ error: 'ValidationError', field: 'payee_id', message: 'payee_id is required' });
    }
    if (!body.reason) {
      return reply.code(400).send({ error: 'ValidationError', field: 'reason', message: 'reason is required' });
    }

    const invalid = validatePayoutRequest({
      externalId:   body.external_id ?? '',
      payeeAddress: body.payee_address ?? '',
      amountUsdc:   body.amount_usdc ?? NaN,
    });
    if (invalid) {
      return reply.code(400).send({ error: 'ValidationError', ...invalid });
    }

    const { payout, deduplicated } = await createPayout({
      externalId:   body.external_id!,
      payeeId:      body.payee_id,
      payeeAddress: body.payee_address!,
      chain:        body.chain ?? 'base',
      amountUsdc:   body.amount_usdc!,
      reason:       body.reason,
      requestedBy,
    });

    // 200 rather than 201 on a duplicate: nothing was created, and a caller
    // retrying after a timeout should be able to tell the difference.
    return reply.code(deduplicated ? 200 : 201).send({
      data: payout,
      deduplicated,
      requires_approval: requiresApproval(payout.amountUsdc),
    });
  });

  // ── Read ──────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const payout = await getPayout(req.params.id);
    if (!payout) return reply.code(404).send({ error: 'NotFound', message: `Payout ${req.params.id} not found` });
    return reply.send({ data: payout });
  });

  app.get<{ Querystring: { payee_id?: string; status?: string } }>('/', async (req, reply) => {
    const payouts = await listPayouts({
      ...(req.query.payee_id ? { payeeId: req.query.payee_id } : {}),
      ...(req.query.status ? { status: req.query.status as PayoutStatus } : {}),
    });
    return reply.send({ data: payouts, count: payouts.length });
  });

  // ── Approve / reject ──────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { approved_by?: string } }>(
    '/:id/approve', async (req, reply) => {
      const approvedBy = req.body?.approved_by;
      if (!approvedBy) {
        return reply.code(400).send({
          error: 'ValidationError', field: 'approved_by',
          message: 'approved_by is required — an approval must name who gave it',
        });
      }

      const result = await approvePayout(req.params.id, approvedBy);
      if (!result.ok) {
        return reply.code(result.reason === 'not_found' ? 404 : 409).send({
          error:   result.reason === 'not_found' ? 'NotFound' : 'NotPendingApproval',
          status:  result.status,
          message: result.reason === 'not_found'
            ? `Payout ${req.params.id} not found`
            : `Payout is ${result.status}, not pending approval`,
        });
      }
      return reply.send({ data: result.payout });
    },
  );

  app.post<{ Params: { id: string }; Body: { rejected_by?: string; reason?: string } }>(
    '/:id/reject', async (req, reply) => {
      const rejectedBy = req.body?.rejected_by;
      if (!rejectedBy) {
        return reply.code(400).send({ error: 'ValidationError', field: 'rejected_by', message: 'rejected_by is required' });
      }
      const result = await rejectPayout(req.params.id, rejectedBy, req.body?.reason ?? 'no reason given');
      if (!result.ok) {
        return reply.code(result.reason === 'not_found' ? 404 : 409).send({
          error: result.reason === 'not_found' ? 'NotFound' : 'NotPendingApproval', status: result.status,
        });
      }
      return reply.send({ data: result.payout });
    },
  );

  // ── Submit ────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/submit', async (req, reply) => {
    const result = await submitPayout(req.params.id);

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return reply.code(404).send({ error: 'NotFound', message: `Payout ${req.params.id} not found` });
      }
      if (result.reason === 'not_approved') {
        return reply.code(409).send({
          error: 'NotApproved', status: result.status,
          message: `Payout is ${result.status} — only an approved payout can be submitted`,
        });
      }
      // Broadcast failed. 502, and the payout is left `failed` rather than
      // re-armed: a transfer that errored may still have landed on-chain, and
      // automatically retrying it is how the same money goes out twice.
      return reply.code(502).send({
        error: 'BroadcastFailed', status: result.status, message: result.message,
        note: 'The payout is marked failed and will not retry automatically. Reconcile on-chain before re-issuing.',
      });
    }

    return reply.send({ data: result.payout, already_submitted: result.alreadySubmitted });
  });
}
