import Redis from 'ioredis';
import { logger } from './logger.js';

export function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck:     true,
    lazyConnect:          false,
  });

  client.on('connect', () => logger.info('Redis connected'));
  client.on('error',   (err) => logger.error({ err }, 'Redis error'));

  return client;
}
