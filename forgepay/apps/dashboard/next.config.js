/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3001', 'dashboard.forgepay.io'] },
  },
};
module.exports = nextConfig;
