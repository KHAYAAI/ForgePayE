import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { getUpsellSignals } from '../lib/upsell-engine';

export async function csmRoutes(app: FastifyInstance) {
  // GET /v1/csm/dashboard/:customerId — CSM signals for a customer
  app.get<{ Params: { customerId: string } }>(
    '/dashboard/:customerId',
    async (request, reply) => {
      const { customerId } = request.params;
      const tenantId = (request.user as any).tenantId;

      try {
        // Fetch customer
        const customer = await db.query(
          tenantId,
          `SELECT id, name, products, subscriptions FROM customers WHERE id = $1`,
          [customerId]
        );

        if (!customer.rows[0]) {
          return reply.status(404).send({ error: 'customer_not_found' });
        }

        const customerData = customer.rows[0];
        const products = customerData.products || [];

        // Aggregate metrics by product
        const metricsQuery = await db.query(
          tenantId,
          `
            SELECT 
              product,
              COUNT(*) as event_count,
              CASE 
                WHEN product = 'payments' THEN SUM((metadata->>'amount')::BIGINT) / 100.0
                WHEN product = 'treasury' THEN SUM((metadata->>'total_amount_usd')::NUMERIC)
                ELSE COUNT(*)
              END as metric_value
            FROM revenue_events
            WHERE product = ANY($1::TEXT[])
              AND event_timestamp > NOW() - INTERVAL '30 days'
            GROUP BY product
          `,
          [products]
        );

        const metrics: Record<string, any> = {};
        for (const row of metricsQuery.rows) {
          metrics[row.product] = {
            event_count: row.event_count,
            metric_value: row.metric_value || 0,
          };
        }

        // Get upsell signals
        const upsellSignals = await getUpsellSignals(customerId, tenantId);

        // Calculate health score (0-100)
        const hasMultipleProducts = products.length > 1 ? 30 : 10;
        const hasPayments = products.includes('payments') ? 25 : 0;
        const hasTreasury = products.includes('treasury') ? 25 : 0;
        const hasCreditBureau = products.includes('credit-bureau') ? 20 : 0;
        const healthScore = Math.min(100, hasMultipleProducts + hasPayments + hasTreasury + hasCreditBureau);

        return reply.send({
          customer: {
            id: customerData.id,
            name: customerData.name,
            products,
          },
          metrics,
          upsell_signals: upsellSignals,
          health_score: healthScore,
          next_action:
            upsellSignals.length > 0
              ? `Recommend ${upsellSignals[0].product} (est. +R${(upsellSignals[0].estimatedMonthlyValue / 1000).toFixed(0)}K/mo)`
              : 'Monitor usage',
        });
      } catch (err) {
        console.error('GET /csm/dashboard/:customerId error:', err);
        return reply.status(500).send({ error: 'internal_server_error' });
      }
    }
  );

  // GET /v1/csm/customers/at-risk — List customers showing churn signals
  app.get('/customers/at-risk', async (request, reply) => {
    const tenantId = (request.user as any).tenantId;

    try {
      // Customers with declining usage (MRR or GMV down >20% month-over-month)
      const atRisk = await db.query(
        tenantId,
        `
          WITH monthly AS (
            SELECT 
              customer_id,
              DATE_TRUNC('month', event_timestamp)::DATE as month,
              product,
              CASE 
                WHEN product = 'payments' THEN SUM((metadata->>'amount')::BIGINT) / 100.0
                ELSE COUNT(*)
              END as monthly_value
            FROM revenue_events
            WHERE event_type = 'TRANSFER' OR event_type = 'SETTLEMENT'
            GROUP BY customer_id, DATE_TRUNC('month', event_timestamp), product
          ),
          trends AS (
            SELECT 
              customer_id,
              product,
              LAG(monthly_value) OVER (PARTITION BY customer_id, product ORDER BY month) as prev_value,
              monthly_value as curr_value
            FROM monthly
            WHERE month >= NOW()::DATE - INTERVAL '60 days'
          )
          SELECT DISTINCT customer_id
          FROM trends
          WHERE prev_value > 0 AND (curr_value / prev_value) < 0.8
        `,
        []
      );

      const atRiskCustomerIds = atRisk.rows.map((r) => r.customer_id);

      return reply.send({
        at_risk_count: atRiskCustomerIds.length,
        customer_ids: atRiskCustomerIds,
      });
    } catch (err) {
      console.error('GET /csm/customers/at-risk error:', err);
      return reply.status(500).send({ error: 'internal_server_error' });
    }
  });
}
