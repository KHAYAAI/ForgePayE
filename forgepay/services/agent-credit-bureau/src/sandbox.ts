/**
 * Sandbox mode: a separate deployment where an institution can test its whole integration without real money or real data.
 *
 *   BUREAU_SANDBOX=true
 *
 * A sandbox is its own deployment with its own database, never a flag on a live one: events a partner sends while testing
 * would otherwise land in real credit files. Mode changes only what is safe to change:
 *
 *  - inquiries are free (no prepaid balance, no money moves);
 *  - the demo agents are seeded, so there is something to pull a report on;
 *  - any contributor may issue a consent token for a sandbox agent to itself (`POST /v1/sandbox/consent`), which in the live
 *    service is an operator action, so a partner can run the full lender flow alone;
 *  - every response carries `X-Forge-Environment: sandbox`, and /health says so.
 *
 * It refuses to start if it could reach real money: a gateway URL (where top-ups and payouts go) or a settlement key.
 * Authentication, scopes, scoring and sanctions behaviour are exactly the live ones.
 */

import type { FastifyInstance } from 'fastify';

export function isSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['BUREAU_SANDBOX'] === 'true';
}

/** Settings that would let a sandbox touch real money. */
const MONEY_SETTINGS = ['STABLECOIN_GATEWAY_URL', 'SETTLEMENT_PRIVATE_KEY'] as const;

export function assertSandboxSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (!isSandbox(env)) return;
  const present = MONEY_SETTINGS.filter((k) => env[k]);
  if (present.length > 0) {
    throw new Error(
      `BUREAU_SANDBOX=true refuses to start while ${present.join(' and ')} ${present.length > 1 ? 'are' : 'is'} set: ` +
      'a sandbox must not be able to move real money. Remove them, or run the live service instead.',
    );
  }
}

export function environmentName(env: NodeJS.ProcessEnv = process.env): 'sandbox' | 'live' {
  return isSandbox(env) ? 'sandbox' : 'live';
}

/** What a free sandbox inquiry looks like to the report code: nothing was charged. */
export const SANDBOX_CHARGE = { ok: true as const, kind: 'bundled' as const, bundledRemaining: 999_999 };

export function registerSandboxHeader(app: FastifyInstance): void {
  if (!isSandbox()) return;
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Forge-Environment', 'sandbox');
    return payload;
  });
}
