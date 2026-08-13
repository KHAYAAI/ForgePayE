import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkAgentIdentity, type AgentIdentityRecord } from './identity';

function mockFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async (_url: string) => ({ ok, status, json: async () => body }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function mockFetchThrow(err: Error = new Error('connect ECONNREFUSED')): void {
  vi.stubGlobal('fetch', vi.fn(async () => { throw err; }));
}

function record(overrides: Partial<AgentIdentityRecord> = {}): AgentIdentityRecord {
  return { id: 'agent_x', did: 'did:forge:agent_x', status: 'active', ...overrides };
}

const ORIGINAL_ENV = { ...process.env };

describe('identity.ts — agent-identity integration', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env['NODE_ENV'] = 'test';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('skips the call for an address-form DID — nothing to look up', async () => {
    const fetchFn = mockFetch({});
    const out = await checkAgentIdentity('did:forge:0x' + 'ab'.repeat(20));
    expect(out).toEqual({ checked: false, reason: 'not_registry_form' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects an unparseable DID without calling out', async () => {
    const fetchFn = mockFetch({});
    const out = await checkAgentIdentity('not-a-did');
    expect(out).toEqual({ checked: false, reason: 'not_registry_form' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('GETs the registry for a registry-form DID', async () => {
    const fetchFn = mockFetch({ data: record() });
    const out = await checkAgentIdentity('did:forge:agent_x');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://localhost:3010/v1/agents/agent_x');
    expect(out).toEqual({ checked: true, found: true, active: true, record: record() });
  });

  it('reports found-but-inactive distinctly from not-found', async () => {
    mockFetch({ data: record({ status: 'suspended' }) });
    const out = await checkAgentIdentity('did:forge:agent_x');
    expect(out).toEqual({ checked: true, found: true, active: false, record: record({ status: 'suspended' }) });
  });

  it('reports not-found for a 404', async () => {
    mockFetch({}, false, 404);
    const out = await checkAgentIdentity('did:forge:agent_x');
    expect(out).toEqual({ checked: true, found: false });
  });

  it('reports call_failed on a non-404 error status', async () => {
    mockFetch({}, false, 500);
    const out = await checkAgentIdentity('did:forge:agent_x');
    expect(out).toEqual({ checked: false, reason: 'call_failed' });
  });

  it('reports call_failed when the service is unreachable', async () => {
    mockFetchThrow();
    const out = await checkAgentIdentity('did:forge:agent_x');
    expect(out).toEqual({ checked: false, reason: 'call_failed' });
  });

  it('respects AGENT_IDENTITY_URL when set', async () => {
    process.env['AGENT_IDENTITY_URL'] = 'http://agent-identity:3010/';
    const fetchFn = mockFetch({ data: record() });
    await checkAgentIdentity('did:forge:agent_x');
    const [url] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://agent-identity:3010/v1/agents/agent_x');
  });
});
