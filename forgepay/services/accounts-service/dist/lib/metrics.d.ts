import * as promClient from 'prom-client';
export declare class Metrics {
    private static instance;
    readonly httpRequestDuration: promClient.Histogram<'method' | 'route' | 'status_code'>;
    readonly httpRequestTotal: promClient.Counter<'method' | 'route' | 'status_code'>;
    readonly accountCreationDuration: promClient.Histogram;
    readonly accountsTotal: promClient.Gauge;
    private constructor();
    static getInstance(): Metrics;
    /**
     * Get all metrics in Prometheus text format
     */
    static register(): Promise<string>;
}
export declare const metrics: Metrics;
//# sourceMappingURL=metrics.d.ts.map