"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Policies, per-agent limits, spend windows and the decision log survive a restart.
 * Unit tests cover the write-through hooks and hydration; the database test (skipped without DATABASE_URL, run in CI against
 * Postgres) restarts for real.
 */
const vitest_1 = require("vitest");
const policies_1 = require("../policies");
const velocity_1 = require("../velocity");
const decision_log_1 = require("../decision-log");
const persistence_1 = require("../persistence");
(0, vitest_1.afterEach)(() => {
    (0, policies_1.setPolicySink)(null);
    (0, velocity_1.setVelocitySink)(null);
    (0, decision_log_1.setDecisionSink)(null);
    (0, policies_1.resetPolicies)();
    (0, velocity_1.clearVelocity)();
    (0, decision_log_1.clearDecisionLog)();
});
const decision = (agentId = 'a1') => ({
    decision: 'approve', score: 10, reasons: [], policy_violations: [], timestamp: new Date().toISOString(), agentId,
    actionType: 'payment', amountUsd: 100, asset: 'USDC', riskScore: { total: 10, components: {} },
});
(0, vitest_1.describe)('write-through hooks', () => {
    (0, vitest_1.it)('policy changes reach the sink: add, update, delete, and per-agent overrides', () => {
        const calls = [];
        (0, policies_1.setPolicySink)({
            upsertPolicy: (p) => calls.push(`upsert:${p.id}`),
            removePolicy: (id) => calls.push(`remove:${id}`),
            upsertAgentPolicy: (p) => calls.push(`agent:${p.agentId}`),
        });
        (0, policies_1.addPolicy)({ id: 'px', name: 'X', type: 'block_high_amount', params: { maxAmountUsd: 10 }, enabled: true });
        (0, policies_1.updatePolicy)('px', { enabled: false });
        (0, vitest_1.expect)((0, policies_1.deletePolicy)('px')).toBe(true);
        (0, vitest_1.expect)((0, policies_1.deletePolicy)('px')).toBe(false); // nothing to remove: no second write
        (0, policies_1.setAgentPolicy)('agent_1', { dailyLimitUsd: 5 });
        (0, vitest_1.expect)(calls).toEqual(['upsert:px', 'upsert:px', 'remove:px', 'agent:agent_1']);
    });
    (0, vitest_1.it)('every recorded spend and decision reaches its sink', () => {
        const spend = [];
        const decisions = [];
        (0, velocity_1.setVelocitySink)({ record: (agentId, _ts, amount) => spend.push([agentId, amount]) });
        (0, decision_log_1.setDecisionSink)({ record: (d) => decisions.push(d.agentId) });
        (0, velocity_1.recordTransaction)('a1', 25);
        (0, decision_log_1.recordDecision)(decision('a1'));
        (0, vitest_1.expect)(spend).toEqual([['a1', 25]]);
        (0, vitest_1.expect)(decisions).toEqual(['a1']);
    });
});
(0, vitest_1.describe)('hydration after a restart', () => {
    (0, vitest_1.it)('restores each agent\'s rolling spend, so a restart does not reset a velocity limit', () => {
        const now = Date.now();
        (0, velocity_1.hydrateVelocity)([
            { agentId: 'a1', timestamp: now - 30 * 60_000, amountUsd: 400 },
            { agentId: 'a1', timestamp: now - 3 * 3_600_000, amountUsd: 100 },
            { agentId: 'a2', timestamp: now - 10 * 60_000, amountUsd: 7 },
        ]);
        const v = (0, velocity_1.getVelocity)('a1', now);
        (0, vitest_1.expect)(v.last1hUsd).toBe(400);
        (0, vitest_1.expect)(v.last24hUsd).toBe(500);
        (0, vitest_1.expect)(v.txCount24h).toBe(2);
        (0, vitest_1.expect)((0, velocity_1.getVelocity)('a2', now).last1hUsd).toBe(7);
    });
    (0, vitest_1.it)('restores policies and overrides exactly, including an operator having deleted every policy', () => {
        (0, policies_1.hydratePolicies)([{ id: 'only', name: 'Only', type: 'block_high_amount', params: { maxAmountUsd: 1 }, enabled: true }], [{ agentId: 'a1', riskTolerance: 10, dailyLimitUsd: 99, blockedCounterparties: ['bad'], requiredApprovalThresholdUsd: 5 }]);
        (0, vitest_1.expect)((0, policies_1.listPolicies)().map((p) => p.id)).toEqual(['only']);
        (0, vitest_1.expect)((0, policies_1.getAgentPolicy)('a1').dailyLimitUsd).toBe(99);
        (0, policies_1.hydratePolicies)([], []);
        (0, vitest_1.expect)((0, policies_1.listPolicies)()).toEqual([]); // stored emptiness is respected, defaults are not re-added
    });
    (0, vitest_1.it)('restores the decision log in order, newest last, capped', () => {
        (0, decision_log_1.hydrateDecisions)([decision('a'), decision('b'), decision('c')]);
        (0, vitest_1.expect)((0, decision_log_1.getDecisionHistory)(10).map((d) => d.agentId)).toEqual(['c', 'b', 'a']);
    });
    (0, vitest_1.it)('exposes the default policies as copies, so editing one cannot change the defaults', () => {
        const d = (0, policies_1.listDefaultPolicies)();
        d[0].params['minReputation'] = 999;
        (0, vitest_1.expect)((0, policies_1.listDefaultPolicies)()[0].params['minReputation']).not.toBe(999);
    });
});
(0, vitest_1.describe)('configuration guard', () => {
    (0, vitest_1.it)('refuses to start in production without a database', () => {
        (0, vitest_1.expect)(() => (0, persistence_1.assertPersistenceConfigured)({ NODE_ENV: 'production' })).toThrow(/refuses to start/);
        (0, vitest_1.expect)(() => (0, persistence_1.assertPersistenceConfigured)({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })).not.toThrow();
        (0, vitest_1.expect)(() => (0, persistence_1.assertPersistenceConfigured)({ NODE_ENV: 'development' })).not.toThrow();
        (0, vitest_1.expect)((0, persistence_1.isDbEnabled)({ DB_HOST: 'h' })).toBe(true);
    });
});
const HAS_DB = Boolean(process.env['DATABASE_URL'] || process.env['DB_HOST']);
const dbSuite = HAS_DB ? vitest_1.describe : vitest_1.describe.skip;
dbSuite('against a real database', () => {
    let persistence;
    const wait = () => new Promise((r) => setTimeout(r, 400));
    (0, vitest_1.beforeAll)(async () => {
        persistence = await Promise.resolve().then(() => __importStar(require('../persistence')));
        await persistence.runMigrations();
        const { Pool } = await Promise.resolve().then(() => __importStar(require('pg')));
        const p = new Pool({ connectionString: process.env['DATABASE_URL'] });
        await p.query('TRUNCATE decision_policies, decision_agent_policies, decision_velocity, decision_log, decision_meta');
        await p.end();
    });
    (0, vitest_1.afterAll)(async () => { persistence.detachPersistence(); await persistence.closePool(); });
    (0, vitest_1.it)('keeps policies, limits, spend and decisions across a restart, and does not re-seed deleted defaults', async () => {
        await persistence.initPersistence(); // first start: seeds the defaults once
        (0, vitest_1.expect)((0, policies_1.listPolicies)().map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
        (0, policies_1.addPolicy)({ id: 'custom', name: 'Custom', type: 'block_high_amount', params: { maxAmountUsd: 123 }, enabled: true });
        (0, policies_1.deletePolicy)('p2');
        (0, policies_1.setAgentPolicy)('agent_x', { dailyLimitUsd: 42 });
        (0, velocity_1.recordTransaction)('agent_x', 300);
        (0, decision_log_1.recordDecision)(decision('agent_x'));
        await wait();
        // restart: memory is wiped, state comes back from the database
        persistence.detachPersistence();
        (0, policies_1.hydratePolicies)([], []);
        (0, velocity_1.clearVelocity)();
        (0, decision_log_1.clearDecisionLog)();
        await persistence.initPersistence();
        (0, vitest_1.expect)((0, policies_1.listPolicies)().map((p) => p.id).sort()).toEqual(['custom', 'p1', 'p3']); // p2 stays deleted
        (0, vitest_1.expect)((0, policies_1.getAgentPolicy)('agent_x').dailyLimitUsd).toBe(42);
        (0, vitest_1.expect)((0, velocity_1.getVelocity)('agent_x').last1hUsd).toBe(300);
        (0, vitest_1.expect)((0, decision_log_1.getDecisionHistory)(5)[0].agentId).toBe('agent_x');
    });
});
//# sourceMappingURL=persistence.test.js.map