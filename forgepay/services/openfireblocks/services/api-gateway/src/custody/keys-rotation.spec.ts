import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { KeysService } from './keys.service';

describe('KeysService rotation', () => {
  let queries: Array<{ sql: string; params: unknown[] }>;
  let key: any;
  let http: { get: jest.Mock; post: jest.Mock };

  const build = () => {
    const client = {
      query: jest.fn((sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (/FROM custody.keys WHERE customer_id = \$1 AND status = 'active'/.test(sql)) return Promise.resolve({ rows: key ? [key] : [] });
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    const pool = { query: client.query, connect: jest.fn().mockResolvedValue(client) };
    return new KeysService(pool as any, http as any);
  };

  beforeEach(() => {
    queries = [];
    key = { key_id: 'key-1', customer_id: 'c1', address: '0xAAA', threshold: 1, nodes: ['node1', 'node2', 'node3'], epoch: 0 };
    http = {
      get: jest.fn().mockReturnValue(of({ data: { enabled: true, nodes: [{ id: 'node1' }, { id: 'node2' }, { id: 'node3' }, { id: 'node4' }] } })),
      post: jest.fn(),
    };
  });

  describe('validateRotation', () => {
    it('accepts a committee of known nodes and converts "signers needed" to the signer\'s threshold', async () => {
      expect(await build().validateRotation(['node1', 'node2', 'node4'], 2)).toEqual({ nodes: ['node1', 'node2', 'node4'], threshold: 1 });
      expect(await build().validateRotation(['node1', 'node2', 'node3', 'node4'], 3)).toEqual({ nodes: ['node1', 'node2', 'node3', 'node4'], threshold: 2 });
    });

    it.each([
      ['not a list', 'node1', 2],
      ['a duplicate node', ['node1', 'node1', 'node2'], 2],
      ['one signer needed', ['node1', 'node2', 'node3'], 1],
      ['more signers than nodes', ['node1', 'node2'], 3],
      ['a fractional count', ['node1', 'node2', 'node3'], 2.5],
      ['an unknown node', ['node1', 'node2', 'nodeX'], 2],
    ])('refuses %s', async (_name, nodes, needed) => {
      await expect(build().validateRotation(nodes, needed)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cannot be checked without the signer', async () => {
      http.get.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));
      await expect(build().validateRotation(['node1', 'node2', 'node3'], 2)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('rotate', () => {
    const signerAnswer = { data: { result: { keyId: 'key-1', address: '0xAAA', fromEpoch: 0, toEpoch: 1, newNodes: ['node2', 'node3', 'node4'], threshold: 1, retired: ['node1'] }, steps: [] } };

    it('reshares through the signer and records the new committee and epoch, holding the key lock throughout', async () => {
      http.post.mockReturnValue(of(signerAnswer));
      const r = await build().rotate('c1', ['node2', 'node3', 'node4'], 1);
      expect(r.toEpoch).toBe(1);
      expect(http.post.mock.calls[0][0]).toMatch(/\/mpc\/keys\/key-1\/reshare$/);
      expect(http.post.mock.calls[0][1]).toEqual({ nodes: ['node2', 'node3', 'node4'], threshold: 1 });
      const update = queries.find((q) => /UPDATE custody.keys/.test(q.sql))!;
      expect(update.params).toEqual(['key-1', ['node2', 'node3', 'node4'], 1, 1]);
      const order = queries.map((q) => (/pg_advisory_lock/.test(q.sql) ? 'lock' : /pg_advisory_unlock/.test(q.sql) ? 'unlock' : /UPDATE/.test(q.sql) ? 'update' : 'other'));
      expect(order.filter((o) => o !== 'other')).toEqual(['lock', 'update', 'unlock']);
    });

    it('leaves the record alone and says why when the signer could not do it', async () => {
      http.post.mockReturnValue(throwError(() => ({ response: { data: { error: 'new committee member node4 is not reachable' } } })));
      await expect(build().rotate('c1', ['node2', 'node3', 'node4'], 1)).rejects.toMatchObject({
        response: { detail: expect.stringContaining('The key was not changed: new committee member node4 is not reachable') },
      });
      expect(queries.some((q) => /UPDATE custody.keys/.test(q.sql))).toBe(false);
      expect(queries.some((q) => /pg_advisory_unlock/.test(q.sql))).toBe(true); // lock released even on failure
    });

    it('refuses a workspace with no key', async () => {
      key = null;
      await expect(build().rotate('c1', ['node1', 'node2'], 1)).rejects.toBeInstanceOf(NotFoundException);
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe('fleet rotation', () => {
    it('rotates each workspace once, skips those already on the committee, and reports failures by workspace', async () => {
      const rows = [
        { customer_id: 'a', threshold: 1, nodes: ['node1', 'node2', 'node3'] },
        { customer_id: 'b', threshold: 1, nodes: ['node2', 'node3', 'node4'] }, // already there
        { customer_id: 'c', threshold: 1, nodes: ['node1', 'node2', 'node3'] },
      ];
      const svc = build();
      (svc as any).pool = { query: jest.fn().mockResolvedValue({ rows }) };
      const rotate = jest.spyOn(svc, 'rotate').mockImplementation(async (id: string) => {
        if (id === 'c') throw new Error('node4 is not reachable');
        return {} as any;
      });
      const job = svc.startFleetRotation(['node2', 'node3', 'node4'], 1);
      expect(() => svc.startFleetRotation(['node2', 'node3', 'node4'], 1)).toThrow(BadRequestException); // one at a time
      await new Promise((r) => setTimeout(r, 30));
      expect(job.state).toBe('done');
      expect(rotate.mock.calls.map((c) => c[0])).toEqual(['a', 'c']);
      expect(job).toMatchObject({ total: 3, rotated: 1, skipped: 1, failed: [{ customerId: 'c', reason: 'node4 is not reachable' }] });
    });
  });
});
