import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { Logger } from 'winston';
import { AppModule } from './app.module';
import { createLogger } from './common/logger';
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';

async function bootstrap() {
  const logger = createLogger('Bootstrap');

  try {
    const app = await NestFactory.create(AppModule);

    // Security headers
    app.use(helmet());

    // Request size limits
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ limit: '1mb' }));

    // Rate limiting middleware
    app.use(new RateLimitMiddleware().use.bind(new RateLimitMiddleware()));

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    // CORS configuration - production only allows whitelisted origins
    const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:8081').split(',');
    app.enableCors({
      origin: corsOrigins.map(origin => origin.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    });

    const port = process.env.PORT || 3001;
    await app.listen(port);

    logger.info(`OpenPrivy API listening on port ${port}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`CORS origins: ${corsOrigins.join(', ')}`);
  } catch (error) {
    logger.error('Failed to start application', error);
    process.exit(1);
  }
}

bootstrap();
