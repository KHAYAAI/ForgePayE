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
exports.metrics = exports.Metrics = void 0;
const promClient = __importStar(require("prom-client"));
class Metrics {
    static instance;
    // Standard HTTP metrics
    httpRequestDuration;
    httpRequestTotal;
    // Service-specific metrics
    decisionProcessingDuration;
    decisionsTotal;
    constructor() {
        // Register default metrics (gc, heap, etc.)
        promClient.collectDefaultMetrics();
        // HTTP request duration histogram
        this.httpRequestDuration = new promClient.Histogram({
            name: 'http_request_duration_seconds',
            help: 'HTTP request duration in seconds',
            labelNames: ['method', 'route', 'status_code'],
            buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
        });
        // HTTP request total counter
        this.httpRequestTotal = new promClient.Counter({
            name: 'http_request_total',
            help: 'Total HTTP requests',
            labelNames: ['method', 'route', 'status_code'],
        });
        // Decision processing duration histogram (seconds)
        this.decisionProcessingDuration = new promClient.Histogram({
            name: 'decision_processing_duration_seconds',
            help: 'Duration to process a decision request in seconds',
            buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
        });
        // Total decisions counter
        this.decisionsTotal = new promClient.Counter({
            name: 'decisions_total',
            help: 'Total number of decisions processed',
        });
    }
    static getInstance() {
        if (!Metrics.instance) {
            Metrics.instance = new Metrics();
        }
        return Metrics.instance;
    }
    /**
     * Get all metrics in Prometheus text format
     */
    static async register() {
        return promClient.register.metrics();
    }
}
exports.Metrics = Metrics;
exports.metrics = Metrics.getInstance();
//# sourceMappingURL=metrics.js.map