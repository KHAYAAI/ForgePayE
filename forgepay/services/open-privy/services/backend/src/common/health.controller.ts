import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      environment: process.env.NODE_ENV,
    };
  }

  @Get('ready')
  readiness() {
    return {
      ready: true,
      timestamp: new Date().toISOString(),
    };
  }
}
