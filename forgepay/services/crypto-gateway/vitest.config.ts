import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    // config.ts requires these at module load time (Pool construction on
    // import) even for tests that never open a real connection. Dummy
    // values here are test-only — never used for anything but satisfying
    // that check, matching how a CI runner would inject placeholder DB
    // creds for unit tests that don't need a live Postgres.
    env: {
      POSTGRES_PASSWORD: 'test-only-placeholder',
      INTERNAL_WEBHOOK_SECRET: 'test-only-placeholder-secret-32-chars-min',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '__tests__/', 'dist/'],
    },
  },
});
