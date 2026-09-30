import { TxPollerService } from './tx-poller.service';

describe('TxPollerService', () => {
  const HASH = '0x' + 'ab'.repeat(32);
  let updates: Array<{ sql: string; params: unknown[] }>;
  let rows: any[];
  let eth: any;
  let audit: { logEvent: jest.Mock };

  const build = () => {
    const client = {
      query: jest.fn((sql: string) => Promise.resolve(sql.includes('pg_try_advisory_lock') ? { rows: [{ locked: true }] } : { rows: [] })),
      release: jest.fn(),
    };
    const pool = {
      connect: jest.fn().mockResolvedValue(client),
      query: jest.fn((sql: string, params: unknown[] = []) => {
        if (sql.includes("status = 'broadcasting'")) return Promise.resolve({ rows: [], rowCount: 0 });
        if (sql.trim().startsWith('SELECT')) return Promise.resolve({ rows });
        updates.push({ sql, params });
        return Promise.resolve({ rowCount: 1, rows: [] });
      }),
    };
    return { svc: new TxPollerService(pool as any, eth, audit as any), pool, client };
  };
  const row = (over: Record<string, unknown> = {}) => ({
    request_id: 'req-1', customer_id: 'demo', tx_hash: HASH, nonce: 0, status: 'broadcasted',
    broadcast_at: new Date(), updated_at: new Date(), ...over,
  });
  const receipt = (over: Record<string, unknown> = {}) => ({
    blockNumber: 10, blockHash: '0xbh', status: 1, from: '0xF', to: '0xT', gasUsed: 21000n, gasPrice: 1n, ...over,
  });

  beforeEach(() => {
    updates = [];
    rows = [row()];
    audit = { logEvent: jest.fn().mockResolvedValue(1) };
    eth = {
      canBroadcast: true,
      getChainId: jest.fn().mockResolvedValue(1337),
      getBlockNumber: jest.fn().mockResolvedValue(10),
      getTransactionReceipt: jest.fn().mockResolvedValue(receipt()),
      getTransaction: jest.fn().mockResolvedValue(null),
    };
    delete process.env.TX_CONFIRMATIONS;
    delete process.env.TX_STUCK_AFTER_MS;
  });

  it('confirms a mined, successful transaction with its block number and confirmations', async () => {
    const { svc } = build();
    expect(await svc.pollOnce()).toEqual({ checked: 1, changed: 1 });
    const u = updates[0];
    expect(u.params.slice(0, 5)).toEqual(['req-1', 'confirmed', null, 10, 1]);
    expect(JSON.parse(u.params[5] as string)).toMatchObject({ blockNumber: 10, status: 1, gasUsed: '21000' });
    expect(audit.logEvent.mock.calls[0][0]).toMatchObject({ type: 'TX_CONFIRMED', requestId: 'req-1', status: 'confirmed' });
  });

  it('waits for the configured confirmation depth before confirming', async () => {
    process.env.TX_CONFIRMATIONS = '3';
    const { svc } = build();
    await svc.pollOnce();
    expect(updates.every((u) => !u.params.includes('confirmed'))).toBe(true);
    expect(updates[0].params).toEqual(['req-1', 10, 1]); // just records the count so far
    eth.getBlockNumber.mockResolvedValue(12);
    updates = [];
    await svc.pollOnce();
    expect(updates[0].params.slice(0, 5)).toEqual(['req-1', 'confirmed', null, 10, 3]);
  });

  it('marks a reverted transaction failed with the reason and block', async () => {
    eth.getTransactionReceipt.mockResolvedValue(receipt({ status: 0 }));
    await build().svc.pollOnce();
    expect(updates[0].params.slice(0, 4)).toEqual(['req-1', 'failed', 'reverted on-chain in block 10', 10]);
  });

  it('leaves a young transaction with no receipt alone', async () => {
    eth.getTransactionReceipt.mockResolvedValue(null);
    expect(await build().svc.pollOnce()).toEqual({ checked: 1, changed: 0 });
    expect(updates).toHaveLength(0);
  });

  it('marks a transaction with no receipt after the timeout as stuck (never replaced) and says why', async () => {
    process.env.TX_STUCK_AFTER_MS = '1000';
    rows = [row({ broadcast_at: new Date(Date.now() - 5 * 60 * 1000) })];
    eth.getTransactionReceipt.mockResolvedValue(null);
    await build().svc.pollOnce();
    expect(updates[0].params[1]).toBe('stuck');
    expect(updates[0].params[2]).toMatch(/no longer has it .*dropped.*not replaced automatically/);
    eth.getTransaction.mockResolvedValue({ hash: HASH });
    updates = [];
    await build().svc.pollOnce();
    expect(updates[0].params[2]).toMatch(/still holds it as pending/);
  });

  it('a stuck transaction that is later mined still becomes confirmed', async () => {
    rows = [row({ status: 'stuck' })];
    await build().svc.pollOnce();
    expect(updates[0].params.slice(0, 2)).toEqual(['req-1', 'confirmed']);
  });

  it('reconciles a signed_not_broadcast row the network turns out to have (ambiguous RPC timeout)', async () => {
    rows = [row({ status: 'signed_not_broadcast' })];
    await build().svc.pollOnce();
    expect(updates[0].params.slice(0, 2)).toEqual(['req-1', 'confirmed']);
    expect(updates[0].sql).toContain("'signed_not_broadcast'");
  });

  it('leaves a signed_not_broadcast row alone when the network has no receipt (it waits for Rebroadcast, never "stuck")', async () => {
    process.env.TX_STUCK_AFTER_MS = '1';
    rows = [row({ status: 'signed_not_broadcast', broadcast_at: null, updated_at: new Date(Date.now() - 3600_000) })];
    eth.getTransactionReceipt.mockResolvedValue(null);
    expect(await build().svc.pollOnce()).toEqual({ checked: 1, changed: 0 });
    expect(updates).toHaveLength(0);
  });

  it('keeps going through many rows when one lookup throws', async () => {
    rows = [row({ request_id: 'a', tx_hash: '0x01' }), row({ request_id: 'b', tx_hash: '0x02' }), row({ request_id: 'c', tx_hash: '0x03' })];
    eth.getTransactionReceipt.mockImplementation((h: string) => (h === '0x02' ? Promise.reject(new Error('rpc hiccup')) : Promise.resolve(receipt())));
    expect(await build().svc.pollOnce()).toEqual({ checked: 3, changed: 2 });
    expect(updates.map((u) => u.params[0])).toEqual(['a', 'c']);
  });

  it('is idempotent: the update is conditional on the row still being unsettled', async () => {
    await build().svc.pollOnce();
    expect(updates[0].sql).toMatch(/WHERE request_id = \$1 AND status IN \('broadcasted', 'stuck', 'signed_not_broadcast'\)/);
  });

  it('does nothing (and does not crash) when the RPC is down', async () => {
    eth.getChainId.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await build().svc.pollOnce()).toEqual({ checked: 0, changed: 0 });
    expect(updates).toHaveLength(0);
  });

  it('skips a cycle when another gateway holds the poller lock', async () => {
    const { svc, client } = build();
    client.query.mockImplementation((sql: string) => Promise.resolve(sql.includes('pg_try_advisory_lock') ? { rows: [{ locked: false }] } : { rows: [] }));
    expect(await svc.pollOnce()).toEqual({ checked: 0, changed: 0 });
    expect(eth.getChainId).not.toHaveBeenCalled();
  });

  it('only looks at rows for the network it is connected to', async () => {
    const { pool, svc } = build();
    await svc.pollOnce();
    const select = pool.query.mock.calls.find((c) => String(c[0]).trim().startsWith('SELECT'))!;
    expect(select[0]).toContain('chain_id = $1');
    expect(select[1]).toEqual([1337]);
  });
});
