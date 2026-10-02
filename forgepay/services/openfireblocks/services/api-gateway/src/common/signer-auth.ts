import type { HttpService } from '@nestjs/axios';

/**
 * The signer's coordinator API moves money, so it requires a bearer token (MPC_SIGNER_AUTH_TOKEN).
 * This adds it to requests that go to MPC_SIGNER_URL, and only those: the token must not follow a
 * request to any other host.
 */
export function signerBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.MPC_SIGNER_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
}

const installed = new WeakSet<object>();

export function installSignerAuth(http: HttpService, env: NodeJS.ProcessEnv = process.env): void {
  const ref = http?.axiosRef;
  if (!ref?.interceptors || installed.has(ref)) return; // nothing to attach to (e.g. a test double)
  installed.add(ref);
  ref.interceptors.request.use((cfg) => {
    const token = env.MPC_SIGNER_AUTH_TOKEN;
    const base = signerBaseUrl(env);
    const url = String(cfg.url ?? '');
    if (token && (url === base || url.startsWith(base + '/'))) {
      cfg.headers.set('Authorization', `Bearer ${token}`);
    }
    return cfg;
  });
}
