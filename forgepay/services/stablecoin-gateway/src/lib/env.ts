/**
 * Which mode the gateway is in. Fails closed: anything except an explicit "development" or "test" is
 * production. A deployment that forgets to set NODE_ENV must get the strict behaviour (real admin keys
 * only, no dev encryption key, no permissive CORS), never the loose one.
 */
export function isProductionLike(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env['NODE_ENV'] ?? '').trim().toLowerCase();
  return v !== 'development' && v !== 'test';
}
