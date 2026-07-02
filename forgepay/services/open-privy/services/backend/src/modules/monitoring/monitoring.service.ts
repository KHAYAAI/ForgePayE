import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class MonitoringService {
  constructor(
    @InjectMetric('openprivy_requests_total')
    private requestCounter: Counter<string>,
    @InjectMetric('openprivy_request_duration_seconds')
    private requestDuration: Histogram<string>,
    @InjectMetric('openprivy_errors_total')
    private errorCounter: Counter<string>,
    @InjectMetric('openprivy_wallet_balance_wei')
    private walletBalance: Gauge<string>,
    @InjectMetric('openprivy_transactions_total')
    private transactionCounter: Counter<string>,
    @InjectMetric('openprivy_gas_sponsored_wei')
    private gasSponsored: Counter<string>,
  ) {}

  trackRequest(method: string, path: string, status: number): void {
    this.requestCounter.inc({ method, path, status });
  }

  recordRequestDuration(method: string, path: string, duration: number): void {
    this.requestDuration.observe({ method, path }, duration / 1000);
  }

  trackError(errorType: string, message: string): void {
    this.errorCounter.inc({ errorType, message });
  }

  recordWalletBalance(walletId: string, balance: string): void {
    this.walletBalance.set({ walletId }, parseFloat(balance));
  }

  trackTransaction(type: string, chain: string, status: string): void {
    this.transactionCounter.inc({ type, chain, status });
  }

  trackGasSponsorship(amount: string): void {
    this.gasSponsored.inc({}, parseFloat(amount));
  }

  getMetrics(): Record<string, any> {
    return {
      timestamp: new Date().toISOString(),
      service: 'OpenPrivy Backend',
      status: 'healthy',
    };
  }
}
