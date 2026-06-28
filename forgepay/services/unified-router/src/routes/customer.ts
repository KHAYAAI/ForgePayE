import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import * as killbill from '../lib/killbill-client';
import { v4 as uuidv4 } from 'uuid';

export async function customerRoutes(app: FastifyInstance) {
  // GET /v1/customer/products — List licensed products and subscriptions
  app.get('/products', async (request, reply) => {
    const customerId = (request.user as any).customerId;
    const tenantId = (request.user as any).tenantId;

    try {
      const customer = await db.query(
        tenantId,
        `SELECT products, subscriptions FROM customers WHERE id = $1`,
        [customerId]
      );

      if (!customer.rows[0]) {
        return reply.status(404).send({ error: 'customer_not_found' });
      }

      const products = customer.rows[0].products || [];
      const subscriptions = customer.rows[0].subscriptions || {};

      return reply.send({
        products,
        subscriptions,
        upgrade_url: 'https://forgepay.com/checkout',
      });
    } catch (err) {
      console.error('GET /products error:', err);
      return reply.status(500).send({ error: 'internal_server_error' });
    }
  });

  // POST /v1/customer/products/grant — Grant product license (admin only)
  app.post<{ Body: GrantProductRequest }>(
    '/products/grant',
    async (request, reply) => {
      const isAdmin = (request.user as any).role === 'admin';
      if (!isAdmin) {
        return reply.status(403).send({ error: 'admin_only' });
      }

      const customerId = (request.body as any).customerId;
      const product = (request.body as any).product;
      const plan = (request.body as any).plan || 'standard';
      const tenantId = (request.user as any).tenantId;

      try {
        // Fetch customer
        const customer = await db.query(
          tenantId,
          `SELECT kb_account_id, products, subscriptions FROM customers WHERE id = $1`,
          [customerId]
        );

        if (!customer.rows[0]) {
          return reply.status(404).send({ error: 'customer_not_found' });
        }

        const kbAccountId = customer.rows[0].kb_account_id;
        const currentProducts = customer.rows[0].products || [];
        const currentSubscriptions = customer.rows[0].subscriptions || {};

        if (currentProducts.includes(product)) {
          return reply.status(400).send({ error: 'product_already_licensed' });
        }

        // Create Kill Bill subscription
        const planName = `${product}-${plan}`;
        const subscription = await killbill.createSubscription({
          accountId: kbAccountId,
          planName,
          externalKey: `${product}-${customerId}`,
        });

        // Update customer in Postgres
        const newProducts = [...currentProducts, product];
        currentSubscriptions[product] = {
          kb_subscription_id: subscription.subscriptionId,
          plan_name: planName,
          granted_at: new Date().toISOString(),
          trial_ends_at: subscription.billingPeriodStartDate || null,
        };

        await db.query(
          tenantId,
          `UPDATE customers 
           SET products = $1, subscriptions = $2, updated_at = NOW()
           WHERE id = $3`,
          [newProducts, JSON.stringify(currentSubscriptions), customerId]
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
            product,
            'LICENSE_GRANTED',
            JSON.stringify({
              plan: planName,
              kb_subscription_id: subscription.subscriptionId,
            }),
          ]
        );

        return reply.send({
          success: true,
          product,
          plan,
          subscription_id: subscription.subscriptionId,
        });
      } catch (err) {
        console.error('POST /products/grant error:', err);
        return reply.status(500).send({ error: String(err) });
      }
    }
  );

  // PATCH /v1/customer/subscriptions/:product — Upgrade subscription
  app.patch<{ Params: { product: string }; Body: UpgradeRequest }>(
    '/subscriptions/:product',
    async (request, reply) => {
      const customerId = (request.user as any).customerId;
      const tenantId = (request.user as any).tenantId;
      const product = request.params.product as string;
      const newPlan = (request.body as any).plan || 'standard';

      try {
        const customer = await db.query(
          tenantId,
          `SELECT subscriptions FROM customers WHERE id = $1`,
          [customerId]
        );

        const subscriptions = customer.rows[0]?.subscriptions || {};
        const currentSub = subscriptions[product];

        if (!currentSub) {
          return reply.status(404).send({ error: 'subscription_not_found' });
        }

        const kbSubscriptionId = currentSub.kb_subscription_id;
        const newPlanName = `${product}-${newPlan}`;

        // Change plan in Kill Bill (proration happens automatically)
        const updated = await killbill.changeSubscriptionPlan(kbSubscriptionId, newPlanName);

        // Update Postgres
        subscriptions[product] = {
          ...currentSub,
          plan_name: newPlanName,
          upgraded_at: new Date().toISOString(),
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
            product,
            'SUBSCRIPTION_UPGRADED',
            JSON.stringify({
              from_plan: currentSub.plan_name,
              to_plan: newPlanName,
              kb_subscription_id: kbSubscriptionId,
            }),
          ]
        );

        return reply.send({
          success: true,
          plan: newPlanName,
          subscription_id: kbSubscriptionId,
        });
      } catch (err) {
        console.error('PATCH /subscriptions/:product error:', err);
        return reply.status(500).send({ error: String(err) });
      }
    }
  );

  // DELETE /v1/customer/subscriptions/:product — Cancel subscription
  app.delete<{ Params: { product: string } }>(
    '/subscriptions/:product',
    async (request, reply) => {
      const customerId = (request.user as any).customerId;
      const tenantId = (request.user as any).tenantId;
      const product = request.params.product;

      try {
        const customer = await db.query(
          tenantId,
          `SELECT subscriptions, products FROM customers WHERE id = $1`,
          [customerId]
        );

        const subscriptions = customer.rows[0]?.subscriptions || {};
        const currentSub = subscriptions[product];

        if (!currentSub) {
          return reply.status(404).send({ error: 'subscription_not_found' });
        }

        // Cancel in Kill Bill
        await killbill.cancelSubscription(currentSub.kb_subscription_id);

        // Update Postgres
        const newProducts = (customer.rows[0].products || []).filter((p: string) => p !== product);
        delete subscriptions[product];

        await db.query(
          tenantId,
          `UPDATE customers 
           SET products = $1, subscriptions = $2, updated_at = NOW()
           WHERE id = $3`,
          [newProducts, JSON.stringify(subscriptions), customerId]
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
            product,
            'SUBSCRIPTION_CANCELLED',
            JSON.stringify({ plan: currentSub.plan_name }),
          ]
        );

        return reply.send({ success: true });
      } catch (err) {
        console.error('DELETE /subscriptions/:product error:', err);
        return reply.status(500).send({ error: String(err) });
      }
    }
  );
}

interface GrantProductRequest {
  customerId: string;
  product: string;
  plan?: string;
}

interface UpgradeRequest {
  plan?: string;
}
