import { Module } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { MonitoringService } from './monitoring.service';
import { MetricsController } from './metrics.controller';

/**
 * Prometheus wiring. The custom metrics injected by MonitoringService via
 * @InjectMetric MUST be registered here as providers, otherwise DI cannot
 * resolve them and the app fails to boot. PrometheusModule also exposes the
 * scrape endpoint at GET /metrics.
 */
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    MonitoringService,
    makeCounterProvider({
      name: 'openprivy_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'path', 'status'],
    }),
    makeHistogramProvider({
      name: 'openprivy_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'path'],
    }),
    makeCounterProvider({
      name: 'openprivy_errors_total',
      help: 'Total errors',
      labelNames: ['errorType', 'message'],
    }),
    makeGaugeProvider({
      name: 'openprivy_wallet_balance_wei',
      help: 'Wallet balance in wei',
      labelNames: ['walletId'],
    }),
    makeCounterProvider({
      name: 'openprivy_transactions_total',
      help: 'Total transactions',
      labelNames: ['type', 'chain', 'status'],
    }),
    makeCounterProvider({
      name: 'openprivy_gas_sponsored_wei',
      help: 'Total gas sponsored in wei',
    }),
  ],
  controllers: [MetricsController],
  exports: [MonitoringService],
})
export class MonitoringModule {}
