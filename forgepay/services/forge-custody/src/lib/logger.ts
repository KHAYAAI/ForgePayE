/**
 * Shared pino logger for the forge-custody service.
 * In development the pino-pretty transport is used for human-readable output.
 * In production (and under test) structured JSON is written to stdout.
 */

import pino from 'pino';

const env = process.env.NODE_ENV ?? 'development';
const usePretty = env !== 'production' && env !== 'test';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: 'forge-custody',
      version: process.env.npm_package_version ?? '0.1.0',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  usePretty
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined,
);
