import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MonitoringService } from './monitoring.service';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
      },
    }),
  ],
  providers: [MonitoringService],
  controllers: [MetricsController],
  exports: [MonitoringService],
})
export class MonitoringModule {}
