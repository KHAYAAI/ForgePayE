import * as winston from 'winston';

/**
 * In containers/production we log to stdout only — the platform (CloudWatch,
 * Loki, etc.) collects it, and writing files breaks under a read-only root
 * filesystem (our k8s securityContext sets readOnlyRootFilesystem: true).
 * File transports are opt-in for local dev via LOG_TO_FILE=true.
 */
function buildTransports(): winston.transport[] {
  const transports: winston.transport[] = [new winston.transports.Console()];

  const logToFile =
    process.env.LOG_TO_FILE === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.LOG_TO_FILE !== 'false');

  if (logToFile) {
    transports.push(
      new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
      new winston.transports.File({ filename: 'logs/combined.log' }),
    );
  }

  return transports;
}

export function createLogger(context: string): winston.Logger {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ level, message, timestamp, stack }) => {
        return `${timestamp} [${context}] ${level.toUpperCase()}: ${message}${
          stack ? '\n' + stack : ''
        }`;
      }),
    ),
    defaultMeta: { service: 'openprivy-api', context },
    transports: buildTransports(),
  });
}

export const logger = createLogger('OpenPrivy');
