/**
 * The custody-backed payout signer. As with the hot-key signer's tests, most of these assert that money does NOT move: the happy
 * path is one request, while the dangerous cases are the ambiguous ones (a reply lost after custody paid, a payment still in
 * flight) and the ones where a service answers with something other than what was asked.
 *
 * Custody is replaced by a stand-in written from its controller source (helpers/custody-standin.ts). That proves this code follows
 * the contract, not that the real service does: custody-contract.test.ts runs read checks against a real deployment when given one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const state = vi.hoisted(() => ({ spentUsd: 0, logs: [] as unknown[][] }));
vi.mock('../src/lib/db.js', () => ({
  getDb: () => ({ query: vi.fn(async () => ({ rows: [{ total: String(state.spentUsd) }] })) }),
}));
vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: (...a: unknown[]) => { state.logs.push(a); }, warn: (...a: unknown[]) => { state.logs.push(a); },
    error: (...a: unknown[]) => { state.logs.push(a); }, debug: (...a: unknown[]) => { state.logs.push(a); },
  },
}));

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CustodyConfigError, CustodyPayoutBroadcaster, checkCustodyReadiness, custodyModeRequested, installConfiguredPayoutSigner, readAgentKey, resolveCustodyConfig,
  type CustodyConfig,
} from '../src/lib/custody-payout-signer.js';
import { currentBroadcaster, setPayoutBroadcaster, UnconfiguredBroadcaster, PayoutPendingError, PAYOUT_ABSOLUTE_MAX_USD, type Payout } from '../src/lib/payouts.js';
import { AGENT_KEY, StandInCustody, hashFor } from './helpers/custody-standin.js';

const ADDR = '0x' + 'ab'.repeat(20);

function payout(over: Partial<Payout> = {}): Payout {
  return {
    id: 'po_1', externalId: 'ext_1', payeeId: 'inst_1', payeeAddress: ADDR, chain: 'base-sepolia', amountUsdc: 1.5, asset: 'USDC',
    amountUnits: '1500000', decimals: 6, status: 'submitted', reason: 'monthly settlement', requestedBy: 'test',
    createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', ...over,
  };
}

const CFG: CustodyConfig = {
  baseUrl: 'https://custody.example.org', chain: 'base-sepolia', chainId: 84532, dailyMaxUsd: 5000, requireRecipientList: false, confirmations: 1,
  requestTimeoutMs: 5_000, waitMs: 10_000, resolveMs: 10_000, pollMs: 1_000,
};

/** A fake clock: sleeping advances time instantly, so timeouts are tested without waiting. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

function setup(cfg: Partial<CustodyConfig> = {}) {
  const custody = new StandInCustody();
  const b = new CustodyPayoutBroadcaster({ ...CFG, ...cfg }, AGENT_KEY, { fetch: custody.fetch, ...clock() });
  return { custody, b };
}

const posts = (c: StandInCustody) => c.calls.filter((x) => x.method === 'POST');

beforeEach(() => { state.spentUsd = 0; state.logs.length = 0; setPayoutBroadcaster(new UnconfiguredBroadcaster()); });
afterEach(() => { setPayoutBroadcaster(new UnconfiguredBroadcaster()); });

// ── Configuration ───────────────────────────────────────────────────────────

const GOOD_ENV = {
  NODE_ENV: 'production', PAYOUT_SIGNER_ENABLED: 'true', PAYOUT_SIGNER_MODE: 'custody', CUSTODY_API_URL: 'https://custody.example.org/',
  PAYOUT_SIGNER_CHAIN: 'base-sepolia', PAYOUT_SIGNER_DAILY_MAX_USD: '5000', CUSTODY_AGENT_KEY: AGENT_KEY,
} as unknown as NodeJS.ProcessEnv;
const env = (over: Record<string, string | undefined> = {}) => ({ ...GOOD_ENV, ...over }) as NodeJS.ProcessEnv;

describe('configuration', () => {
  it('resolves a complete configuration and normalises the URL', () => {
    expect(resolveCustodyConfig(env())).toMatchObject({ baseUrl: 'https://custody.example.org', chain: 'base-sepolia', chainId: 84532, dailyMaxUsd: 5000, confirmations: 1 });
  });

  it('is only requested when both the enable flag and the custody mode are exactly set', () => {
    expect(custodyModeRequested(env())).toBe(true);
    for (const over of [{ PAYOUT_SIGNER_ENABLED: '1' }, { PAYOUT_SIGNER_ENABLED: 'TRUE' }, { PAYOUT_SIGNER_MODE: 'Custody' }, { PAYOUT_SIGNER_MODE: undefined }]) {
      expect(custodyModeRequested(env(over)), JSON.stringify(over)).toBe(false);
    }
  });

  it('refuses to run beside a hot-wallet key, either form: custody mode exists to remove that key', () => {
    expect(() => resolveCustodyConfig(env({ PAYOUT_SIGNER_PRIVATE_KEY: '0x' + '1'.repeat(64) }))).toThrow(/hot-wallet key/);
    expect(() => resolveCustodyConfig(env({ PAYOUT_SIGNER_KEY_FILE: '/run/secrets/k' }))).toThrow(/hot-wallet key/);
  });

  it('refuses a missing, malformed, credentialed or insecure URL', () => {
    expect(() => resolveCustodyConfig(env({ CUSTODY_API_URL: undefined }))).toThrow(/CUSTODY_API_URL is not set/);
    expect(() => resolveCustodyConfig(env({ CUSTODY_API_URL: 'not a url' }))).toThrow(/not a valid URL/);
    expect(() => resolveCustodyConfig(env({ CUSTODY_API_URL: 'https://u:p@custody.example.org' }))).toThrow(/credentials/);
    expect(() => resolveCustodyConfig(env({ CUSTODY_API_URL: 'http://custody.example.org' }))).toThrow(/https/);
    expect(resolveCustodyConfig(env({ NODE_ENV: 'development', CUSTODY_API_URL: 'http://localhost:3000' })).baseUrl).toBe('http://localhost:3000');
  });

  it('refuses an unknown chain, a missing daily ceiling and a bad one', () => {
    expect(() => resolveCustodyConfig(env({ PAYOUT_SIGNER_CHAIN: undefined }))).toThrow(/PAYOUT_SIGNER_CHAIN is not set/);
    expect(() => resolveCustodyConfig(env({ PAYOUT_SIGNER_CHAIN: 'mars' }))).toThrow(/not a supported chain/);
    expect(() => resolveCustodyConfig(env({ PAYOUT_SIGNER_DAILY_MAX_USD: undefined }))).toThrow(/DAILY_MAX_USD is not set/);
    for (const bad of ['0', '-5', 'abc']) expect(() => resolveCustodyConfig(env({ PAYOUT_SIGNER_DAILY_MAX_USD: bad }))).toThrow(/positive number/);
  });

  it('allows a development chain id only outside production', () => {
    expect(() => resolveCustodyConfig(env({ PAYOUT_SIGNER_CHAIN_ID: '31337' }))).toThrow(/production/);
    expect(resolveCustodyConfig(env({ NODE_ENV: 'development', PAYOUT_SIGNER_CHAIN_ID: '31337' })).chainId).toBe(31337);
  });

  it('refuses bad timing values rather than defaulting silently', () => {
    expect(() => resolveCustodyConfig(env({ CUSTODY_REQUEST_TIMEOUT_MS: '0' }))).toThrow(/positive whole number/);
    expect(() => resolveCustodyConfig(env({ PAYOUT_SIGNER_WAIT_MS: 'soon' }))).toThrow(/positive whole number/);
  });
});

describe('the agent key', () => {
  it('is read from a mounted file in preference to the environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'custody-key-'));
    try {
      writeFileSync(join(dir, 'key'), AGENT_KEY + '\n');
      expect(readAgentKey(env({ CUSTODY_AGENT_KEY_FILE: join(dir, 'key'), CUSTODY_AGENT_KEY: 'ofb_agent_other' }))).toBe(AGENT_KEY);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('must be present and must be an agent key, and a wrong one is never echoed', () => {
    expect(() => readAgentKey(env({ CUSTODY_AGENT_KEY: undefined }))).toThrow(/No custody agent key/);
    expect(() => readAgentKey(env({ CUSTODY_AGENT_KEY_FILE: '/nonexistent/key' }))).toThrow(/could not be read/);
    const secret = 'sk_live_super_secret_value';
    try { readAgentKey(env({ CUSTODY_AGENT_KEY: secret })); expect.unreachable(); }
    catch (e) { expect(String((e as Error).message)).not.toContain(secret); expect(e).toBeInstanceOf(CustodyConfigError); }
  });
});

describe('installation', () => {
  it('leaves the hot-wallet path exactly as it was when no mode is set', () => {
    const r = installConfiguredPayoutSigner({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect(r).toMatchObject({ installed: false, mode: 'hot_key' });
    expect(currentBroadcaster().name).toBe('unconfigured');
  });

  it('refuses a mode it does not recognise, instead of picking a signer silently', () => {
    expect(() => installConfiguredPayoutSigner(env({ PAYOUT_SIGNER_MODE: 'Custody' }))).toThrow(/not recognised/);
    expect(() => installConfiguredPayoutSigner(env({ PAYOUT_SIGNER_MODE: 'kms' }))).toThrow(/not recognised/);
  });

  it('installs nothing in custody mode unless explicitly enabled', () => {
    const r = installConfiguredPayoutSigner(env({ PAYOUT_SIGNER_ENABLED: undefined }));
    expect(r).toMatchObject({ installed: false, mode: 'custody' });
    expect(currentBroadcaster().name).toBe('unconfigured');
  });

  it('installs the custody broadcaster when asked, and fails to start when it is half-configured', () => {
    const r = installConfiguredPayoutSigner(env());
    expect(r).toMatchObject({ installed: true, mode: 'custody', chain: 'base-sepolia', endpoint: 'https://custody.example.org' });
    expect(currentBroadcaster().name).toBe('custody');
    setPayoutBroadcaster(new UnconfiguredBroadcaster());
    expect(() => installConfiguredPayoutSigner(env({ CUSTODY_AGENT_KEY: undefined }))).toThrow(CustodyConfigError);
    expect(currentBroadcaster().name).toBe('unconfigured');
  });
});

// ── Paying ──────────────────────────────────────────────────────────────────

describe('a payment', () => {
  it('asks custody once, keyed by the payout id, with the amount as a decimal string, and returns the confirmed hash', async () => {
    const { custody, b } = setup();
    const sent: string[] = [];
    const r = await b.broadcast(payout(), { onSent: async (h) => { sent.push(h); } });

    expect(r.txHash).toBe(hashFor('po_1'));
    expect(sent).toEqual([hashFor('po_1')]);
    expect(posts(custody)).toHaveLength(1);
    expect(posts(custody)[0]!.body).toEqual({
      token: 'USDC', recipient: ADDR, amount: '1.5', chainId: 84532, purpose: 'bureau payout po_1', idempotencyKey: 'po_1',
    });
    expect(posts(custody)[0]!.auth).toBe(`Bearer ${AGENT_KEY}`);
    expect(custody.payments).toBe(1);
  });

  it('converts any number of decimals exactly (no floating point)', async () => {
    const { custody, b } = setup();
    custody.tokens = [{ symbol: 'USDC', chainId: 84532, decimals: 6, platformBroadcasts: true }];
    await b.broadcast(payout({ id: 'po_a', amountUnits: '123456789', amountUsdc: 123.456789 }));
    expect(posts(custody)[0]!.body.amount).toBe('123.456789');
    await b.broadcast(payout({ id: 'po_b', amountUnits: '1', amountUsdc: 0.000001 }));
    expect(posts(custody)[1]!.body.amount).toBe('0.000001');
  });

  it('records the hash before it waits for confirmation, so a crash leaves something to reconcile against', async () => {
    const { custody, b } = setup();
    custody.confirmAfterReads = 3;
    const order: string[] = [];
    const origFetch = custody.fetch;
    const spy = new CustodyPayoutBroadcaster(CFG, AGENT_KEY, {
      fetch: async (u, i) => { order.push(`${i.method} ${new URL(u).pathname.split('/').slice(0, 3).join('/')}`); return origFetch(u, i); }, ...clock(),
    });
    await spy.broadcast(payout(), { onSent: async () => { order.push('onSent'); } });
    expect(order.indexOf('onSent')).toBeGreaterThan(order.indexOf('POST /agent/transfers'));
    expect(order.indexOf('onSent')).toBeLessThan(order.lastIndexOf('GET /agent/transfers'));
    void b;
  });

  it('waits for the required number of confirmations, not just the first sighting', async () => {
    const { custody, b } = setup({ confirmations: 5 });
    custody.confirmations = 2;               // confirmed, but too shallow
    await expect(b.broadcast(payout())).rejects.toBeInstanceOf(PayoutPendingError);
  });

  it('leaves a sent-but-unconfirmed payment pending, carrying its hash, rather than failing it', async () => {
    const { custody, b } = setup();
    custody.confirmAfterReads = 1_000_000;
    const err = await b.broadcast(payout()).catch((e) => e);
    expect(err).toBeInstanceOf(PayoutPendingError);
    expect((err as PayoutPendingError).txHash).toBe(hashFor('po_1'));
    expect(custody.payments).toBe(1);
  });

  it('fails a payment that reverted on-chain, after recording its hash', async () => {
    const { custody, b } = setup();
    custody.finalChainState = 'reverted';
    const sent: string[] = [];
    await expect(b.broadcast(payout(), { onSent: async (h) => { sent.push(h); } })).rejects.toThrow(/reverted on-chain/);
    expect(sent).toEqual([hashFor('po_1')]);
  });

  it('asking again for the same payout returns the same payment and never pays twice', async () => {
    const { custody, b } = setup();
    const first = await b.broadcast(payout());
    const second = await b.broadcast(payout());
    expect(second.txHash).toBe(first.txHash);
    expect(custody.payments).toBe(1);
  });
});

describe('what custody may refuse', () => {
  it('passes a refusal on with custody\'s reason, and nothing is recorded as sent', async () => {
    const { custody, b } = setup();
    custody.refuseWith = 'over daily budget: R900 with R150 already spent in 24 hours exceeds R1000';
    const sent = vi.fn();
    await expect(b.broadcast(payout(), { onSent: sent })).rejects.toThrow(/Custody refused payout po_1: agent refused: over daily budget/);
    expect(sent).not.toHaveBeenCalled();
    expect(custody.payments).toBe(0);
  });

  it('says clearly when the agent key is rejected', async () => {
    const custody = new StandInCustody();
    const b = new CustodyPayoutBroadcaster(CFG, 'ofb_agent_wrong', { fetch: custody.fetch, ...clock() });
    await expect(b.broadcast(payout())).rejects.toThrow(/rejected the agent key/);
    expect(posts(custody)).toHaveLength(0);
  });

  it('refuses before asking when the token is not one the key may pay, or its decimals differ, or custody cannot broadcast', async () => {
    const a = setup(); a.custody.tokens = [];
    await expect(a.b.broadcast(payout())).rejects.toThrow(/not a token this custody agent key may pay/);
    const d = setup(); d.custody.tokens = [{ symbol: 'USDC', chainId: 84532, decimals: 18, platformBroadcasts: true }];
    await expect(d.b.broadcast(payout())).rejects.toThrow(/wrong by a power of ten/);
    const n = setup(); n.custody.tokens = [{ symbol: 'USDC', chainId: 84532, decimals: 6, platformBroadcasts: false }];
    await expect(n.b.broadcast(payout())).rejects.toThrow(/no RPC endpoint/);
    for (const s of [a, d, n]) expect(posts(s.custody)).toHaveLength(0);
  });
});

describe('our own limits, held independently of custody\'s', () => {
  it('refuses on the wrong chain, above the absolute ceiling, over the daily ceiling, with a bad address, or with no amount, without any request', async () => {
    const cases: Array<[Partial<Payout>, RegExp, number?]> = [
      [{ chain: 'base' }, /wrong chain/],
      [{ amountUsdc: PAYOUT_ABSOLUTE_MAX_USD + 1 }, /absolute ceiling/],
      [{ amountUsdc: 100 }, /daily ceiling/, 4950],
      [{ payeeAddress: '0x123' }, /valid recipient/],
      [{ amountUnits: '0' }, /no amount/],
      [{ amountUnits: 'abc' }, /unreadable amount/],
    ];
    for (const [over, pattern, spent] of cases) {
      const { custody, b } = setup();
      state.spentUsd = spent ?? 0;
      await expect(b.broadcast(payout(over))).rejects.toThrow(pattern);
      expect(custody.calls, JSON.stringify(over)).toHaveLength(0);
    }
  });
});

describe('when the answer is ambiguous', () => {
  it('a reply lost AFTER custody paid: finds the payment by its id and uses it, paying once', async () => {
    const { custody, b } = setup();
    custody.faults = ['network-after'];
    const r = await b.broadcast(payout());
    expect(r.txHash).toBe(hashFor('po_1'));
    expect(custody.payments).toBe(1);
  });

  it('a request that never reached custody: confirms there is no record and reports it unpaid', async () => {
    const { custody, b } = setup();
    custody.faults = ['network-before'];
    await expect(b.broadcast(payout())).rejects.toThrow(/was not paid: custody unreachable.*no record of the request/);
    expect(custody.payments).toBe(0);
  });

  it('a server error before processing: the same, nothing paid', async () => {
    const { custody, b } = setup();
    custody.faults = ['500-before'];
    await expect(b.broadcast(payout())).rejects.toThrow(/was not paid: custody answered 500/);
    expect(custody.payments).toBe(0);
  });

  it('a 409 because the payment is still being signed: waits for it to settle, and returns that payment', async () => {
    const { custody, b } = setup();
    custody.inFlight.set('po_1', 2);
    const r = await b.broadcast(payout());
    expect(r.txHash).toBe(hashFor('po_1'));
    expect(custody.payments).toBe(1);
    expect(posts(custody)).toHaveLength(1);             // never asked to pay a second time
  });

  it('a payment that stays in flight: fails loudly, says not to re-issue, and is not mistaken for a pending hash', async () => {
    const { custody, b } = setup();
    custody.inFlight.set('po_1', Number.POSITIVE_INFINITY);
    const err = await b.broadcast(payout()).catch((e) => e);
    expect(err).not.toBeInstanceOf(PayoutPendingError);
    expect(String(err.message)).toMatch(/unresolved.*Do not re-issue.*request id po_1/s);
    expect(custody.payments).toBe(0);
  });

  it('a request custody recorded as refused is reported unpaid with its reason', async () => {
    const { custody, b } = setup();
    custody.spends.set('po_1', { requestId: 'po_1', token: 'USDC', recipient: ADDR, amountBaseUnits: '1500000', status: 'refused', reason: 'recipient not allowed', purpose: null, txHash: null });
    custody.faults = ['500-before'];
    await expect(b.broadcast(payout())).rejects.toThrow(/recorded it as refused \(recipient not allowed\)/);
  });
});

describe('a reply that does not match the request', () => {
  const cases: Array<[string, StandInCustody['lie'], RegExp]> = [
    ['recipient', { recipient: '0x' + 'cd'.repeat(20) }, /different recipient/],
    ['amount', { amount: '999' }, /different amount/],
    ['request id', { requestId: 'po_other' }, /different request id/],
  ];
  for (const [name, lie, pattern] of cases) {
    it(`a different ${name} is recorded and then refused, with a warning not to re-issue`, async () => {
      const { custody, b } = setup();
      custody.lie = lie;
      const sent: string[] = [];
      await expect(b.broadcast(payout(), { onSent: async (h) => { sent.push(h); } })).rejects.toThrow(pattern);
      expect(sent).toEqual([hashFor('po_1')]);            // the hash is kept so the transaction can be investigated
    });
  }

  it('a success without a broadcast flag is not treated as sent', async () => {
    const { custody, b } = setup();
    custody.lie = { omitBroadcast: true };
    const sent = vi.fn();
    await expect(b.broadcast(payout(), { onSent: sent })).rejects.toThrow(/did not report a broadcast transaction/);
    expect(sent).not.toHaveBeenCalled();
  });

  it('matches the recipient regardless of case (custody stores it lower-cased)', async () => {
    const { b } = setup();
    const mixed = '0x' + 'AB'.repeat(20);
    await expect(b.broadcast(payout({ payeeAddress: mixed }))).resolves.toMatchObject({ txHash: hashFor('po_1') });
  });
});

describe('reconciling a payment that was sent earlier', () => {
  it('reports what the chain says, and never calls an unknown payment failed', async () => {
    const { custody, b } = setup();
    await b.broadcast(payout());
    const sent = payout({ txHash: hashFor('po_1') });
    expect(await b.reconcile(sent)).toBe('confirmed');
    custody.finalChainState = 'reverted'; 
    expect(await b.reconcile(sent)).toBe('failed');
    expect(await b.reconcile(payout())).toBe('pending');                                     // no hash yet
    expect(await b.reconcile(payout({ id: 'po_unknown', txHash: '0x' + '1'.repeat(64) }))).toBe('pending');   // custody does not know it
    custody.faults = [];
    const down = new CustodyPayoutBroadcaster(CFG, AGENT_KEY, { fetch: async () => { throw new Error('fetch failed'); }, ...clock() });
    expect(await down.reconcile(sent)).toBe('pending');
  });
});

describe('whether it can pay right now', () => {
  it('is ok when the key works and may pay the token', async () => {
    expect(await setup().b.canCover(payout())).toEqual({ ok: true });
  });
  it('says why not: expired key, rejected key, token not allowed, custody down', async () => {
    const e = setup(); e.custody.agent.expiresAt = '2000-01-01T00:00:00.000Z';
    expect(await e.b.canCover(payout())).toMatchObject({ ok: false, reason: expect.stringMatching(/expired/) });
    const bad = new CustodyPayoutBroadcaster(CFG, 'ofb_agent_wrong', { fetch: new StandInCustody().fetch, ...clock() });
    expect(await bad.canCover(payout())).toMatchObject({ ok: false, reason: expect.stringMatching(/rejected the agent key/) });
    const t = setup(); t.custody.tokens = [];
    expect(await t.b.canCover(payout())).toMatchObject({ ok: false, reason: expect.stringMatching(/not a token/) });
    const down = new CustodyPayoutBroadcaster(CFG, AGENT_KEY, { fetch: async () => { throw new Error('fetch failed'); }, ...clock() });
    expect(await down.canCover(payout())).toEqual({ ok: false, reason: 'custody unreachable' });
  });
});

describe('the agent key stays secret', () => {
  it('appears in no error message and no log line, across success, refusal and ambiguity', async () => {
    const messages: string[] = [];
    for (const arrange of [
      (c: StandInCustody) => { void c; },
      (c: StandInCustody) => { c.refuseWith = 'over limit'; },
      (c: StandInCustody) => { c.faults = ['500-before']; },
      (c: StandInCustody) => { c.lie = { amount: '1' }; },
    ]) {
      const { custody, b } = setup();
      arrange(custody);
      try { await b.broadcast(payout({ id: `po_${messages.length}` })); } catch (e) { messages.push(String((e as Error).message)); }
    }
    const everything = JSON.stringify([messages, state.logs]);
    expect(everything).not.toContain(AGENT_KEY);
    expect(everything).not.toContain('ofb_agent_');
  });
});

describe('the read-only readiness check', () => {
  const ready = (custody: StandInCustody, key = AGENT_KEY) => checkCustodyReadiness(CFG, key, 'USDC', { fetch: custody.fetch, ...clock() });

  it('passes for a working key and describes what it found, paying nothing', async () => {
    const custody = new StandInCustody();
    const r = await ready(custody);
    expect(r).toMatchObject({ ok: true, problems: [] });
    expect(r.info.join('\n')).toMatch(/Agent\s+: .*agent_bureau/);
    expect(r.info.join('\n')).toMatch(/USDC on base-sepolia\s*: chain 84532, 6 decimals/);
    expect(custody.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(custody.payments).toBe(0);
  });

  it('reports a rejected key, an expired or soon-expiring key, a missing token and an unreachable custody', async () => {
    expect((await ready(new StandInCustody(), 'ofb_agent_wrong')).problems.join(' ')).toMatch(/rejected the agent key/);

    const expired = new StandInCustody(); expired.agent.expiresAt = '2000-01-01T00:00:00.000Z';
    expect((await ready(expired)).problems.join(' ')).toMatch(/has expired/);

    const soon = new StandInCustody(); soon.agent.expiresAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect((await ready(soon)).problems.join(' ')).toMatch(/expires within 7 days/);

    const none = new StandInCustody(); none.tokens = [{ symbol: 'EURC', chainId: 1, decimals: 6, platformBroadcasts: true }];
    expect((await ready(none)).problems.join(' ')).toMatch(/not a token this agent key may pay in on chain 84532.*EURC@1/);

    const noRpc = new StandInCustody(); noRpc.tokens[0]!.platformBroadcasts = false;
    expect((await ready(noRpc)).problems.join(' ')).toMatch(/no RPC endpoint/);

    const down = await checkCustodyReadiness(CFG, AGENT_KEY, 'USDC', { fetch: async () => { throw new Error('fetch failed'); }, ...clock() });
    expect(down.ok).toBe(false);
    expect(down.problems.join(' ')).toMatch(/Could not reach custody/);
  });
});

describe('the recipient list policy', () => {
  const strict = () => setup({ requireRecipientList: true });

  it('is required in production unless explicitly waived, and not required elsewhere', () => {
    expect(resolveCustodyConfig(env()).requireRecipientList).toBe(true);
    expect(resolveCustodyConfig(env({ CUSTODY_ALLOW_OPEN_RECIPIENTS: 'true' })).requireRecipientList).toBe(false);
    expect(resolveCustodyConfig(env({ CUSTODY_ALLOW_OPEN_RECIPIENTS: 'yes' })).requireRecipientList).toBe(true);   // exact value only
    expect(resolveCustodyConfig(env({ NODE_ENV: 'development', CUSTODY_API_URL: 'http://localhost:3000' })).requireRecipientList).toBe(false);
  });

  it('pays when the recipient is on the key\'s list, whatever the case', async () => {
    const { custody, b } = strict();
    custody.agent.allowedRecipients = [ADDR.toLowerCase()];
    await expect(b.broadcast(payout({ payeeAddress: '0x' + 'AB'.repeat(20) }))).resolves.toMatchObject({ txHash: hashFor('po_1') });
    expect(custody.payments).toBe(1);
  });

  it('refuses an address that is not on the list WITHOUT asking, so custody\'s record of the agent stays clean', async () => {
    const { custody, b } = strict();
    custody.agent.allowedRecipients = ['0x' + 'cd'.repeat(20)];
    await expect(b.broadcast(payout())).rejects.toThrow(/not on the custody agent key's recipient list.*issue a new key/s);
    expect(posts(custody)).toHaveLength(0);
    expect(custody.spends.size).toBe(0);                     // no 'refused' row was created at custody
  });

  it('refuses a key with no list in production, and says how to waive it deliberately', async () => {
    const { custody, b } = strict();
    custody.agent.allowedRecipients = null;
    await expect(b.broadcast(payout())).rejects.toThrow(/no recipient list.*CUSTODY_ALLOW_OPEN_RECIPIENTS=true/s);
    expect(posts(custody)).toHaveLength(0);
  });

  it('accepts an open list when the policy is waived (staging, or an explicit decision)', async () => {
    const { custody, b } = setup({ requireRecipientList: false });
    custody.agent.allowedRecipients = null;
    await expect(b.broadcast(payout())).resolves.toMatchObject({ txHash: hashFor('po_1') });
  });

  it('refuses an expired key before asking, using real time', async () => {
    const { custody, b } = strict();
    custody.agent.allowedRecipients = [ADDR]; custody.agent.expiresAt = '2000-01-01T00:00:00.000Z';
    await expect(b.broadcast(payout())).rejects.toThrow(/has expired/);
    expect(posts(custody)).toHaveLength(0);
  });

  it('shows up in the readiness check: fixed list reported, open list a problem only where it is required', async () => {
    const fixed = new StandInCustody(); fixed.agent.allowedRecipients = [ADDR, '0x' + 'cd'.repeat(20)];
    const a = await checkCustodyReadiness({ ...CFG, requireRecipientList: true }, AGENT_KEY, 'USDC', { fetch: fixed.fetch, ...clock() });
    expect(a.ok).toBe(true);
    expect(a.info.join('\n')).toMatch(/Recipients\s+: fixed list of 2 addresses/);

    const open = new StandInCustody();
    const strictCheck = await checkCustodyReadiness({ ...CFG, requireRecipientList: true }, AGENT_KEY, 'USDC', { fetch: open.fetch, ...clock() });
    expect(strictCheck.ok).toBe(false);
    expect(strictCheck.problems.join(' ')).toMatch(/no recipient list/);
    expect(strictCheck.info.join('\n')).toMatch(/Recipients\s+: OPEN/);
    const lenient = await checkCustodyReadiness({ ...CFG, requireRecipientList: false }, AGENT_KEY, 'USDC', { fetch: open.fetch, ...clock() });
    expect(lenient.ok).toBe(true);
  });
});
