/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [],
  },
  // Enable standalone output for Docker / Kubernetes deployments
  output: 'standalone',
};

module.exports = nextConfig;
