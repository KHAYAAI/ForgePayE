import { installSignerAuth, signerHttpsAgent } from './signer-auth';
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

  it('production refuses to talk to the signer without mutual TLS or over plain http', () => {
    expect(() => signerHttpsAgent({ NODE_ENV: 'production', MPC_SIGNER_URL: 'https://signer:8080' } as NodeJS.ProcessEnv)).toThrow(/mutual TLS/);
    expect(() => signerHttpsAgent({ NODE_ENV: 'production', MPC_SIGNER_URL: 'http://signer:8080', MPC_SIGNER_CLIENT_CERT_FILE: 'a', MPC_SIGNER_CLIENT_KEY_FILE: 'b', MPC_SIGNER_CA_FILE: 'c' } as NodeJS.ProcessEnv)).toThrow(/https/);
    expect(signerHttpsAgent({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
