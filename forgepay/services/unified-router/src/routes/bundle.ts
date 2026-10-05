import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import * as killbill from '../lib/killbill-client';
import { isCatalogPlan } from '../lib/plans';

const BUNDLE_PLAN = 'bundle-treasury-creditbureau';

export async function bundleRoutes(app: FastifyInstance) {
  // POST /v1/bundle/upgrade-to-bundle — Convert Treasury + Credit Bureau to bundle
  app.post<{ Body: UpgradeToBundleRequest }>(
    '/upgrade-to-bundle',
    async (request, reply) => {
      const customerId = (request.user as any).customerId;
      const tenantId = (request.user as any).tenantId;

      try {
        const customer = await db.query(
          tenantId,
          `SELECT kb_account_id, products, subscriptions FROM customers WHERE id = $1`,
          [customerId]
        );

        if (!customer.rows[0]) {
          return reply.status(404).send({ error: 'customer_not_found' });
        }

        const kbAccountId = customer.rows[0].kb_account_id;
        const subscriptions = customer.rows[0].subscriptions || {};

        const hasTreasury = subscriptions.treasury?.kb_subscription_id;
        const hasCreditBureau = subscriptions['credit-bureau']?.kb_subscription_id;

        if (!hasTreasury || !hasCreditBureau) {
          return reply
            .status(400)
            .send({ error: 'both_products_required', message: 'Bundle requires both Treasury and Credit Bureau' });
        }

        // The bundle plan is not in the Kill Bill catalog yet. Without this
        // check the route cancelled both subscriptions and then failed to
        // create the bundle, leaving the customer with neither.
        if (!isCatalogPlan(BUNDLE_PLAN)) {
          return reply.status(422).send({ error: 'plan_not_in_catalog', plan: BUNDLE_PLAN });
        }

        // Create the bundle first; cancel the individual subscriptions only
        // once it exists, so a failure never leaves the customer with nothing.
        const bundleSubscription = await killbill.createSubscription({
          accountId: kbAccountId,
          planName: BUNDLE_PLAN,
          externalKey: `bundle-${customerId}`,
        });

        await Promise.all([
          killbill.cancelSubscription(subscriptions.treasury.kb_subscription_id),
          killbill.cancelSubscription(subscriptions['credit-bureau'].kb_subscription_id),
        ]);

        // Update Postgres
        subscriptions.bundle = {
          kb_subscription_id: bundleSubscription.subscriptionId,
          plan_name: BUNDLE_PLAN,
          created_at: new Date().toISOString(),
          savings: 3500,
        };

        await db.query(
          tenantId,
          `UPDATE customers SET subscriptions = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(subscriptions), customerId]
        );

        // Log event
        await db.query(
          tenantId,
          `INSERT INTO revenue_events 
           (customer_id, tenant_id, product, event_type, metadata, event_timestamp)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            customerId,
            tenantId,
            'bundle',
            'BUNDLE_CREATED',
            JSON.stringify({
              previous_treasury: subscriptions.treasury.kb_subscription_id,
              previous_credit_bureau: subscriptions['credit-bureau'].kb_subscription_id,
              bundle_subscription: bundleSubscription.subscriptionId,
              monthly_savings: 3500,
            }),
          ]
        );

        return reply.send({
          success: true,
          bundle_id: bundleSubscription.subscriptionId,
          monthly_savings: 3500,
          message: 'Successfully bundled Treasury and Credit Bureau. Saving R3.5K/mo!',
        });
      } catch (err) {
        console.error('POST /bundle/upgrade-to-bundle error:', err);
        return reply.status(500).send({ error: String(err) });
      }
    }
  );
}

interface UpgradeToBundleRequest {
  bundle_type: 'treasury-creditbureau';
}
