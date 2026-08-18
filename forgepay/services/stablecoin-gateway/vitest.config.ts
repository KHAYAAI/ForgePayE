import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // tests/shielded.test.ts lived outside this glob since the day it was
    // added (see git history) — it has never actually run under `npm test`.
    include: ['__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '__tests__/', 'tests/', 'dist/'],
    },
  },
});
