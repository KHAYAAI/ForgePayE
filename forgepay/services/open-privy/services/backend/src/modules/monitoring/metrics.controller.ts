import { Controller, Get } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { register } from 'prom-client';
import { MonitoringService } from './monitoring.service';

@Controller('metrics')
export class MetricsController {
  constructor(private monitoringService: MonitoringService) {}

  @Get()
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  @Get('health')
  async getHealth(): Promise<Record<string, any>> {
    return this.monitoringService.getMetrics();
  }

  @Get('info')
  async getInfo(): Promise<Record<string, any>> {
    return {
      name: 'OpenPrivy Backend',
      version: '1.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  }
}
