/**
 * Resolve the CORS origin allowlist.
 *
 * `CORS_ORIGIN` defaults to `*` for local/demo use. That default reaching
 * production would let any website's browser JS read every response this
 * service returns. Comma-separated origins are supported so a real
 * deployment can list every trusted caller (dashboard, mobile web, ...)
 * rather than being forced back to `*` for lack of a multi-origin option.
 *
 * Kept in its own module (rather than inline in index.ts) because index.ts
 * boots the server as a top-level side effect on import — a unit test needs
 * to reach this function without starting a real Fastify server.
 *
 * @throws in production when CORS_ORIGIN is unset or still `*`.
 */
export function resolveCorsOrigin(): string | string[] {
  const raw = process.env['CORS_ORIGIN'];
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (isProduction && (!raw || raw === '*')) {
    throw new Error(
      'CORS_ORIGIN is not set (or is "*") in production. Institutional Reporting refuses to ' +
      'start without an explicit origin allowlist — set it to a comma-separated list of ' +
      'trusted origins, e.g. CORS_ORIGIN=https://dashboard.forgepay.io,https://app.forgepay.io',
    );
  }

  if (!raw) return '*';
  const origins = raw.split(',').map((o) => o.trim()).filter(Boolean);
  return origins.length === 1 ? origins[0]! : origins;
}
