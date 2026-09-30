import { ServiceUnavailableException } from '@nestjs/common';
import { KeysBackfillService } from './keys-backfill.service';

describe('KeysBackfillService', () => {
  let customers: string[];
  let keyed: Set<string>;
  let keys: any;
  let inFlight: number;
  let maxInFlight: number;
  let order: string[];

  const build = () => {
    const pool = { query: jest.fn().mockImplementation(() => Promise.resolve({ rows: customers.map((customer_id) => ({ customer_id })) })) };
    return new KeysBackfillService(pool as any, keys);
  };

  beforeEach(() => {
    customers = ['c1', 'c2', 'c3'];
    keyed = new Set(['c2']);
    inFlight = 0; maxInFlight = 0; order = [];
    keys = {
      thresholdEnabled: true,
      status: jest.fn().mockResolvedValue({ canSign: true }),
      activeKey: jest.fn((id: string) => Promise.resolve(keyed.has(id) ? { address: '0xexisting' } : null)),
      ensureKey: jest.fn(async (id: string) => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); order.push(id);
        await new Promise((r) => setTimeout(r, 15));
        inFlight--; keyed.add(id);
        return { address: `0x${id}` };
      }),
    };
    delete process.env.KEY_BACKFILL_ON_START;
  });

  it('creates keys for workspaces without one and reports the ones that already had one', async () => {
    expect(await build().run()).toEqual({ created: 2, already: 1, failed: [] });
    expect(order).toEqual(['c1', 'c3']);
  });

  it('is idempotent: a second run creates nothing', async () => {
    const svc = build();
    await svc.run();
    expect(await svc.run()).toEqual({ created: 0, already: 3, failed: [] });
    expect(keys.ensureKey).toHaveBeenCalledTimes(2);
  });

  it('is strictly serialized, even when runs overlap', async () => {
    const svc = build();
    const [a, b] = await Promise.all([svc.run(), svc.run()]);
    expect(maxInFlight).toBe(1);
    expect(a.created + b.created).toBe(2); // each key made exactly once
    expect(keys.ensureKey).toHaveBeenCalledTimes(2);
  });

  it('reports failures per workspace with the signer\'s reason and keeps going', async () => {
    keys.ensureKey.mockImplementation(async (id: string) => {
      if (id === 'c1') throw new ServiceUnavailableException({ error: 'Key generation failed', detail: "Could not create this workspace's signing key: only 1 of 3 signing nodes are reachable" });
      keyed.add(id); return { address: `0x${id}` };
    });
    const r = await build().run();
    expect(r.created).toBe(1);
    expect(r.already).toBe(1);
    expect(r.failed).toEqual([{ customerId: 'c1', reason: expect.stringContaining('only 1 of 3 signing nodes are reachable') }]);
  });

  it('resumes: after a failure a later run only does what is left', async () => {
    let fail = true;
    keys.ensureKey.mockImplementation(async (id: string) => {
      if (id === 'c1' && fail) throw new Error('nodes down');
      keyed.add(id); return { address: `0x${id}` };
    });
    const svc = build();
    expect((await svc.run()).failed).toHaveLength(1);
    fail = false;
    expect(await svc.run()).toEqual({ created: 1, already: 2, failed: [] });
  });

  it('does not crash the gateway at start when the signer is down; retries with backoff until it works', async () => {
    process.env.KEY_BACKFILL_FIRST_DELAY_MS = '10';
    keys.status.mockResolvedValueOnce(null).mockResolvedValueOnce({ canSign: false }).mockResolvedValue({ canSign: true });
    const svc = build();
    svc.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 400));
    expect(keys.status.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(keyed.has('c1') && keyed.has('c3')).toBe(true);
    svc.onModuleDestroy();
    delete process.env.KEY_BACKFILL_FIRST_DELAY_MS;
  });

  it('does nothing at start when threshold signing is off or the backfill is disabled', async () => {
    keys.thresholdEnabled = false;
    build().onApplicationBootstrap();
    process.env.KEY_BACKFILL_ON_START = 'false';
    keys.thresholdEnabled = true;
    build().onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 50));
    expect(keys.status).not.toHaveBeenCalled();
  });

  it('with threshold signing off, the endpoint says nothing was provisioned and why', async () => {
    keys.thresholdEnabled = false;
    const r = await build().run();
    expect(r.created).toBe(0);
    expect(r.failed).toHaveLength(3);
    expect(r.failed[0].reason).toMatch(/threshold signing is not enabled/);
  });
});
