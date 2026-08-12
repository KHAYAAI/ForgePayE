/**
 * `paymentHistoryRate` regression coverage, at the route level.
 *
 * `computePaymentHistoryRate` itself is unit-tested in scorer.test.ts. This
 * file guards that every real surface which mutates `creditHistory` actually
 * calls it — a defaulted agent previously scored as a perfect payer on two of
 * the three mutation paths:
 *
 *   - `POST /v1/agents/:agentId/events` excluded `default` from its
 *     denominator (`eventType.startsWith('payment')`), so a run of defaults
 *     with no recorded late payments left the rate at a perfect 1.0.
 *   - `POST /v1/contributors/:id/ingest` — the real furnisher pipeline —
 *     never recomputed the rate at all. Ingesting defaults through the path
 *     actual lenders use moved nothing.
 *   - Dispute resolution (`disputes.test.ts` covers the dispute-specific
 *     assertions) shares the same fix via `computePaymentHistoryRate`, so a
 *     deleted/corrected default's drag on the rate lifts with it.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';

const ADMIN = 'dev-bureau-admin-key';
const bearer = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function register(agentId: string) {
  return app.inject({
    method: 'POST', url: `/v1/agents/${agentId}/profile`, headers: bearer(ADMIN),
    payload: {
      agentId, did: `did:forge:${agentId}`,
      operatorEntityId: 'EIN-00-0000000', operatorEntityType: 'llc',
    },
  });
}

async function profile(agentId: string) {
  const res = await app.inject({
    method: 'GET', url: `/v1/agents/${agentId}/profile`, headers: bearer(ADMIN),
  });
  return res.json().data;
}

describe('POST /v1/agents/:agentId/events — payment history rate', () => {
  it('moves the rate and the score on repeated defaults, with no on-time payments recorded', async () => {
    const agentId = 'agent_ph_events';
    await register(agentId);
    const before = await profile(agentId);
    expect(before.paymentHistoryRate).toBe(1.0);

    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST', url: `/v1/agents/${agentId}/events`, headers: bearer(ADMIN),
        payload: { eventType: 'default', amount: 1000, description: `default ${i}` },
      });
      expect(res.statusCode).toBe(201);
    }

    const after = await profile(agentId);
    expect(after.paymentHistoryRate).toBe(0); // all six obligations defaulted
    expect(after.currentScore).toBeLessThan(before.currentScore);
    expect(after.scoreFactors.some((f: { code: string }) => f.code === 'RECENT_DEFAULT')).toBe(true);
  });

  it('scales the penalty by count rather than flipping a flat penalty once', async () => {
    // Both agents share the same on-time base so paymentHistoryRate stays
    // above the floor for both — otherwise a 100%-defaulted rate (0) already
    // maxes out the component on its own and the count-scaling this guards
    // is invisible in the total score, which is what happened when this test
    // was first written against two agents with nothing but defaults on file.
    const oneDefault = 'agent_ph_one';
    const threeDefaults = 'agent_ph_three';
    await register(oneDefault);
    await register(threeDefaults);

    for (const agentId of [oneDefault, threeDefaults]) {
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: 'POST', url: `/v1/agents/${agentId}/events`, headers: bearer(ADMIN),
          payload: { eventType: 'payment_on_time', amount: 100, description: `payment ${i}` },
        });
      }
    }

    await app.inject({
      method: 'POST', url: `/v1/agents/${oneDefault}/events`, headers: bearer(ADMIN),
      payload: { eventType: 'default', amount: 1000, description: 'default' },
    });
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST', url: `/v1/agents/${threeDefaults}/events`, headers: bearer(ADMIN),
        payload: { eventType: 'default', amount: 1000, description: `default ${i}` },
      });
    }

    const [one, three] = await Promise.all([profile(oneDefault), profile(threeDefaults)]);
    expect(three.paymentHistoryRate).toBeLessThan(one.paymentHistoryRate);
    expect(three.currentScore).toBeLessThan(one.currentScore);
  });
});

describe('POST /v1/contributors/:id/ingest — payment history rate', () => {
  async function furnisher(name: string) {
    const res = await app.inject({
      method: 'POST', url: '/v1/contributors', headers: bearer(ADMIN),
      payload: { name, type: 'defi_protocol', permissions: ['ingest_events'] },
    });
    const d = res.json().data;
    await app.inject({
      method: 'PUT', url: `/v1/contributors/${d.id}/status`, headers: bearer(ADMIN),
      payload: { status: 'active', reason: 'test' },
    });
    return { id: d.id as string, key: d.apiKey as string };
  }

  it('moves the rate through the real furnisher pipeline — previously untouched by ingest at all', async () => {
    const agentId = 'agent_ph_ingest';
    await register(agentId);
    const f = await furnisher('ph-ingest-lender');
    const before = await profile(agentId);
    expect(before.paymentHistoryRate).toBe(1.0);

    const res = await app.inject({
      method: 'POST', url: `/v1/contributors/${f.id}/ingest`, headers: bearer(f.key),
      payload: {
        agentId,
        events: Array.from({ length: 4 }, (_, i) => ({
          externalId: `ext_${i}`,
          eventType: 'default',
          amount: 1000,
          description: `default ${i}`,
        })),
      },
    });
    expect(res.statusCode).toBe(201);

    const after = await profile(agentId);
    // Before the fix this was still exactly 1.0 — ingest never touched it.
    expect(after.paymentHistoryRate).toBe(0);
    expect(after.currentScore).toBeLessThan(before.currentScore);
  });
});
