import { installSignerAuth } from './signer-auth';
import axios from 'axios';

describe('signer auth interceptor', () => {
  const env = { MPC_SIGNER_URL: 'http://signer:8080', MPC_SIGNER_AUTH_TOKEN: 't'.repeat(40) } as NodeJS.ProcessEnv;
  const run = async (url: string) => {
    const inst = axios.create();
    installSignerAuth({ axiosRef: inst } as any, env);
    let seen: string | undefined;
    await inst.get(url, { adapter: async (cfg) => { seen = cfg.headers.get('Authorization') as string | undefined; return { data: {}, status: 200, statusText: 'OK', headers: {}, config: cfg }; } });
    return seen;
  };
  it('sends the token to the signer', async () => { expect(await run('http://signer:8080/sign')).toBe(`Bearer ${'t'.repeat(40)}`); });
  it('never sends it anywhere else', async () => {
    expect(await run('http://other:8080/sign')).toBeUndefined();
    expect(await run('http://signer:8080.evil.example/sign')).toBeUndefined();
  });
});
