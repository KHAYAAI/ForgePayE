import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    globals: false,
    // Each test file gets its own module registry so vi.resetModules()
    // correctly isolates the in-memory store state between tests.
    isolate: true,
  },
});
