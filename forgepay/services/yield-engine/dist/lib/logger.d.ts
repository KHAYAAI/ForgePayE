/**
 * Configured pino logger instance with structured logging.
 * Uses JSON formatting in production and pretty-printed in development.
 * Includes service name and ISO 8601 timestamps in all logs.
 */
import pino from 'pino';
export declare const logger: pino.Logger<never, boolean>;
//# sourceMappingURL=logger.d.ts.map