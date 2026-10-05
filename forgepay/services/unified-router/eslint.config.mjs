// Flat config. `npm run lint` existed with no eslint installed and no config,
// so the CI lint step failed with "command not found" on every run.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The codebase uses `any` at a few integration seams (Fastify request
      // decorations, provider payloads); flagged, not failed.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
