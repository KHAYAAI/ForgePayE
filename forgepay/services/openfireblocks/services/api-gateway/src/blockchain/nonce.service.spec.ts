import { NonceService } from './nonce.service';

// The DB-backed queries are exercised end-to-end against Postgres in broadcast-e2e.js;
// here: the properties that don't need a database.
describe('NonceService', () => {
  const makePool = (queryImpl?: (sql: string, params?: unknown[]) => unknown) => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const pool = { connect: jest.fn().mockResolvedValue(client), query: jest.fn(queryImpl ?? (() => Promise.resolve({ rows: [{ next: null }] }))) };
    return { pool, client };
  };

  it('never lets two allocations for one address overlap, and always runs them in arrival order', async () => {
    const { pool } = makePool();
    const svc = new NonceService(pool as any);
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const job = (name: string, ms: number) => svc.withAddressLock('0xABC', async () => {
      active++; maxActive = Math.max(maxActive, active);
      order.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end ${name}`);
      active--;
      return name;
    });
    const results = await Promise.all([job('a', 30), job('b', 5), job('c', 5)]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('treats addresses case-insensitively but lets different addresses run in parallel', async () => {
    const { pool } = makePool();
    const svc = new NonceService(pool as any);
    let active = 0; let maxActive = 0;
    const job = (addr: string) => svc.withAddressLock(addr, async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
    });
    await Promise.all([job('0xAAA'), job('0xaaa')]);
    expect(maxActive).toBe(1);
    maxActive = 0;
    await Promise.all([job('0xAAA'), job('0xBBB')]);
    expect(maxActive).toBe(2);
  });

  it('releases the lock and the connection when the work throws, so the next caller proceeds', async () => {
    const { pool, client } = makePool();
    const svc = new NonceService(pool as any);
    await expect(svc.withAddressLock('0x1', async () => { throw new Error('signer down'); })).rejects.toThrow('signer down');
    await expect(svc.withAddressLock('0x1', async () => 'ok')).resolves.toBe('ok');
    const unlocks = client.query.mock.calls.filter((c) => String(c[0]).includes('pg_advisory_unlock'));
    expect(unlocks).toHaveLength(2);
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  it('next() = max(node pending nonce, 1 + our highest unmined nonce)', async () => {
    const { pool } = makePool(() => Promise.resolve({ rows: [{ next: 9 }] }));
    const svc = new NonceService(pool as any);
    expect(await svc.next('0xA', 1337, 4)).toBe(9); // our unmined rows are ahead of the node
    expect(await svc.next('0xA', 1337, 12)).toBe(12); // the node is ahead of our records
  });

  it('next() starts at 0 for an address with no history, and follows the node when it has some', async () => {
    const { pool } = makePool(() => Promise.resolve({ rows: [{ next: null }] }));
    const svc = new NonceService(pool as any);
    expect(await svc.next('0xA', 1337, 0)).toBe(0);
    expect(await svc.next('0xA', 1337, 3)).toBe(3);
  });

  it('with the RPC unreachable it falls back to every transaction this key signed, not just unmined ones', async () => {
    const seen: unknown[][] = [];
    const { pool } = makePool((_sql, params) => { seen.push(params as unknown[]); return Promise.resolve({ rows: [{ next: 5 }] }); });
    const svc = new NonceService(pool as any);
    expect(await svc.next('0xA', 1337, null)).toBe(5);
    expect(seen[0][2]).toEqual(expect.arrayContaining(['confirmed', 'signed'])); // statuses considered
    expect(seen[0][3]).toBe(true); // includes reverted-with-receipt rows (they consumed a nonce)
    await svc.next('0xA', 1337, 2);
    expect(seen[1][2]).not.toContain('confirmed'); // chain already counts mined ones
    expect(seen[1][3]).toBe(false);
  });

  it('committedWei sums value + max fee of unmined transfers only', async () => {
    const { pool } = makePool(() => Promise.resolve({ rows: [{ total: '25000630000000000000' }] }));
    const svc = new NonceService(pool as any);
    expect(await svc.committedWei('0xA', 1337, 0)).toBe(25000630000000000000n);
  });
});
