module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(test|spec)\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { esModuleInterop: true } }],
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // The default run is fast, hermetic unit/correctness/security tests.
  // e2e (needs a live DB + HTTP server) and integration (needs a testnet) are
  // opt-in via their own scripts.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/test/e2e/',
    '\\.integration\\.test\\.ts$',
  ],
};
