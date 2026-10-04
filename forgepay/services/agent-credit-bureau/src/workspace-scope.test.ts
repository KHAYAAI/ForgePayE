/**
 * Console workspaces see only their own agents.
 *
 * The console reads the bureau with the admin key. Before `managedBy`, every
 * workspace's console listed every agent, every dispute and the platform's
 * own revenue figures.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';

const ADMIN = 'dev-bureau-admin-key';
const bearer = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });

function body(id: string, managedBy?: string) {
  return {
    agentId: id,
    did: `did:forge:agent_${id}`,
    operatorEntityId: `EIN-${id}`,
    operatorEntityType: 'llc',
    ...(managedBy ? { managedBy } : {}),
  };
}

describe('managedBy workspace scoping', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    for (const [id, ws] of [['ws_a1', 'ws_a'], ['ws_a2', 'ws_a'], ['ws_b1', 'ws_b']] as const) {
      const res = await app.inject({
        method: 'POST', url: `/v1/agents/${id}/profile`, headers: bearer(ADMIN), payload: body(id, ws),
      });
      expect(res.statusCode, res.body).toBeLessThan(300);
    }
  });

  it('lists only the workspace\'s agents, with a total that matches', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents?managedBy=ws_a', headers: bearer(ADMIN) });
    const json = res.json();
    expect(json.data.map((p: { agentId: string }) => p.agentId).sort()).toEqual(['ws_a1', 'ws_a2']);
    expect(json.total).toBe(2);
  });

  it('gives workspace stats without the platform\'s revenue or balances', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/bureau/stats?managedBy=ws_b', headers: bearer(ADMIN) });
    const data = res.json().data;
    expect(data.totalAgents).toBe(1);
    expect(data).not.toHaveProperty('inquiryRevenueUsd');
    expect(data).not.toHaveProperty('totalPrepaidBalanceUsd');
    expect(data).not.toHaveProperty('contributors');
  });

  it('lists no disputes for a workspace with none', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/disputes?managedBy=ws_b', headers: bearer(ADMIN) });
    expect(res.json().data).toEqual([]);
  });

  it('ignores managedBy from a non-admin caller', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/agents/ws_c1/profile', headers: bearer('ck_aave_live_xxx'), payload: body('ws_c1', 'ws_a'),
    });
    if (res.statusCode < 300) {
      const list = await app.inject({ method: 'GET', url: '/v1/agents?managedBy=ws_a', headers: bearer(ADMIN) });
      expect(list.json().data.map((p: { agentId: string }) => p.agentId)).not.toContain('ws_c1');
    } else {
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    }
  });
});
