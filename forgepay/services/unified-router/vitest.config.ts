import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: false,
    // config.ts's required() throws at import time if these are unset —
    // fine in production (fail closed on a real deploy), but checkout.test.ts
    // pulls in config.ts transitively via routes/checkout.ts -> lib/pricing.ts
    // even though it never touches Postgres or a real webhook. Test-only
    // placeholders, applied before any test file or its imports load.
    env: {
      POSTGRES_PASSWORD: 'test-only-not-a-real-secret',
      INTERNAL_WEBHOOK_SECRET: 'test-only-not-a-real-secret',
      HYPERSWITCH_WEBHOOK_SECRET: 'test-only-not-a-real-secret',
      KILLBILL_WEBHOOK_SECRET: 'test-only-not-a-real-secret',
      STABLECOIN_GW_WEBHOOK_SECRET: 'test-only-not-a-real-secret',
      CRYPTO_GW_WEBHOOK_SECRET: 'test-only-not-a-real-secret',
    },
  },
});
