"use strict";
/**
 * Prometheus metrics for the yield-engine service.
 * Exports initialized metrics with a default registry.
 * Metrics are exposed at GET /metrics in Prometheus text format.
 */
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
exports.sweepErrorsTotal = exports.yieldEarnedTotal = exports.sweptBalancesTotal = exports.sweepJobDuration = exports.httpRequestTotal = exports.httpRequestDuration = exports.register = void 0;
const promClient = __importStar(require("prom-client"));
// ── Registry & defaults ───────────────────────────────────────────────────────
exports.register = new promClient.Registry();
// Load default metrics (CPU, memory, Node.js internals)
promClient.collectDefaultMetrics({ register: exports.register });
// ── HTTP metrics ──────────────────────────────────────────────────────────────
/**
 * Histogram tracking HTTP request duration in seconds.
 * Labels: method, route (normalized), status_code
 */
exports.httpRequestDuration = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [exports.register],
});
/**
 * Counter tracking total HTTP requests.
 * Labels: method, route (normalized), status_code
 */
exports.httpRequestTotal = new promClient.Counter({
    name: 'http_request_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [exports.register],
});
// ── Yield operation metrics ───────────────────────────────────────────────────
/**
 * Histogram tracking sweep job execution duration in seconds.
 * Labels: none (global across all sweeps)
 */
exports.sweepJobDuration = new promClient.Histogram({
    name: 'sweep_job_duration_seconds',
    help: 'Sweep job execution duration in seconds',
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120],
    registers: [exports.register],
});
/**
 * Counter tracking total amount swept in USD.
 * Labels: none (cumulative across all sweeps)
 */
exports.sweptBalancesTotal = new promClient.Counter({
    name: 'swept_balances_total',
    help: 'Total amount swept in USD',
    registers: [exports.register],
});
/**
 * Counter tracking total yield earnings in USD.
 * Labels: none (cumulative across all yield accruals)
 */
exports.yieldEarnedTotal = new promClient.Counter({
    name: 'yield_earned_total',
    help: 'Total yield earned in USD',
    registers: [exports.register],
});
/**
 * Counter tracking sweep errors.
 * Labels: error_reason (e.g., 'balance_fetch_failed', 'deposit_failed', 'db_write_failed')
 */
exports.sweepErrorsTotal = new promClient.Counter({
    name: 'sweep_errors_total',
    help: 'Total sweep errors by reason',
    labelNames: ['error_reason'],
    registers: [exports.register],
});
//# sourceMappingURL=metrics.js.map