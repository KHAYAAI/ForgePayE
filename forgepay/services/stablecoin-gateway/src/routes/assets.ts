/**
 * GET  /assets                  — every asset the gateway is configured for, whether it is
 *                                 usable right now and why not if it isn't, plus current rates
 * PUT  /assets/rates/USD-ZAR    — set the rand rate (admin only)
 *
 * The rand rate is what prices ZARP; see lib/fx.ts for why it is set by an
 * operator, kept with its author and date, and refused when stale.
 */

import type { FastifyInstance } from 'fastify';
import { gatewayContext } from '../lib/context.js';
import { rateToScaled, scaledToRate } from '../lib/asset-math.js';
import { pollRate, feedConfig, feedSourcesFromEnv } from '../lib/fx-feed.js';
import { quoteFor, USD_ZAR, maxRateAgeMs, RateUnavailableError } from '../lib/fx.js';

/** A new rate more than this far from the last one needs an explicit `confirm_large_change`. */
const LARGE_CHANGE = 0.25;

export async function buildAssetRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    const ctx = await gatewayContext();
    const rand = await quoteFor('ZARP', 'ZAR', ctx.rates).then(
      (q) => ({ pair: q.pair, rate: q.rate, as_of: q.asOf, source: q.source, fresh: true }),
      (err: unknown) => ({ pair: USD_ZAR, rate: null, fresh: false, problem: err instanceof RateUnavailableError ? err.message : String(err) }),
    );
    reply.send({
      assets: ctx.registry.status().map((s) => ({
        symbol: s.symbol, chain: s.chain, contract: s.address, unit: s.unit, decimals: s.decimals,
        status: s.status, ...(s.problem ? { problem: s.problem } : {}),
        // A rand asset is only quotable while it has a fresh rate.
        quotable: s.status !== 'unavailable' && (s.unit === 'USD' || rand.fresh),
      })),
      rates: { 'USD/ZAR': rand, max_age_hours: maxRateAgeMs() / 3600_000 },
    });
  });

  // Run the live sources once, from where the gateway runs, without storing anything. Use it to confirm
  // the feed is reachable and agrees before turning FX_FEED_ENABLED on.
  app.get('/rates/feed/check', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return reply.code(403).send({ error: 'Forbidden', message: 'admin only' });
    const ctx = await gatewayContext();
    const last = await ctx.rates.latest(USD_ZAR);
    return reply.send(await pollRate(feedSourcesFromEnv(), feedConfig(), last ? Number(scaledToRate(last.scaled)) : null));
  });

  app.put<{ Body: { rate?: number | string; source?: string; as_of?: string; confirm_large_change?: boolean } }>(
    '/rates/USD-ZAR',
    async (req, reply) => {
      if (req.auth?.kind !== 'admin') {
        return reply.code(403).send({ error: 'Forbidden', message: 'only an operator key may set an exchange rate' });
      }
      const body = req.body ?? {};
      let scaled: bigint;
      try { scaled = rateToScaled(body.rate as string | number); }
      catch (err) { return reply.code(400).send({ error: 'ValidationError', field: 'rate', message: (err as Error).message }); }
      const asFloat = Number(scaledToRate(scaled));
      if (asFloat < 5 || asFloat > 100) {
        return reply.code(400).send({ error: 'ValidationError', field: 'rate', message: `${asFloat} ZAR per USD is outside the plausible range 5–100` });
      }
      if (!body.source || typeof body.source !== 'string') {
        return reply.code(400).send({ error: 'ValidationError', field: 'source', message: 'source is required (where this rate came from)' });
      }
      const asOf = body.as_of ? new Date(body.as_of) : new Date();
      if (Number.isNaN(asOf.getTime()) || asOf.getTime() > Date.now() + 5 * 60_000) {
        return reply.code(400).send({ error: 'ValidationError', field: 'as_of', message: 'as_of must be a valid time, not in the future' });
      }
      const ctx = await gatewayContext();
      const previous = await ctx.rates.latest(USD_ZAR);
      if (previous && !body.confirm_large_change) {
        const prev = Number(scaledToRate(previous.scaled));
        if (Math.abs(asFloat - prev) / prev > LARGE_CHANGE) {
          return reply.code(409).send({
            error: 'LargeChange',
            message: `${asFloat} is more than ${LARGE_CHANGE * 100}% away from the current ${prev}. Resend with confirm_large_change: true if that is right.`,
          });
        }
      }
      await ctx.rates.put({ pair: USD_ZAR, scaled, asOf, source: body.source, setBy: `${req.auth.kind}` });
      reply.code(201).send({ pair: USD_ZAR, rate: scaledToRate(scaled), as_of: asOf.toISOString(), source: body.source });
    },
  );
}
