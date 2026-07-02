/**
 * Shared pino logger for the forge-wallet service.
 * In development the pino-pretty transport is used for human-readable output.
 * In production structured JSON is written to stdout for log aggregation.
 *
 * `password` and authorization material are redacted so signing requests can
 * never leak plaintext passwords into logs.
 */

import pino from 'pino';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: 'forge-wallet',
      version: process.env.npm_package_version ?? '0.1.0',
    },
    redact: {
      paths: ['password', '*.password', 'body.password', 'req.headers.authorization'],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test'
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined,
);
