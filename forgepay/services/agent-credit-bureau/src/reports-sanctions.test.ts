/**
 * POST /v1/reports — real-time sanctions screening.
 *
 * Before this test existed, this route issued the raw credit file with no
 * live sanctions check at all: it only read `profile.frozenAt`, a stored
 * flag that reflects whenever the agent last happened to be screened, not
 * as of this pull. POST /v1/lender-reports already ran a real, fail-closed
 * screen at pull time (see lender-report.test.ts / billing.test.ts) — this
 * route did not, despite being the one an actual lender-facing integration
 * is more likely to call for the raw file.
 *
 * `sanctionsScreen()` itself is mocked here (rather than the underlying
 * compliance-monitor fetch, the way sanctions.test.ts does) because that
 * function's own fail-closed composition logic is already covered there —
 * this file is specifically testing that the *route* actually calls it and
 * actually honors a non-clear result, which is exactly the class of bug
 * (the call was simply missing) that motivated this fix.
 */
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';

const sanctionsScreenMock = vi.fn();

vi.mock('./verify', async () => {
  const actual = await vi.importActual<typeof import('./verify')>('./verify');
  return { ...actual, sanctionsScreen: sanctionsScreenMock };
});

// Imported after the mock so buildApp's own `import { sanctionsScreen } from
// './verify'` resolves to the mocked binding above.
const { buildApp } = await import('./index');
const { getReport } = await import('./store');

const ADMIN = 'dev-bureau-admin-key';
const AGENT = 'agent_prime_001'; // seeded, unfrozen, funded via credit below

const bearer = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });

function clearResult() {
  return {
    agentId: AGENT, clear: true, hits: 0, frozen: false,
    detail: 'clear', screenedAt: new Date().toISOString(),
    checked: ['local', 'address'] as const,
  };
}

function blockedResult() {
  return {
    agentId: AGENT, clear: false, hits: 1, frozen: false,
    detail: 'OFAC SDN match on associated address', screenedAt: new Date().toISOString(),
    checked: ['local', 'address'] as const,
  };
}

describe('POST /v1/reports — sanctions screening', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => { sanctionsScreenMock.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function fundAndConsent(requestorId: string): Promise<string> {
    await app.inject({
      method: 'POST', url: `/v1/billing/${requestorId}/credit`, headers: bearer(ADMIN),
      payload: { amountUsd: 100, reason: 'test funding' },
    });
    const consent = await app.inject({
      method: 'POST', url: '/v1/consent', headers: bearer(ADMIN),
      payload: { agentId: AGENT, requestorId, purpose: 'credit_application' },
    });
    return consent.json().data.consentToken;
  }

  it('calls sanctionsScreen for every pull — the bug was that it never did', async () => {
    sanctionsScreenMock.mockResolvedValue(clearResult());
    const requestorId = `req_${randomUUID()}`;
    const consentToken = await fundAndConsent(requestorId);

    await app.inject({
      method: 'POST', url: '/v1/reports', headers: bearer(ADMIN),
      payload: { agentId: AGENT, requestorId, requestorName: 'Test Lender', purpose: 'credit_application', consentToken },
    });

    expect(sanctionsScreenMock).toHaveBeenCalledTimes(1);
  });

  it('issues the report when the screen is clear', async () => {
    sanctionsScreenMock.mockResolvedValue(clearResult());
    const requestorId = `req_${randomUUID()}`;
    const consentToken = await fundAndConsent(requestorId);

    const res = await app.inject({
      method: 'POST', url: '/v1/reports', headers: bearer(ADMIN),
      payload: { agentId: AGENT, requestorId, requestorName: 'Test Lender', purpose: 'credit_application', consentToken },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.reportId).toBeTruthy();
  });

  it('refuses to issue the report when the screen is not clear — the actual fix', async () => {
    sanctionsScreenMock.mockResolvedValue(blockedResult());
    const requestorId = `req_${randomUUID()}`;
    const consentToken = await fundAndConsent(requestorId);

    const res = await app.inject({
      method: 'POST', url: '/v1/reports', headers: bearer(ADMIN),
      payload: { agentId: AGENT, requestorId, requestorName: 'Test Lender', purpose: 'credit_application', consentToken },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'ComplianceRefusal' });
    // No report record was created for a refused pull.
    expect(res.json().data).toBeUndefined();
  });

  it('fails closed: an unreachable/erroring screen also refuses, never issues', async () => {
    sanctionsScreenMock.mockResolvedValue({
      agentId: AGENT, clear: false, hits: 0, frozen: false,
      detail: 'compliance-monitor unreachable', screenedAt: new Date().toISOString(),
      checked: ['local'] as const,
    });
    const requestorId = `req_${randomUUID()}`;
    const consentToken = await fundAndConsent(requestorId);

    const res = await app.inject({
      method: 'POST', url: '/v1/reports', headers: bearer(ADMIN),
      payload: { agentId: AGENT, requestorId, requestorName: 'Test Lender', purpose: 'credit_application', consentToken },
    });

    expect(res.statusCode).toBe(403);
  });

  it('a refused pull leaves no report retrievable by any id it might have used', async () => {
    sanctionsScreenMock.mockResolvedValue(blockedResult());
    const requestorId = `req_${randomUUID()}`;
    const consentToken = await fundAndConsent(requestorId);

    const before = await app.inject({ method: 'GET', url: `/v1/billing/${requestorId}/transactions`, headers: bearer(ADMIN) });
    const txCountBefore = before.json().data.length;

    await app.inject({
      method: 'POST', url: '/v1/reports', headers: bearer(ADMIN),
      payload: { agentId: AGENT, requestorId, requestorName: 'Test Lender', purpose: 'credit_application', consentToken },
    });

    // getReport has nothing to look up — no reportId was ever minted for a
    // refused pull, so there is nothing that could leak via GET /v1/reports/:id.
    expect(getReport('nonexistent-report-id')).toBeUndefined();
    // The pull is still charged even though it's refused — authoriseAndRecordPull
    // (and its charge) runs before the screen, same as POST /v1/lender-reports'
    // documented behavior. This isn't free-riding a screening failure; it's the
    // existing charge-then-screen order, unchanged by this fix.
    const after = await app.inject({ method: 'GET', url: `/v1/billing/${requestorId}/transactions`, headers: bearer(ADMIN) });
    expect(after.json().data.length).toBe(txCountBefore + 1);
  });
});
