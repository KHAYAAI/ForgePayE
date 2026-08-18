/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  // No `env` block here on purpose. Next.js inlines every key listed under
  // `env` into the CLIENT bundle at build time — it is the same mechanism as
  // the NEXT_PUBLIC_ prefix, just less visible about it. DATABASE_URL and
  // JWT_SECRET (plus the SMTP credentials) used to be listed here, which
  // meant a full Postgres connection string and the console's JWT signing
  // secret were candidates for shipping to every browser that loaded the
  // app. All of these (lib/db.ts, lib/jwt-secret.ts, lib/email.ts) are
  // server-only and already read process.env directly at runtime — Next.js
  // exposes non-prefixed env vars to server code without this block. If a
  // value genuinely needs to reach the browser, prefix it
  // NEXT_PUBLIC_<NAME> at the call site instead, so the exposure is
  // explicit in the variable name itself.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
