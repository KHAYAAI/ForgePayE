"use strict";
/**
 * Configured pino logger instance with structured logging.
 * Uses JSON formatting in production and pretty-printed in development.
 * Includes service name and ISO 8601 timestamps in all logs.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
/**
 * Create a configured pino logger instance.
 * In production (NODE_ENV=production), logs are output as JSON lines.
 * In development, logs are pretty-printed with colors and formatting.
 */
function createLogger() {
    const isDev = process.env['NODE_ENV'] !== 'production';
    return (0, pino_1.default)({
        name: 'yield-engine',
        level: process.env['LOG_LEVEL'] ?? 'info',
        timestamp: pino_1.default.stdTimeFunctions.isoTime,
        ...(isDev && {
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss Z',
                    ignore: 'pid,hostname',
                },
            },
        }),
    });
}
exports.logger = createLogger();
//# sourceMappingURL=logger.js.map