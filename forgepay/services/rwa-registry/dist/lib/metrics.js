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
exports.register = exports.tokensRegisteredTotal = exports.tokenRegistrationDuration = exports.httpRequestTotal = exports.httpRequestDuration = void 0;
const promClient = __importStar(require("prom-client"));
// Initialize default metrics
promClient.collectDefaultMetrics();
// HTTP request duration histogram (in seconds)
exports.httpRequestDuration = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
});
// HTTP request total counter
exports.httpRequestTotal = new promClient.Counter({
    name: 'http_request_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
});
// RWA registry specific: token registration duration (seconds)
exports.tokenRegistrationDuration = new promClient.Histogram({
    name: 'token_registration_duration_seconds',
    help: 'Time taken to register a token in the RWA registry',
    labelNames: ['asset_id'],
    buckets: [0.01, 0.1, 0.5, 1, 2, 5, 10],
});
// RWA registry specific: total tokens registered (gauge)
exports.tokensRegisteredTotal = new promClient.Gauge({
    name: 'tokens_registered_total',
    help: 'Total number of tokens registered in the RWA registry',
});
// Export metrics registry for /metrics endpoint
exports.register = promClient.register;
//# sourceMappingURL=metrics.js.map