/**
 * Configured pino logger instance with structured logging.
 * Uses JSON formatting in production and pretty-printed in development.
 * Includes service name and ISO 8601 timestamps in all logs.
 */

import pino from 'pino';

/**
 * Create a configured pino logger instance.
 * In production (NODE_ENV=production), logs are output as JSON lines.
 * In development, logs are pretty-printed with colors and formatting.
 */
function createLogger(): pino.Logger {
  const isDev = process.env['NODE_ENV'] !== 'production';

  return pino({
    name: 'yield-engine',
    level: process.env['LOG_LEVEL'] ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
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

export const logger = createLogger();
