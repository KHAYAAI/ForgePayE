import { Injectable, HttpStatus } from '@nestjs/common';
import { NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterAbstract,
  RateLimiterRes,
} from 'rate-limiter-flexible';
import { createClient } from 'redis';
import { logger } from '../logger';

/**
 * Rate limiting middleware for protecting against brute force and DoS attacks.
 *
 * When REDIS_URL is set, counters live in Redis so limits are GLOBAL across all
 * replicas (correct behaviour behind an HPA/multiple pods). A per-process memory
 * limiter is used as the `insuranceLimiter` so requests are still limited during
 * a Redis blip and before the connection is established, and as the sole limiter
 * in local dev when no Redis is configured.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private rateLimiterByIP: RateLimiterAbstract;
  private rateLimiterLogin: RateLimiterAbstract;
  private rateLimiterSignup: RateLimiterAbstract;

  // Limits are env-tunable so ops can adjust without a redeploy (and load tests
  // can raise them). Defaults are the production values.
  private readonly ipPoints = Number(process.env.RATE_LIMIT_IP_POINTS) || 100;
  private readonly ipDuration = Number(process.env.RATE_LIMIT_IP_DURATION) || 60;
  private readonly loginPoints = Number(process.env.RATE_LIMIT_LOGIN_POINTS) || 5;
  private readonly signupPoints = Number(process.env.RATE_LIMIT_SIGNUP_POINTS) || 3;

  constructor() {
    const redisUrl = process.env.REDIS_URL;

    // Memory fallbacks (also used as insuranceLimiter for the Redis limiters).
    const memIP = new RateLimiterMemory({ points: this.ipPoints, duration: this.ipDuration, blockDuration: 300 });
    const memLogin = new RateLimiterMemory({ points: this.loginPoints, duration: 60, blockDuration: 900 });
    const memSignup = new RateLimiterMemory({ points: this.signupPoints, duration: 3600, blockDuration: 3600 });

    if (redisUrl) {
      const client = createClient({ url: redisUrl });
      client.on('error', (e) => logger.error(`Rate-limit Redis error: ${e.message}`));
      client.connect().catch((e) =>
        logger.error(`Rate-limit Redis connect failed, using memory fallback: ${e.message}`),
      );

      this.rateLimiterByIP = new RateLimiterRedis({
        storeClient: client,
        keyPrefix: 'rl:ip',
        points: this.ipPoints,
        duration: this.ipDuration,
        blockDuration: 300,
        insuranceLimiter: memIP,
      });
      this.rateLimiterLogin = new RateLimiterRedis({
        storeClient: client,
        keyPrefix: 'rl:login',
        points: this.loginPoints,
        duration: 60,
        blockDuration: 900,
        insuranceLimiter: memLogin,
      });
      this.rateLimiterSignup = new RateLimiterRedis({
        storeClient: client,
        keyPrefix: 'rl:signup',
        points: this.signupPoints,
        duration: 3600,
        blockDuration: 3600,
        insuranceLimiter: memSignup,
      });
      logger.info('Rate limiting backed by Redis (global across replicas)');
    } else {
      this.rateLimiterByIP = memIP;
      this.rateLimiterLogin = memLogin;
      this.rateLimiterSignup = memSignup;
      logger.warn('REDIS_URL not set — rate limiting is per-process (dev only)');
    }
  }

  use(req: Request, res: Response, next: NextFunction) {
    const ipKey = req.ip || 'unknown';

    // This middleware runs before the auth guard populates req.user, so all
    // limiting is keyed by IP. Per-authenticated-user limits belong at the
    // guard/controller layer where the identity is known.
    this.applyRateLimit(req, res, ipKey)
      .then(() => {
        next();
      })
      .catch((err) => {
        const retryAfter = Math.ceil((err?.msBeforeNext ?? 60000) / 1000);
        res.set('Retry-After', retryAfter.toString());
        res.status(HttpStatus.TOO_MANY_REQUESTS).json({
          statusCode: 429,
          error: 'Too many requests',
          retryAfter,
          message: 'Rate limit exceeded. Please try again later.',
        });
      });
  }

  private async applyRateLimit(
    req: Request,
    res: Response,
    ipKey: string,
  ): Promise<void> {
    // Stricter limits for sensitive endpoints (consumed first so a burst of
    // login/signup attempts is blocked even within the global budget).
    if (this.isSensitiveEndpoint(req)) {
      if (req.path.includes('login')) {
        await this.rateLimiterLogin.consume(ipKey);
      } else if (req.path.includes('signup')) {
        await this.rateLimiterSignup.consume(ipKey);
      }
    }

    // Global rate limit by IP
    const result: RateLimiterRes = await this.rateLimiterByIP.consume(ipKey);

    // Real rate-limit headers derived from the limiter state
    res.set('X-RateLimit-Limit', this.ipPoints.toString());
    res.set('X-RateLimit-Remaining', result.remainingPoints.toString());
    res.set(
      'X-RateLimit-Reset',
      Math.ceil((Date.now() + result.msBeforeNext) / 1000).toString(),
    );
  }

  private isSensitiveEndpoint(req: Request): boolean {
    const sensitivePatterns = [
      /\/auth\/(login|signup|password)/i,
      /\/wallet\/create/i,
      /\/recovery\/(initiate|approve)/i,
      /\/account-abstraction\/(send|execute)/i,
    ];

    return sensitivePatterns.some((pattern) => pattern.test(req.path));
  }
}

/**
 * Decorator for per-endpoint rate limiting
 */
export function RateLimit(
  points: number = 100,
  duration: number = 60,
  blockDurationMs: number = 300000,
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const limiter = new RateLimiterMemory({
      points,
      duration,
      blockDuration: Math.ceil(blockDurationMs / 1000), // option is in seconds
    });

    descriptor.value = async function (...args: any[]) {
      const [req, res] = args;
      const key = `${propertyKey}:${req.ip}:${req.user?.id || 'anonymous'}`;

      try {
        await limiter.consume(key);
        return originalMethod.apply(this, args);
      } catch (err) {
        const retryAfter = Math.ceil(err.msBeforeNext / 1000);
        res.set('Retry-After', retryAfter.toString());
        res.status(429).json({
          statusCode: 429,
          error: 'Too many requests',
          message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
        });
      }
    };

    return descriptor;
  };
}
