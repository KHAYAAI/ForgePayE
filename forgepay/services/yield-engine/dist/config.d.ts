/**
 * Centralised configuration — reads from environment variables (via dotenv).
 * All consumers import from here; never read process.env directly in services.
 */
import 'dotenv/config';
export declare const config: {
    readonly port: number;
    readonly jwtSecret: string;
    readonly rpc: {
        readonly ethereum: string;
        readonly polygon: string;
        readonly base: string;
        readonly arbitrum: string;
    };
    readonly ondoApiKey: string;
    readonly ondoApiBase: "https://api.ondo.finance/v1";
    readonly stablecoinGatewayUrl: string;
    readonly sweepIntervalMinutes: number;
    readonly corsOrigins: string[];
    readonly signerPrivateKey: any;
    readonly apyCacheTtlMs: number;
};
//# sourceMappingURL=config.d.ts.map