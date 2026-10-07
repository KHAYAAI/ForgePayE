"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createLogger = createLogger;
const pino_1 = __importDefault(require("pino"));
const isDevelopment = process.env['NODE_ENV'] !== 'production';
/**
 * Create a configured pino logger instance
 */
function createLogger() {
    return (0, pino_1.default)({
        level: process.env['LOG_LEVEL'] ?? 'info',
        base: {
            service: 'agent-decision-framework',
        },
    }, isDevelopment
        ? pino_1.default.transport({
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        })
        : undefined);
}
exports.logger = createLogger();
//# sourceMappingURL=logger.js.map