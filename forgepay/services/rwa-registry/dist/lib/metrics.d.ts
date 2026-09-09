import * as promClient from 'prom-client';
export declare const httpRequestDuration: promClient.Histogram<"method" | "route" | "status_code">;
export declare const httpRequestTotal: promClient.Counter<"method" | "route" | "status_code">;
export declare const tokenRegistrationDuration: promClient.Histogram<"asset_id">;
export declare const tokensRegisteredTotal: promClient.Gauge<string>;
export declare const register: promClient.Registry<"text/plain; version=0.0.4; charset=utf-8">;
//# sourceMappingURL=metrics.d.ts.map