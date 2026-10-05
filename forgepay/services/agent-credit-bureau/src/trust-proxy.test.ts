import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { trustProxyHops } from './index';

async function clientIp(raw: string | undefined, xff: string): Promise<string> {
  const app = Fastify({ trustProxy: trustProxyHops(raw) });
  app.get('/ip', async (r) => r.ip);
  const res = await app.inject({ url: '/ip', headers: { 'x-forwarded-for': xff }, remoteAddress: '10.0.0.1' });
  await app.close();
  return res.body;
}

describe('TRUST_PROXY_HOPS', () => {
  it('trusts nothing by default, so a forged X-Forwarded-For is ignored', async () => {
    expect(await clientIp(undefined, '203.0.113.9')).toBe('10.0.0.1');
    expect(await clientIp('0', '203.0.113.9')).toBe('10.0.0.1');
    expect(await clientIp('abc', '203.0.113.9')).toBe('10.0.0.1');
  });

  it('with one hop, the client is the address the proxy saw', async () => {
    expect(await clientIp('1', '203.0.113.9')).toBe('203.0.113.9');
  });

  it('with one hop, extra forged entries to the left do not become the client', async () => {
    expect(await clientIp('1', '198.51.100.7, 203.0.113.9')).toBe('203.0.113.9');
  });
});
