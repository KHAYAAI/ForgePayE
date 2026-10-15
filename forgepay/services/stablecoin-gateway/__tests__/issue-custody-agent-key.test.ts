/**
 * The agent-key issuing script, run as a real process against a local stub of the custody admin route. The thing that matters most:
 * the key reaches a file with owner-only permissions and appears nowhere else.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, statSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../scripts/issue-custody-agent-key.mjs', import.meta.url).pathname;
const ADMIN_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.admin-token-for-test.sig';
const NEW_KEY = 'ofb_agent_issued_key_0123456789';
const R1 = '0x' + 'ab'.repeat(20);
const CUSTOMER = '3f1c2d4e-0000-4000-8000-000000000001';

let server: http.Server | undefined; let dir: string | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function stub(reply: (req: { url: string; auth: string | undefined; body: any }) => { status: number; json: unknown }) {
  const seen: Array<{ url: string; auth: string | undefined; body: any }> = [];
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const entry = { url: req.url!, auth: req.headers['authorization'], body: raw ? JSON.parse(raw) : undefined };
      seen.push(entry);
      const r = reply(entry);
      res.statusCode = r.status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, seen };
}

function run(args: string[], env: Record<string, string | undefined> = {}) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env['PATH'], ...env } as NodeJS.ProcessEnv });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

const baseArgs = (url: string, out: string, extra: string[] = []) => [
  '--api-url', url, '--customer-id', CUSTOMER, '--key-id', 'key_1', '--recipients', R1,
  '--per-transfer-zar', '5000', '--daily-zar', '20000', '--out', out, ...extra,
];

describe('issuing an agent key', () => {
  it('writes the key to an owner-only file and prints it nowhere', async () => {
    dir = mkdtempSync(join(tmpdir(), 'issue-key-'));
    const out = join(dir, 'agent-key');
    const s = await stub(() => ({ status: 201, json: { agentId: 'agent_9', expiresAt: '2026-11-14T00:00:00Z', apiKey: NEW_KEY } }));
    const r = await run(baseArgs(s.url, out), { CUSTODY_ADMIN_TOKEN: ADMIN_TOKEN });

    expect(r.code).toBe(0);
    expect(readFileSync(out, 'utf8').trim()).toBe(NEW_KEY);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(r.out).not.toContain(NEW_KEY);
    expect(r.out).not.toContain(ADMIN_TOKEN);
    expect(r.out).toMatch(/Issued agent agent_9/);
    expect(s.seen).toHaveLength(1);
    expect(s.seen[0]!.url).toBe(`/organisations/${CUSTOMER}/agents`);
    expect(s.seen[0]!.auth).toBe(`Bearer ${ADMIN_TOKEN}`);
    expect(s.seen[0]!.body).toEqual({
      name: 'stablecoin-gateway', keyId: 'key_1', allowedTokens: ['USDC'], allowedRecipients: [R1],
      perTransferLimitZar: 5000, dailyLimitZar: 20000, expiresInDays: 30,
    });
  });

  it('a dry run sends nothing, writes nothing and needs no token', async () => {
    dir = mkdtempSync(join(tmpdir(), 'issue-key-'));
    const out = join(dir, 'agent-key');
    const s = await stub(() => ({ status: 500, json: {} }));
    const r = await run(baseArgs(s.url, out, ['--dry-run']));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Dry run/);
    expect(s.seen).toHaveLength(0);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses unsafe or malformed requests before any network call', async () => {
    dir = mkdtempSync(join(tmpdir(), 'issue-key-'));
    const out = join(dir, 'agent-key');
    const s = await stub(() => ({ status: 201, json: { apiKey: NEW_KEY } }));
    const cases: Array<[string[], RegExp]> = [
      [['--api-url', s.url, '--customer-id', CUSTOMER, '--key-id', 'k', '--per-transfer-zar', '1', '--daily-zar', '2', '--out', out], /--recipients is required/],
      [baseArgs(s.url, out).map((a) => (a === R1 ? '0x123' : a)), /Not a valid address/],
      [baseArgs(s.url, out, ['--expires-days', '200']), /capped at 90/],
      [baseArgs(s.url, out).map((a) => (a === '5000' ? '30000' : a)), /cannot exceed/],
      [baseArgs('https://u:p@custody.example.org', out), /credentials/],
      [baseArgs('http://custody.example.org', out), /must be https/],
      [baseArgs(s.url, out).filter((a, i, arr) => !(a === '--out' || arr[i - 1] === '--out')), /--out .* is required/],
    ];
    for (const [args, pattern] of cases) {
      const r = await run(args, { CUSTODY_ADMIN_TOKEN: ADMIN_TOKEN });
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.out).toMatch(pattern);
    }
    expect(s.seen).toHaveLength(0);
  });

  it('accepts an open list only when asked, and a long expiry only when asked', async () => {
    dir = mkdtempSync(join(tmpdir(), 'issue-key-'));
    const s = await stub(() => ({ status: 201, json: { agentId: 'a', apiKey: NEW_KEY } }));
    const noList = ['--api-url', s.url, '--customer-id', CUSTOMER, '--key-id', 'k', '--per-transfer-zar', '1', '--daily-zar', '2'];
    const r1 = await run([...noList, '--allow-open', '--out', join(dir, 'k1')], { CUSTODY_ADMIN_TOKEN: ADMIN_TOKEN });
    expect(r1.code).toBe(0);
    expect(r1.out).toMatch(/OPEN/);
    expect(s.seen[0]!.body.allowedRecipients).toBeUndefined();
    const r2 = await run(baseArgs(s.url, join(dir, 'k2'), ['--expires-days', '120', '--allow-long']), { CUSTODY_ADMIN_TOKEN: ADMIN_TOKEN });
    expect(r2.code).toBe(0);
  });

  it('needs the admin token from the environment, and never overwrites an existing key file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'issue-key-'));
    const out = join(dir, 'agent-key');
    const s = await stub(() => ({ status: 201, json: { agentId: 'a', apiKey: NEW_KEY } }));
    expect((await run(baseArgs(s.url, out))).out).toMatch(/CUSTODY_ADMIN_TOKEN is not set/);
    writeFileSync(out, 'precious');
    const r = await run(baseArgs(s.url, out), { CUSTODY_ADMIN_TOKEN: ADMIN_TOKEN });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/already exists/);
    expect(readFileSync(out, 'utf8')).toBe('precious');
    expect(s.seen).toHaveLength(0);
  });

  it('writes nothing and shows custody\'s reason when custody refuses, and when it returns no key', async () => {
    dir = mkdtempSync(join(tmpdir(), 'issue-key-'));
    const refuse = await stub(() => ({ status: 403, json: { message: 'insufficient role' } }));
    const a = await run(baseArgs(refuse.url, join(dir, 'a')), { CUSTODY_ADMIN_TOKEN: ADMIN_TOKEN });
    expect(a.code).toBe(1);
    expect(a.out).toMatch(/Custody refused \(HTTP 403\): insufficient role/);
    expect(a.out).not.toContain(ADMIN_TOKEN);
    expect(existsSync(join(dir, 'a'))).toBe(false);
    await new Promise<void>((r) => server!.close(() => r()));

    const nokey = await stub(() => ({ status: 201, json: { agentId: 'a' } }));
    const b = await run(baseArgs(nokey.url, join(dir, 'b')), { CUSTODY_ADMIN_TOKEN: ADMIN_TOKEN });
    expect(b.code).toBe(1);
    expect(b.out).toMatch(/returned no agent key/);
    expect(existsSync(join(dir, 'b'))).toBe(false);
  });
});
