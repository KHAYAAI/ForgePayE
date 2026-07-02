import * as winston from 'winston';

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
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
      new winston.transports.File({ filename: 'logs/combined.log' }),
    ],
  });
}

export const logger = createLogger('OpenPrivy');
