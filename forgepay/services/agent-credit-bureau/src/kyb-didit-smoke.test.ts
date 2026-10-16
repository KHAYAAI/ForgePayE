/** The smoke script, run as a real process against a local stub of Didit: it must pass on the expected shapes, flag the sandbox, and never print the key. */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', 'scripts', 'didit-kyb-smoke.mjs');
// A made-up placeholder, deliberately word-like so it is not mistaken for a real credential by secret scanners.
const FAKE_VALUE = 'placeholder-for-tests-not-a-real-secret';
let server: http.Server | undefined;
afterEach(async () => { await new Promise<void>((r) => (server ? server.close(() => r()) : r())); server = undefined; });

async function stub(handler: (path: string, headers: http.IncomingHttpHeaders) => { status: number; json: unknown }) {
  const seen: Array<{ path: string; key: string | undefined }> = [];
  server = http.createServer((req, res) => {
    req.resume(); req.on('end', () => {
      seen.push({ path: req.url!, key: req.headers['x-api-key'] as string | undefined });
      const r = handler(req.url!, req.headers); res.statusCode = r.status; res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, seen };
}
const run = (args: string[], env: Record<string, string>) => new Promise<{ code: number | null; out: string }>((resolve) => {
  const p = spawn(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env['PATH'], ...env } as NodeJS.ProcessEnv });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});
const cand = (over = {}) => ({ kyb_response_id: 'h1', name: 'ACME', registration_number: '1', status: 'active', ...over });
const search = (companies: unknown[]) => ({ kyb_registry: { companies, search_resolved: true } });
const select = { kyb_registry: { company_name: 'ACME', registration_number: '1', registry_status: 'active', country_code: 'ZA', fetch_status: 'resolved', data_resolved: true, is_from_registry: true } };

describe('the Didit smoke check', () => {
  it('passes on the expected shapes, sends the key only as the header, and does not pay without --select', async () => {
    const s = await stub((p) => (p === '/v3/kyb/search/' ? { status: 200, json: search([cand()]) } : { status: 200, json: select }));
    const r = await run(['--country', 'ZA', '--name', 'Acme'], { DIDIT_API_KEY: FAKE_VALUE, DIDIT_BASE_URL: s.url });
    expect(r.code).toBe(0);
    expect(r.out).toContain('All checks passed');
    expect(s.seen.map((x) => x.path)).toEqual(['/v3/kyb/search/']);
    expect(s.seen[0]!.key).toBe(FAKE_VALUE);
    expect(r.out).not.toContain(FAKE_VALUE);
  });

  it('pays for exactly one select when asked, and only if there is exactly one candidate', async () => {
    const one = await stub((p) => (p === '/v3/kyb/search/' ? { status: 200, json: search([cand()]) } : { status: 200, json: select }));
    const a = await run(['--country', 'ZA', '--name', 'Acme', '--select'], { DIDIT_API_KEY: FAKE_VALUE, DIDIT_BASE_URL: one.url });
    expect(a.code).toBe(0);
    expect(one.seen.map((x) => x.path)).toEqual(['/v3/kyb/search/', '/v3/kyb/select/']);
    await new Promise<void>((r) => server!.close(() => r()));
    const two = await stub(() => ({ status: 200, json: search([cand(), cand({ kyb_response_id: 'h2' })]) }));
    const b = await run(['--country', 'ZA', '--name', 'Acme', '--select'], { DIDIT_API_KEY: FAKE_VALUE, DIDIT_BASE_URL: two.url });
    expect(b.code).toBe(1);
    expect(b.out).toMatch(/exactly one candidate/);
    expect(two.seen.map((x) => x.path)).toEqual(['/v3/kyb/search/']);
  });

  it('flags a sandbox answer, and explains a rejected key or a wrong path', async () => {
    const sb = await stub(() => ({ status: 200, json: search([cand({ kyb_response_id: 'sandbox-kyb-response-x', registration_number: 'SANDBOX-0001' })]) }));
    const a = await run(['--country', 'ZA', '--name', 'Acme'], { DIDIT_API_KEY: FAKE_VALUE, DIDIT_BASE_URL: sb.url });
    expect(a.out).toMatch(/SANDBOX/);
    await new Promise<void>((r) => server!.close(() => r()));
    const denied = await stub(() => ({ status: 401, json: {} }));
    const b = await run(['--country', 'ZA', '--name', 'Acme'], { DIDIT_API_KEY: FAKE_VALUE, DIDIT_BASE_URL: denied.url });
    expect(b.code).toBe(1);
    expect(b.out).toMatch(/HTTP 401.*header name/s);
    expect(b.out).not.toContain(FAKE_VALUE);
  });

  it('flags a changed shape, and refuses to run without a key', async () => {
    const odd = await stub(() => ({ status: 200, json: { kyb_registry: { companies: [{ name: 'x' }], search_resolved: true } } }));
    const a = await run(['--country', 'ZA', '--name', 'Acme'], { DIDIT_API_KEY: FAKE_VALUE, DIDIT_BASE_URL: odd.url });
    expect(a.code).toBe(1);
    expect(a.out).toMatch(/kyb_response_id" is missing/);
    expect((await run(['--country', 'ZA', '--name', 'Acme'], {})).out).toMatch(/DIDIT_API_KEY is not set/);
  });
});
