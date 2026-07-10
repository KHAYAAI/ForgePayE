/**
 * Prometheus metrics for the yield-engine service.
 * Exports initialized metrics with a default registry.
 * Metrics are exposed at GET /metrics in Prometheus text format.
 */
import * as promClient from 'prom-client';
export declare const register: promClient.Registry<"text/plain; version=0.0.4; charset=utf-8">;
/**
 * Histogram tracking HTTP request duration in seconds.
 * Labels: method, route (normalized), status_code
 */
export declare const httpRequestDuration: promClient.Histogram<"method" | "route" | "status_code">;
/**
 * Counter tracking total HTTP requests.
 * Labels: method, route (normalized), status_code
 */
export declare const httpRequestTotal: promClient.Counter<"method" | "route" | "status_code">;
/**
 * Histogram tracking sweep job execution duration in seconds.
 * Labels: none (global across all sweeps)
 */
export declare const sweepJobDuration: promClient.Histogram<string>;
/**
 * Counter tracking total amount swept in USD.
 * Labels: none (cumulative across all sweeps)
 */
export declare const sweptBalancesTotal: promClient.Counter<string>;
/**
 * Counter tracking total yield earnings in USD.
 * Labels: none (cumulative across all yield accruals)
 */
export declare const yieldEarnedTotal: promClient.Counter<string>;
/**
 * Counter tracking sweep errors.
 * Labels: error_reason (e.g., 'balance_fetch_failed', 'deposit_failed', 'db_write_failed')
 */
export declare const sweepErrorsTotal: promClient.Counter<"error_reason">;
//# sourceMappingURL=metrics.d.ts.map