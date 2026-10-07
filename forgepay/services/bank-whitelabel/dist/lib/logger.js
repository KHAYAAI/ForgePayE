import pino from 'pino';
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
export const logger = pino({
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