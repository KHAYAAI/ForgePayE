module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.js'],
  rules: {
    // The codebase intentionally uses `any` at framework boundaries
    // (request objects, JSON-RPC payloads). Keep these as guidance, not errors.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-empty-function': 'off',
    'no-empty': 'off',
    'no-console': 'off',
    // case blocks use `const` guarded by `break`; scoping is not a real hazard here
    'no-case-declarations': 'off',
  },
};
