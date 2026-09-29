import { Controller, Get } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';

/**
 * Health/info endpoints. The Prometheus scrape endpoint itself (GET /metrics)
 * is served by PrometheusModule, so this controller only exposes the
 * human-oriented health and info routes under /metrics/*.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private monitoringService: MonitoringService) {}

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
