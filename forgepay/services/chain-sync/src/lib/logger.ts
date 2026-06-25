import pino from 'pino';

const isDevelopment = process.env['NODE_ENV'] !== 'production';

/**
 * Create a configured pino logger instance
 */
export function createLogger(): pino.Logger {
  return pino(
    {
      level: process.env['LOG_LEVEL'] ?? 'info',
      base: {
        service: 'chain-sync',
      },
    },
    isDevelopment
      ? pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        })
      : undefined
  );
}

export const logger = createLogger();
