/**
 * Shared pino logger for the enterprise-treasury service.
 * In development the pino-pretty transport is used for human-readable output.
 * In production structured JSON is written to stdout for log aggregation.
 */

import pino from 'pino';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: 'enterprise-treasury',
      version: process.env.npm_package_version ?? '0.2.0',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  process.env.NODE_ENV !== 'production'
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined,
);
