import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run in Node.js — Node 18+ exposes globalThis.crypto (Web Crypto API)
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
