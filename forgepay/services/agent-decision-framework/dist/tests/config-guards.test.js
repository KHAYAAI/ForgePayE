"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Production fail-closed guard for CORS. Mirrors the convention established
 * in agent-credit-bureau/src/config-guards.test.ts — missing/unsafe
 * production config throws at startup rather than degrading silently.
 */
const vitest_1 = require("vitest");
const index_1 = require("../index");
const ORIGINAL_ENV = { ...process.env };
function resetEnv() {
    process.env = { ...ORIGINAL_ENV };
    delete process.env['CORS_ORIGIN'];
}
(0, vitest_1.describe)('resolveCorsOrigin', () => {
    (0, vitest_1.beforeEach)(resetEnv);
    (0, vitest_1.afterEach)(() => { process.env = { ...ORIGINAL_ENV }; });
    (0, vitest_1.it)('defaults to * outside production', () => {
        process.env['NODE_ENV'] = 'development';
        (0, vitest_1.expect)((0, index_1.resolveCorsOrigin)()).toBe('*');
    });
    (0, vitest_1.it)('throws in production when CORS_ORIGIN is unset', () => {
        process.env['NODE_ENV'] = 'production';
        (0, vitest_1.expect)(() => (0, index_1.resolveCorsOrigin)()).toThrow(/refuses to start/);
    });
    (0, vitest_1.it)('throws in production when CORS_ORIGIN is still *', () => {
        process.env['NODE_ENV'] = 'production';
        process.env['CORS_ORIGIN'] = '*';
        (0, vitest_1.expect)(() => (0, index_1.resolveCorsOrigin)()).toThrow(/refuses to start/);
    });
    (0, vitest_1.it)('accepts a single explicit origin in production', () => {
        process.env['NODE_ENV'] = 'production';
        process.env['CORS_ORIGIN'] = 'https://dashboard.myforgepay.com';
        (0, vitest_1.expect)((0, index_1.resolveCorsOrigin)()).toBe('https://dashboard.myforgepay.com');
    });
    (0, vitest_1.it)('splits a comma-separated allowlist into an array', () => {
        process.env['NODE_ENV'] = 'production';
        process.env['CORS_ORIGIN'] = 'https://dashboard.myforgepay.com, https://app.myforgepay.com';
        (0, vitest_1.expect)((0, index_1.resolveCorsOrigin)()).toEqual(['https://dashboard.myforgepay.com', 'https://app.myforgepay.com']);
    });
});
//# sourceMappingURL=config-guards.test.js.map