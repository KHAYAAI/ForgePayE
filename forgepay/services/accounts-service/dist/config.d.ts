export declare const config: {
    readonly port: number;
    readonly env: "development" | "production";
    readonly postgres: {
        readonly host: string;
        readonly port: number;
        readonly database: string;
        readonly user: string;
        readonly password: string;
    };
    readonly redis: {
        readonly url: string;
    };
    readonly unifiedRouterUrl: string;
    readonly internalWebhookSecret: string;
    readonly corsAllowedOrigins: string[];
    readonly encryptionKey: string;
    readonly circle: {
        readonly apiKey: string | undefined;
        readonly baseUrl: string;
        readonly webhookSecret: string | undefined;
    };
    readonly kyc: {
        readonly onfidoApiKey: string | undefined;
        readonly ofacScreeningEnabled: boolean;
    };
    readonly rpc: {
        readonly ethereum: string;
        readonly polygon: string;
        readonly base: string;
        readonly arbitrum: string;
    };
    readonly accounts: {
        readonly defaultChain: "polygon" | "base" | "ethereum" | "arbitrum";
        readonly minDepositUsd: number;
        readonly maxDepositUsd: number;
        readonly withdrawalFeePercent: number;
        readonly depositTtlSeconds: number;
    };
    readonly zkProofs: {
        readonly enabled: boolean;
        readonly exportKeysBin: string;
    };
    readonly aws: {
        readonly region: string;
        readonly kmsKeyArn: string;
    };
};
//# sourceMappingURL=config.d.ts.map