/**
 * The published API contract cannot drift from the service.
 *  - everything documented is a real route,
 *  - every route in the authorisation table is either documented or consciously left out (with a reason),
 *  - the document is served without a key, and its $refs resolve.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';
import { SCOPED_ROUTES } from './auth';
import { documentedRoutes, openApiDocument } from './openapi';

/** Scoped routes that are not in the institution contract, and why. Add here only on purpose. */
const LEFT_OUT: Record<string, string> = {
  'GET /v1/agents': 'listing every agent is an operator and console view',
  'POST /v1/agents/:agentId/simulate': 'what-if tooling, not part of the integration contract',
  'POST /v1/agents/:agentId/verify': 'verification checks are run by the bureau',
  'POST /v1/verify/sanctions': 'screening is run by the bureau',
  'GET /v1/grade-scale': 'static reference, shown on the public site',
  'GET /v1/bureau/stats': 'platform analytics for the operator and console',
  'POST /v1/reports/:reportId/zk': 'zero-knowledge proofs are a stub and are not offered',
  'GET /v1/disputes': 'resolving disputes is the bureau\'s side',
  'PUT /v1/disputes/:disputeId': 'resolving disputes is the bureau\'s side',
  'POST /v1/agents/:agentId/events': 'single-event ingest by agent; institutions use the batch route',
  'POST /v1/sandbox/consent': 'documented, but exists only in a sandbox (checked separately below)',
};

let sandboxApp: FastifyInstance | undefined;
afterAll(async () => { await sandboxApp?.close(); });

describe('the institution API document', () => {
  it('documents only routes that exist', async () => {
    const app = await buildApp();
    await app.ready();
    const missing = documentedRoutes()
      .filter((k) => k !== 'POST /v1/sandbox/consent')
      .filter((k) => { const [method, url] = k.split(' '); return !app.hasRoute({ method: method as 'GET', url }); });
    await app.close();
    expect(missing, `documented but not a real route: ${missing.join(', ')}`).toEqual([]);
  });

  it('documents the sandbox consent route, which exists in a sandbox', async () => {
    process.env['BUREAU_SANDBOX'] = 'true';
    try { sandboxApp = await buildApp(); await sandboxApp.ready(); } finally { delete process.env['BUREAU_SANDBOX']; }
    expect(sandboxApp.hasRoute({ method: 'POST', url: '/v1/sandbox/consent' })).toBe(true);
    expect(documentedRoutes()).toContain('POST /v1/sandbox/consent');
  });

  it('leaves out no scoped route without a stated reason', () => {
    const documented = new Set(documentedRoutes());
    const undocumented = SCOPED_ROUTES.filter((k) => !documented.has(k) && !(k in LEFT_OUT));
    expect(undocumented, `scoped but neither documented nor left out on purpose: ${undocumented.join(', ')}`).toEqual([]);
  });

  it('lists no route in LEFT_OUT that no longer needs the entry', () => {
    const documented = new Set(documentedRoutes());
    const stale = Object.keys(LEFT_OUT).filter((k) => documented.has(k) && k !== 'POST /v1/sandbox/consent');
    expect(stale).toEqual([]);
  });

  it('is served without a key', async () => {
    const app = await buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toBe('3.0.3');
  });

  it('has resolvable references and a response on every operation', () => {
    const schemas = Object.keys(openApiDocument.components.schemas);
    const text = JSON.stringify(openApiDocument);
    for (const m of text.matchAll(/#\/components\/schemas\/(\w+)/g)) expect(schemas).toContain(m[1]);
    for (const [path, item] of Object.entries(openApiDocument.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, { responses?: object }>)) {
        expect(Object.keys(op.responses ?? {}).length, `${method} ${path} has no responses`).toBeGreaterThan(0);
      }
    }
  });

  it('every documented path parameter is declared', () => {
    for (const [path, item] of Object.entries(openApiDocument.paths)) {
      const names = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const [method, op] of Object.entries(item as Record<string, { parameters?: Array<{ name: string; in: string }> }>)) {
        const declared = (op.parameters ?? []).filter((p) => p.in === 'path').map((p) => p.name);
        for (const n of names) expect(declared, `${method} ${path} missing path param ${n}`).toContain(n);
      }
    }
  });
});
