import type { HttpService } from '@nestjs/axios';
import { readFileSync } from 'fs';
import { Agent } from 'https';

/**
 * The signer's coordinator API moves money, so it requires a bearer token (MPC_SIGNER_AUTH_TOKEN).
 * This adds it to requests that go to MPC_SIGNER_URL, and only those: the token must not follow a
 * request to any other host.
 */
export function signerBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.MPC_SIGNER_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
}

/**
 * Mutual TLS to the signer: when MPC_SIGNER_CLIENT_CERT_FILE, MPC_SIGNER_CLIENT_KEY_FILE and MPC_SIGNER_CA_FILE
 * are set, requests to an https signer present the gateway's certificate (its common name must be "gateway")
 * and trust only that CA. Returns undefined when not configured.
 */
export function signerHttpsAgent(env: NodeJS.ProcessEnv = process.env): Agent | undefined {
  const cert = env.MPC_SIGNER_CLIENT_CERT_FILE, key = env.MPC_SIGNER_CLIENT_KEY_FILE, ca = env.MPC_SIGNER_CA_FILE;
  if (!cert && !key && !ca) return undefined;
  if (!cert || !key || !ca) throw new Error('set all of MPC_SIGNER_CLIENT_CERT_FILE, MPC_SIGNER_CLIENT_KEY_FILE and MPC_SIGNER_CA_FILE, or none');
  return new Agent({ cert: readFileSync(cert), key: readFileSync(key), ca: readFileSync(ca), minVersion: 'TLSv1.3' });
}

const installed = new WeakSet<object>();

export function installSignerAuth(http: HttpService, env: NodeJS.ProcessEnv = process.env): void {
  const ref = http?.axiosRef;
  if (!ref?.interceptors || installed.has(ref)) return; // nothing to attach to (e.g. a test double)
  installed.add(ref);
  const agent = signerHttpsAgent(env);
  ref.interceptors.request.use((cfg) => {
    const token = env.MPC_SIGNER_AUTH_TOKEN;
    const base = signerBaseUrl(env);
    const url = String(cfg.url ?? '');
    const toSigner = url === base || url.startsWith(base + '/');
    if (token && toSigner) cfg.headers.set('Authorization', `Bearer ${token}`);
    if (toSigner && agent && base.startsWith('https://')) cfg.httpsAgent = agent;
    return cfg;
  });
}
