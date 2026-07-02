import { Injectable, HttpStatus } from '@nestjs/common';
import { NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

/**
 * Rate limiting middleware for protecting against brute force and DoS attacks
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  // Global rate limiter: 100 requests per minute per IP
  private rateLimiterByIP = new RateLimiterMemory({
    points: 100,
    duration: 60,
    blockDurationMs: 300000, // 5 minutes block
  });

  // Per-user rate limiter: 1000 requests per minute
  private rateLimiterByUser = new RateLimiterMemory({
    points: 1000,
    duration: 60,
  });

  // Sensitive endpoints: stricter limits
  private rateLimiterLogin = new RateLimiterMemory({
    points: 5, // 5 attempts
    duration: 60, // per minute
    blockDurationMs: 900000, // 15 minutes block
  });

  private rateLimiterSignup = new RateLimiterMemory({
    points: 3, // 3 signups
    duration: 3600, // per hour
    blockDurationMs: 3600000, // 1 hour block
  });

  use(req: Request, res: Response, next: NextFunction) {
    const ipKey = req.ip || 'unknown';
    const userKey = req.user?.id || ipKey;

    // Apply rate limiting
    this.applyRateLimit(req, res, ipKey, userKey)
      .then(() => {
        next();
      })
      .catch((err) => {
        const retryAfter = Math.ceil(err.msBeforeNext / 1000);
        res.set('Retry-After', retryAfter.toString());
        res.status(HttpStatus.TOO_MANY_REQUESTS).json({
          statusCode: 429,
          error: 'Too many requests',
          retryAfter: retryAfter,
          message: 'Rate limit exceeded. Please try again later.',
        });
      });
  }

  private async applyRateLimit(
    req: Request,
    res: Response,
    ipKey: string,
    userKey: string,
  ): Promise<void> {
    // Global rate limit by IP
    await this.rateLimiterByIP.consume(ipKey);

    // Per-user rate limit
    if (req.user) {
      await this.rateLimiterByUser.consume(userKey);
    }

    // Stricter limits for sensitive endpoints
    if (this.isSensitiveEndpoint(req)) {
      if (req.path.includes('login')) {
        await this.rateLimiterLogin.consume(ipKey);
      } else if (req.path.includes('signup')) {
        await this.rateLimiterSignup.consume(ipKey);
      }
    }

    // Add rate limit headers to response
    res.set('X-RateLimit-Limit', '100');
    res.set('X-RateLimit-Remaining', '99');
    res.set('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + 60).toString());
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
      blockDurationMs,
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
