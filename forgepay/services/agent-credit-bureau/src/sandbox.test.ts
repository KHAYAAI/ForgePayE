/**
 * Sandbox mode: free inquiries, self-issued consent, a visible label, and no way to touch real money.
 * Live behaviour must be unchanged when the flag is off.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';
import { assertSandboxSafe, environmentName, isSandbox } from './sandbox';
import { getAccountSummary } from './billing';

const ADMIN = 'dev-bureau-admin-key';
const AAVE = 'ck_aave_live_xxx';       // seeded demo institution: pull_scores + ingest_events
const AGENT = 'agent_prime_001';
const json = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });
const plain = (key: string) => ({ authorization: `Bearer ${key}` });

const SAVED = { ...process.env };
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  process.env = { ...SAVED };
});

async function build(sandbox: boolean): Promise<FastifyInstance> {
  if (sandbox) process.env['BUREAU_SANDBOX'] = 'true'; else delete process.env['BUREAU_SANDBOX'];
  delete process.env['STABLECOIN_GATEWAY_URL'];
  delete process.env['SETTLEMENT_PRIVATE_KEY'];
  app = await buildApp();
  await app.ready();
  return app;
}

describe('assertSandboxSafe', () => {
  it('does nothing when the flag is off, whatever else is set', () => {
    expect(() => assertSandboxSafe({ STABLECOIN_GATEWAY_URL: 'http://gw' } as NodeJS.ProcessEnv)).not.toThrow();
  });
  it('refuses to start while a gateway URL or a settlement key is set', () => {
    expect(() => assertSandboxSafe({ BUREAU_SANDBOX: 'true', STABLECOIN_GATEWAY_URL: 'http://gw' } as NodeJS.ProcessEnv)).toThrow(/STABLECOIN_GATEWAY_URL/);
    expect(() => assertSandboxSafe({ BUREAU_SANDBOX: 'true', SETTLEMENT_PRIVATE_KEY: '0xabc' } as NodeJS.ProcessEnv)).toThrow(/SETTLEMENT_PRIVATE_KEY/);
  });
  it('is fine with neither set, and only the exact value true turns it on', () => {
    expect(() => assertSandboxSafe({ BUREAU_SANDBOX: 'true' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(isSandbox({ BUREAU_SANDBOX: 'yes' } as NodeJS.ProcessEnv)).toBe(false);
    expect(environmentName({} as NodeJS.ProcessEnv)).toBe('live');
  });
  it('the app itself refuses to build with a gateway URL in a sandbox', async () => {
    process.env['BUREAU_SANDBOX'] = 'true';
    process.env['STABLECOIN_GATEWAY_URL'] = 'http://gw.example';
    await expect(buildApp()).rejects.toThrow(/sandbox must not be able to move real money/);
  });
});

describe('live behaviour is unchanged with the flag off', () => {
  it('says live, sends no sandbox header, and has no sandbox consent route', async () => {
    const a = await build(false);
    const health = await a.inject({ method: 'GET', url: '/health' });
    expect(health.json().environment).toBe('live');
    expect(health.headers['x-forge-environment']).toBeUndefined();
    const consent = await a.inject({ method: 'POST', url: '/v1/sandbox/consent', headers: json(AAVE), payload: { agentId: AGENT } });
    expect(consent.statusCode).toBe(404);
  });

  it('still charges: an unfunded pull is refused with 402', async () => {
    const a = await build(false);
    const consent = await a.inject({ method: 'POST', url: '/v1/consent', headers: json(ADMIN), payload: { agentId: AGENT, requestorId: 'live_unfunded_lender', purpose: 'credit_application' } });
    const token = consent.json().data.consentToken;
    const pull = await a.inject({
      method: 'POST', url: '/v1/lender-reports', headers: json(ADMIN),
      payload: { agentId: AGENT, requestorId: 'live_unfunded_lender', requestorName: 'Unfunded', purpose: 'credit_application', consentToken: token },
    });
    expect(pull.statusCode).toBe(402);
  });
});

describe('sandbox', () => {
  it('labels itself in /health and on every response', async () => {
    const a = await build(true);
    const health = await a.inject({ method: 'GET', url: '/health' });
    expect(health.json().environment).toBe('sandbox');
    expect(health.headers['x-forge-environment']).toBe('sandbox');
    const score = await a.inject({ method: 'GET', url: `/v1/agents/${AGENT}/score`, headers: plain(AAVE) });
    expect(score.headers['x-forge-environment']).toBe('sandbox');
  });

  it('lets an institution run the whole lender flow alone, free of charge', async () => {
    const a = await build(true);
    const consent = await a.inject({ method: 'POST', url: '/v1/sandbox/consent', headers: json(AAVE), payload: { agentId: AGENT, purpose: 'credit_application' } });
    expect(consent.statusCode).toBe(201);
    const { consentToken, scope } = consent.json().data;
    expect(scope.requestorId).toBeTruthy();

    const before = getAccountSummary(scope.requestorId).balanceUsdCents;
    const pull = await a.inject({
      method: 'POST', url: '/v1/lender-reports', headers: json(AAVE),
      payload: { agentId: AGENT, requestorId: scope.requestorId, requestorName: 'Sandbox Lender', purpose: 'credit_application', consentToken },
    });
    expect(pull.statusCode).toBeLessThan(300);
    expect(getAccountSummary(scope.requestorId).balanceUsdCents).toBe(before); // nothing was charged
    expect(pull.json().data).toBeDefined();
  });

  it('consent is single-use, bound to the institution, and an operator key cannot use the shortcut', async () => {
    const a = await build(true);
    const consent = await a.inject({ method: 'POST', url: '/v1/sandbox/consent', headers: json(AAVE), payload: { agentId: AGENT } });
    const token = consent.json().data.consentToken;
    const body = (requestorId: string) => ({ agentId: AGENT, requestorId, requestorName: 'X', purpose: 'credit_application', consentToken: token });
    const wrongBearer = await a.inject({ method: 'POST', url: '/v1/lender-reports', headers: json(AAVE), payload: body('someone_else') });
    expect(wrongBearer.statusCode).toBe(403);
    expect(wrongBearer.json().error).toBe('Forbidden'); // the caller does not own that requestorId
    const admin = await a.inject({ method: 'POST', url: '/v1/sandbox/consent', headers: json(ADMIN), payload: { agentId: AGENT } });
    expect(admin.statusCode).toBe(403);
    const missing = await a.inject({ method: 'POST', url: '/v1/sandbox/consent', headers: json(AAVE), payload: { agentId: 'no_such_agent' } });
    expect(missing.statusCode).toBe(404);
  });
});
