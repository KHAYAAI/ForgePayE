/**
 * Merchant summary — the real data behind the console's Payments product
 * pages (apps/platform/app/dashboard/payments/*).
 *
 * Scoped by email, not a bearer credential the merchant holds: the console
 * calls this server-side (internal secret) on behalf of whichever tenant is
 * signed in, the same pattern routes/events.ts already uses. A merchant who
 * hasn't been through checkout yet has no `customers` row — this returns a
 * real "not activated" zero state, not a 404, so the console can render it
 * as an honest empty dashboard rather than an error.
 */

import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { db } from '../db/index.js';

interface CustomerRow {
  id: string;
  email: string;
  name: string | null;
  status: string;
  created_at: string;
}

interface RevenueEventRow {
  id: string;
  product: string;
  event_type: string;
  amount_usd_cents: string;
  currency: string;
  event_timestamp: string;
}

function requireInternalAuth(req: { headers: Record<string, unknown> }): boolean {
  const authHeader = (req.headers['authorization'] as string) ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.headers['x-internal-auth'] as string ?? '');
  return token === config.internalWebhookSecret;
}

export async function buildMerchantRoutes(app: FastifyInstance) {
  // GET /v1/merchant/summary?email=founder@acme.co — this tenant's own
  // FORGE Payments activity: activation status, revenue event totals, and
  // the most recent events. All real; a fresh signup with no checkout yet
  // returns activated:false and every count at zero.
  app.get<{ Querystring: { email?: string; limit?: string } }>(
    '/v1/merchant/summary',
    async (req, reply) => {
      if (!requireInternalAuth(req)) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const email = req.query.email?.trim().toLowerCase();
      if (!email) {
        return reply.status(400).send({ error: 'ValidationError', message: 'email is required' });
      }
      const limit = Math.min(parseInt(req.query.limit ?? '25', 10) || 25, 100);

      const customerResult = await db.query<CustomerRow>(
        'public',
        `SELECT id, email, name, status, created_at FROM customers WHERE email = $1 LIMIT 1`,
        [email],
      );
      const customer = customerResult.rows[0];

      if (!customer) {
        return reply.send({
          data: {
            activated: false,
            customer: null,
            stats: { events24h: 0, eventsTotal: 0, revenueUsdCents24h: 0, revenueUsdCentsTotal: 0 },
            recentEvents: [],
          },
        });
      }

      const [count24h, countTotal, events] = await Promise.all([
        db.query<{ n: string; sum: string }>(
          'public',
          `SELECT COUNT(*)::text AS n, COALESCE(SUM(amount_usd_cents), 0)::text AS sum
             FROM revenue_events WHERE customer_id = $1 AND event_timestamp > NOW() - INTERVAL '24 hours'`,
          [customer.id],
        ),
        db.query<{ n: string; sum: string }>(
          'public',
          `SELECT COUNT(*)::text AS n, COALESCE(SUM(amount_usd_cents), 0)::text AS sum
             FROM revenue_events WHERE customer_id = $1`,
          [customer.id],
        ),
        db.query<RevenueEventRow>(
          'public',
          `SELECT id::text, product, event_type, amount_usd_cents::text, currency, event_timestamp
             FROM revenue_events WHERE customer_id = $1 ORDER BY event_timestamp DESC LIMIT $2`,
          [customer.id, limit],
        ),
      ]);

      return reply.send({
        data: {
          activated: true,
          customer: { id: customer.id, email: customer.email, name: customer.name, status: customer.status, createdAt: customer.created_at },
          stats: {
            events24h: parseInt(count24h.rows[0]!.n, 10),
            eventsTotal: parseInt(countTotal.rows[0]!.n, 10),
            revenueUsdCents24h: parseInt(count24h.rows[0]!.sum, 10),
            revenueUsdCentsTotal: parseInt(countTotal.rows[0]!.sum, 10),
          },
          recentEvents: events.rows.map((e) => ({
            id: e.id,
            product: e.product,
            eventType: e.event_type,
            amountUsdCents: parseInt(e.amount_usd_cents, 10),
            currency: e.currency,
            occurredAt: e.event_timestamp,
          })),
        },
      });
    },
  );
}
