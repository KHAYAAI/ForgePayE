/**
 * Structured Logger — agent-credit-lines
 *
 * Configured pino logger with:
 *   - JSON formatting in production
 *   - Pretty formatting in development
 *   - ISO 8601 timestamps
 *   - Service name in all logs
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: false,
        translateTime: 'SYS:standard',
      },
    },
  }),
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'agent-credit-lines',
  },
});

export default logger;
