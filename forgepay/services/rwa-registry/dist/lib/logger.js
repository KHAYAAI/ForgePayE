"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
exports.logger = (0, pino_1.default)({
    level: process.env['LOG_LEVEL'] ?? 'info',
    ...(NODE_ENV === 'development' && {
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        },
    }),
});
//# sourceMappingURL=logger.js.map